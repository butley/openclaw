import fs from 'fs';
import path from 'path';

const CLAWDBOT_DIR = path.join(process.env.HOME, '.npm-global/lib/node_modules/clawdbot/dist');
const FILE_PATH = path.join(CLAWDBOT_DIR, 'gateway/server.impl.js');

let content = fs.readFileSync(FILE_PATH, 'utf-8');

// Check if already patched
if (content.includes('onInboundMessageEvent')) {
  console.log('   ⚠ Already patched, skipping');
  process.exit(0);
}

// 1. Add import after onHeartbeatEvent import
content = content.replace(
  /import \{ onHeartbeatEvent \} from "\.\.\/infra\/heartbeat-events\.js";/,
  `import { onHeartbeatEvent } from "../infra/heartbeat-events.js";\nimport { onInboundMessageEvent } from "../infra/inbound-events.js";`
);

// 2. Add subscription after heartbeatUnsub block
content = content.replace(
  /(const heartbeatUnsub = onHeartbeatEvent\(\(evt\) => \{\s*broadcast\("heartbeat", evt, \{ dropIfSlow: true \}\);\s*\}\);)/,
  `$1
    // PATCH: Subscribe to inbound message events and broadcast to connected WebSocket clients
    const inboundMessageUnsub = onInboundMessageEvent((evt) => {
        broadcast("message.inbound", evt, { dropIfSlow: true });
    });`
);

// 3. Add cleanup - add inboundMessageUnsub after heartbeatUnsub in the cleanup/return
content = content.replace(
  /heartbeatUnsub,(\s*chatRunState)/,
  `heartbeatUnsub,
        inboundMessageUnsub,$1`
);

fs.writeFileSync(FILE_PATH, content);
console.log('   Patched successfully');
