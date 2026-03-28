import 'dotenv/config';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Config ──────────────────────────────────────────────────────────
const WORKSPACE = process.env.OPENCLAW_WORKSPACE ?? join(process.env.HOME ?? '~', 'workspace');
const CONTEXT_MD_PATH = join(WORKSPACE, 'memory', 'CONTEXT.md');
const FOLLOWUP_STATE_PATH = join(__dirname, '.followup-state.json');
const SESSIONS_DIR = join(process.env.HOME ?? '~', '.openclaw', 'agents', 'main', 'sessions');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const MAX_MESSAGES_PER_SESSION = 50;
const FOLLOWUP_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2h default cooldown
const FOLLOWUPS_ENABLED = false; // Disable followUp injection until proper delivery mechanism is implemented

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

// ── Types ───────────────────────────────────────────────────────────
interface SessionInfo {
  key: string;
  label?: string;
  channel?: string;
  peer?: string;
  sessionId?: string;
  updatedAt?: number;
  [k: string]: unknown;
}

interface SessionMessage {
  role: string;
  text: string;
  timestamp: string;
}

interface FollowUp {
  sessionKey: string;
  message: string;
  reason: string;
  urgency: 'high' | 'medium';
}

interface DeepSeekResponse {
  contextMd: string;
  followUps: FollowUp[];
}

interface FollowUpState {
  [sessionKey: string]: number; // timestamp of last followUp sent
}

// ── Helpers ─────────────────────────────────────────────────────────
function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e: any) {
    console.error(`Command failed: ${cmd}\n${e.message}`);
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isPrivate(session: SessionInfo): boolean {
  const key = (session.key ?? '').toLowerCase();
  const label = (session.label ?? '').toLowerCase();
  return label.includes('private') || key.includes('private');
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text ?? '')
      .join('\n');
  }
  return '';
}

function readSessionHistory(sessionId: string): SessionMessage[] {
  const filePath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return [];

  const messages: SessionMessage[] = [];
  try {
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'message' && entry.message) {
          const role = entry.message.role ?? 'unknown';
          const text = extractText(entry.message.content);
          if (text.trim()) {
            messages.push({
              role,
              text: text.length > 600 ? text.slice(0, 600) + '...[truncated]' : text,
              timestamp: entry.timestamp ?? '',
            });
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch (e: any) {
    console.warn(`Failed to read session file ${sessionId}: ${e.message}`);
  }

  return messages.slice(-MAX_MESSAGES_PER_SESSION);
}

function loadFollowUpState(): FollowUpState {
  try {
    if (existsSync(FOLLOWUP_STATE_PATH)) {
      return JSON.parse(readFileSync(FOLLOWUP_STATE_PATH, 'utf-8'));
    }
  } catch {
    // corrupted state, start fresh
  }
  return {};
}

function saveFollowUpState(state: FollowUpState): void {
  writeFileSync(FOLLOWUP_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

function formatTimeSince(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h${mins}m ago`;
  return `${mins}m ago`;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const nowISO = new Date().toISOString();
  const nowMs = Date.now();
  console.log(`🌾 Context Harvester starting at ${nowISO}`);

  // 1. Get active sessions
  //    Primary: openclaw sessions CLI. Fallback: scan JSONL files directly.
  let sessions: SessionInfo[] = [];

  const sessionsRaw = run('openclaw sessions --json --active 60');
  if (sessionsRaw.trim()) {
    try {
      const parsed = JSON.parse(sessionsRaw);
      sessions = Array.isArray(parsed) ? parsed : (parsed.sessions ?? []);
    } catch {
      console.warn('Failed to parse sessions JSON from CLI, falling back to JSONL scan.');
    }
  }

  // Fallback: scan session JSONL files modified in the last 60 minutes
  if (sessions.length === 0) {
    console.log('CLI unavailable or returned no sessions. Scanning JSONL files directly...');
    try {
      const { readdirSync, statSync } = await import('fs');
      const cutoff = nowMs - 60 * 60 * 1000;
      const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl') && !f.includes('.reset.'));
      for (const file of files) {
        const fullPath = join(SESSIONS_DIR, file);
        try {
          const stat = statSync(fullPath);
          if (stat.mtimeMs >= cutoff) {
            const sessionId = file.replace('.jsonl', '');
            sessions.push({
              key: `agent:main:${sessionId}`,
              sessionId,
              label: sessionId,
            });
          }
        } catch { /* skip unreadable files */ }
      }
      console.log(`Found ${sessions.length} recently active session files.`);
    } catch (e: any) {
      console.error(`JSONL scan failed: ${e.message}`);
    }
  }

  if (sessions.length === 0) {
    console.log('No active sessions. Writing minimal CONTEXT.md.');
    writeMinimal('No active sessions in the last 60 minutes.');
    return;
  }

  // Filter out private sessions
  const publicSessions = sessions.filter((s) => !isPrivate(s));
  console.log(`Found ${sessions.length} sessions (${publicSessions.length} non-private).`);

  // 2. Read history for each session from JSONL files
  const allSessionData: { session: SessionInfo; messages: SessionMessage[] }[] = [];
  let totalMessages = 0;

  for (const session of publicSessions) {
    if (!session.sessionId) continue;
    const messages = readSessionHistory(session.sessionId);
    if (messages.length > 0) {
      allSessionData.push({ session, messages });
      totalMessages += messages.length;
    }
  }

  console.log(`Collected ${totalMessages} messages from ${allSessionData.length} sessions.`);

  if (totalMessages === 0) {
    writeMinimal('Active sessions found but no readable messages.');
    return;
  }

  // 3. Read existing CONTEXT.md
  let existingContext = '';
  if (existsSync(CONTEXT_MD_PATH)) {
    existingContext = readFileSync(CONTEXT_MD_PATH, 'utf-8');
    console.log(`Existing CONTEXT.md: ${existingContext.length} chars.`);
  } else {
    console.log('No existing CONTEXT.md — will create fresh.');
  }

  // 4. Load followUp state
  const followUpState = loadFollowUpState();

  // 5. Build session key list with cooldown info
  const sessionKeyList = allSessionData.map(({ session }) => {
    const lastFollowUp = followUpState[session.key];
    const cooldownInfo = lastFollowUp
      ? `last follow-up: ${formatTimeSince(nowMs - lastFollowUp)}`
      : 'never followed up';
    return `- ${session.key} (channel: ${session.channel || 'unknown'}, peer: ${session.peer || 'unknown'}) [${cooldownInfo}]`;
  }).join('\n');

  // 6. Build prompt for DeepSeek
  const sessionSummaries = allSessionData
    .map(({ session, messages }) => {
      const header = `### Session: ${session.key} (channel: ${session.channel || 'unknown'}, peer: ${session.peer || 'unknown'})`;
      const msgs = messages
        .map((m) => {
          const ts = m.timestamp ? `[${m.timestamp}]` : '';
          return `${ts} ${m.role}: ${m.text}`;
        })
        .join('\n');
      return `${header}\n${msgs}`;
    })
    .join('\n\n---\n\n');

  const userPrompt = `## Current Time
${nowISO}

## Available Session Keys
${sessionKeyList}

## Current CONTEXT.md
${existingContext || '(empty — first run)'}

---

## New Session Data (${allSessionData.length} sessions, ${totalMessages} messages)

${sessionSummaries}`;

  const systemPrompt = `You are a context analyzer. You receive session data and produce a structured JSON response.

## Current time: ${nowISO}

Your response MUST be valid JSON with exactly this structure:
{
  "contextMd": "the full CONTEXT.md content as a string",
  "followUps": []
}

### contextMd rules:
REWRITE CONTEXT.md from scratch reflecting ONLY:
- Topics that are still active or relevant
- People with recent interactions (last 24h)
- Topics with pending actions or follow-ups

REMOVE naturally:
- Resolved topics without pending actions
- Conversations that ended without needed action
- Noise, small talk, one-off interactions

Structure the markdown as:
# CONTEXT.md - Live Context Map
> Last updated: ${nowISO}
> Sessions scanned: [N] | New messages: [N]

## 👤 [Person Name]
### [Channel]
#### [Topic]
- Key details
- Status: 🟡 IN PROGRESS / ✅ DONE / ⏳ WAITING

The file should be CONCISE and USEFUL — like a briefing for someone who just woke up.

### followUps rules:
Follow-ups are OPTIONAL — use your judgment. If a follow-up makes sense, include it.

Consider a followUp when:
- A topic has pending action and the user hasn't responded
- Something time-sensitive needs attention
- A reminder would genuinely help move things forward

Respect the cooldown: check each session's "last follow-up" timestamp. Don't send another follow-up to the same session within 2 hours of the last one.

Each followUp must have:
- sessionKey: exact session key from the "Available Session Keys" list
- message: a natural, helpful message (write as a human assistant would — warm, not robotic)
- reason: brief internal reason why this followUp is needed
- urgency: "high" (legal, financial, expiring deadline) or "medium" (helpful but not critical)

Skip followUps when:
- The user already acknowledged or responded to the topic
- The session was recently followed up (within 2 hours)
- It's noise, small talk, or something clearly resolved`;

  // 7. Call DeepSeek with JSON mode
  let result: DeepSeekResponse | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`DeepSeek API call (attempt ${attempt}/${MAX_RETRIES})...`);
      const response = await deepseek.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });

      const raw = response.choices[0]?.message?.content ?? null;
      if (raw) {
        try {
          result = JSON.parse(raw) as DeepSeekResponse;
          if (!result.contextMd) {
            console.error('DeepSeek returned JSON but missing contextMd field.');
            result = null;
          } else {
            console.log('DeepSeek responded successfully (JSON parsed).');
            break;
          }
        } catch (parseErr: any) {
          console.error(`DeepSeek returned invalid JSON (attempt ${attempt}):`, parseErr.message);
          console.error('Raw response:', raw.slice(0, 200));
        }
      }
    } catch (err: any) {
      console.error(`DeepSeek API error (attempt ${attempt}):`, err.message);
    }
    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  if (!result) {
    console.error('All DeepSeek API attempts failed. CONTEXT.md not updated.');
    process.exit(1);
  }

  // 8. Write CONTEXT.md
  ensureDir(CONTEXT_MD_PATH);
  writeFileSync(CONTEXT_MD_PATH, result.contextMd, 'utf-8');
  console.log(`✅ CONTEXT.md written (${result.contextMd.length} chars) → ${CONTEXT_MD_PATH}`);

  // 9. Process followUps (disabled — flag FOLLOWUPS_ENABLED controls this)
  const followUps = result.followUps ?? [];
  if (!FOLLOWUPS_ENABLED) {
    console.log(`📭 Follow-ups disabled (FOLLOWUPS_ENABLED=false). ${followUps.length} suggestion(s) ignored.`);
  } else if (followUps.length === 0) {
    console.log('📭 No follow-ups suggested by DeepSeek.');
  } else {
    console.log(`📬 ${followUps.length} follow-up(s) suggested:`);

    // Filter by cooldown
    const validFollowUps: FollowUp[] = [];
    for (const fu of followUps) {
      const lastSent = followUpState[fu.sessionKey];
      if (lastSent && (nowMs - lastSent) < FOLLOWUP_COOLDOWN_MS) {
        const elapsed = formatTimeSince(nowMs - lastSent);
        console.log(`  ⏳ SKIPPED (cooldown) → ${fu.sessionKey} — last sent ${elapsed}, min cooldown 2h`);
        continue;
      }
      // Validate session key exists
      const sessionExists = allSessionData.some(d => d.session.key === fu.sessionKey);
      if (!sessionExists) {
        console.log(`  ⚠️ SKIPPED (invalid key) → ${fu.sessionKey}`);
        continue;
      }
      validFollowUps.push(fu);
    }

    if (validFollowUps.length === 0) {
      console.log('📭 All follow-ups filtered out (cooldown or invalid).');
    } else {
      // Output followUps as structured block for the cron agent to process
      console.log('\n===FOLLOWUPS_START===');
      console.log(JSON.stringify(validFollowUps, null, 2));
      console.log('===FOLLOWUPS_END===');

      // Update state for all valid followUps (agent will process them)
      for (const fu of validFollowUps) {
        followUpState[fu.sessionKey] = nowMs;
      }
      saveFollowUpState(followUpState);
    }
  }

  // 10. Summary
  console.log(`\n📊 Summary: ${allSessionData.length} sessions, ${totalMessages} messages, ${followUps.length} followUps suggested, ${followUps.filter(f => {
    const last = followUpState[f.sessionKey];
    return !last || (nowMs - last) < 1000; // just updated = valid
  }).length} will be sent`);
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    const { mkdirSync } = require('fs');
    mkdirSync(dir, { recursive: true });
  }
}

function writeMinimal(reason: string) {
  const content = `# CONTEXT.md - Live Context Map
> Last updated: ${new Date().toISOString()}
> Sessions scanned: 0 | New messages: 0

*${reason}*
`;
  ensureDir(CONTEXT_MD_PATH);
  writeFileSync(CONTEXT_MD_PATH, content, 'utf-8');
  console.log(`Wrote minimal CONTEXT.md → ${CONTEXT_MD_PATH}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
