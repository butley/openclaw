import 'dotenv/config';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import OpenAI from 'openai';

// ── Config ──────────────────────────────────────────────────────────
const CONTEXT_MD_PATH = join(process.env.HOME ?? '~', 'clawd', 'memory', 'CONTEXT.md');
const SESSIONS_DIR = join(process.env.HOME ?? '~', '.openclaw', 'agents', 'main', 'sessions');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const MAX_MESSAGES_PER_SESSION = 50;

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

  // Return last N messages only
  return messages.slice(-MAX_MESSAGES_PER_SESSION);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('🌾 Context Harvester starting...');

  // 1. Get active sessions
  const sessionsRaw = run('openclaw sessions --json --active 60');
  if (!sessionsRaw.trim()) {
    console.log('No sessions output. Writing minimal CONTEXT.md.');
    writeMinimal('No active sessions found.');
    return;
  }

  let sessions: SessionInfo[];
  try {
    const parsed = JSON.parse(sessionsRaw);
    sessions = Array.isArray(parsed) ? parsed : (parsed.sessions ?? []);
  } catch {
    console.error('Failed to parse sessions JSON.');
    writeMinimal('Failed to parse sessions.');
    return;
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

  // 4. Build prompt for DeepSeek
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

  const userPrompt = `## Current CONTEXT.md
${existingContext || '(empty — first run)'}

---

## New Session Data (${allSessionData.length} sessions, ${totalMessages} messages)

${sessionSummaries}`;

  // 5. Call DeepSeek with retries
  const systemPrompt = `You receive the current CONTEXT.md and new messages from active sessions.

REWRITE the CONTEXT.md from scratch reflecting ONLY:
- Topics that are still active or relevant
- People with recent interactions (last 24h)
- Topics with pending actions or follow-ups

REMOVE naturally:
- Resolved topics without pending actions
- Conversations that ended without needed action
- Noise, small talk, one-off interactions

Structure:
## 👤 [Person Name]
### [Channel]
#### [Topic]
- Key details
- Status: 🟡 IN PROGRESS / ✅ DONE / ⏳ WAITING

The file should be CONCISE and USEFUL - like a briefing for someone who just woke up and needs to know what's going on.

Header format:
# CONTEXT.md - Live Context Map
> Last updated: [timestamp]
> Sessions scanned: [N] | New messages: [N]

Use the actual current timestamp (ISO format) and the real counts from the data provided.`;

  let result: string | null = null;

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
      });

      result = response.choices[0]?.message?.content ?? null;
      if (result) {
        console.log('DeepSeek responded successfully.');
        break;
      }
    } catch (err: any) {
      console.error(`DeepSeek API error (attempt ${attempt}):`, err.message);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  if (!result) {
    console.error('All DeepSeek API attempts failed. CONTEXT.md not updated.');
    process.exit(1);
  }

  // 6. Write CONTEXT.md
  writeFileSync(CONTEXT_MD_PATH, result, 'utf-8');
  console.log(`✅ CONTEXT.md written (${result.length} chars) → ${CONTEXT_MD_PATH}`);
}

function writeMinimal(reason: string) {
  const content = `# CONTEXT.md - Live Context Map
> Last updated: ${new Date().toISOString()}
> Sessions scanned: 0 | New messages: 0

*${reason}*
`;
  writeFileSync(CONTEXT_MD_PATH, content, 'utf-8');
  console.log(`Wrote minimal CONTEXT.md → ${CONTEXT_MD_PATH}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
