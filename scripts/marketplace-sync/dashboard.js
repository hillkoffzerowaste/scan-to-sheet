import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(BASE_DIR, '..', '..');
const HOST = process.env.MARKETPLACE_DASHBOARD_HOST || '127.0.0.1';
const PORT = Number(process.env.MARKETPLACE_DASHBOARD_PORT || 8787);
const IS_WINDOWS = process.platform === 'win32';
const NPM = IS_WINDOWS ? 'npm.cmd' : 'npm';
const MAX_LOGS = 400;

const COMMANDS = {
  'login:tiktok': ['run', 'marketplace:login', '--', 'tiktok'],
  'login:shopee': ['run', 'marketplace:login', '--', 'shopee'],
  'login:lazada': ['run', 'marketplace:login', '--', 'lazada'],
  'login:all': ['run', 'marketplace:login', '--', 'all'],
  'sync:once': ['run', 'marketplace:sync:once'],
};

const logs = [];
const jobs = new Map();
let worker = null;

function addLog(scope, message) {
  const line = {
    time: new Date().toISOString(),
    scope,
    message: String(message ?? '').trim(),
  };
  logs.push(line);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  console.log(`[${line.time}] ${scope} ${line.message}`);
}

function spawnNpm(args, scope) {
  const child = spawn(NPM, args, {
    cwd: ROOT_DIR,
    shell: false,
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  jobs.set(child.pid, { pid: child.pid, scope, startedAt: new Date().toISOString() });
  addLog(scope, `started: npm ${args.join(' ')}`);

  child.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      addLog(scope, line);
    }
  });
  child.stderr.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      addLog(`${scope}:err`, line);
    }
  });
  child.on('error', (error) => {
    addLog(`${scope}:err`, error.message);
  });
  child.on('exit', (code, signal) => {
    addLog(scope, `exited code=${code ?? ''} signal=${signal ?? ''}`);
    jobs.delete(child.pid);
    if (worker?.pid === child.pid) {
      worker = null;
    }
  });

  return child;
}

function startWorker() {
  if (worker) {
    return { ok: true, message: 'Worker already running', pid: worker.pid };
  }
  worker = spawnNpm(['run', 'marketplace:sync'], 'worker');
  return { ok: true, message: 'Worker started', pid: worker.pid };
}

function stopWorker() {
  if (!worker) {
    return { ok: true, message: 'Worker is not running' };
  }
  const pid = worker.pid;
  worker.kill();
  worker = null;
  return { ok: true, message: 'Worker stopping', pid };
}

function statusPayload() {
  return {
    workerRunning: Boolean(worker),
    workerPid: worker?.pid ?? null,
    jobs: [...jobs.values()],
    logCount: logs.length,
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function pageHtml() {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Marketplace Sync Dashboard</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f7f9; color: #1f2937; }
    main { max-width: 1040px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 4px; font-size: 26px; }
    .muted { color: #6b7280; margin: 0 0 20px; }
    .panel { background: #fff; border: 1px solid #d7dce2; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    button { border: 1px solid #c7ced8; background: #fff; border-radius: 6px; padding: 10px 12px; cursor: pointer; font-size: 14px; }
    button:hover { background: #eef2f7; }
    button.primary { background: #0f766e; color: white; border-color: #0f766e; }
    button.danger { background: #b91c1c; color: white; border-color: #b91c1c; }
    #status { display: flex; gap: 16px; flex-wrap: wrap; }
    .badge { padding: 6px 10px; border-radius: 999px; background: #eef2f7; }
    pre { height: 430px; overflow: auto; background: #111827; color: #d1d5db; padding: 14px; border-radius: 8px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <main>
    <h1>Marketplace Sync Dashboard</h1>
    <p class="muted">Local control panel for TikTok, Shopee, and Lazada Playwright sync.</p>

    <section class="panel">
      <h2>Login</h2>
      <div class="grid">
        <button onclick="run('login:tiktok')">Login TikTok</button>
        <button onclick="run('login:shopee')">Login Shopee</button>
        <button onclick="run('login:lazada')">Login Lazada</button>
        <button onclick="run('login:all')">Login All</button>
      </div>
    </section>

    <section class="panel">
      <h2>Sync</h2>
      <div class="grid">
        <button onclick="run('sync:once')">Sync Once</button>
        <button class="primary" onclick="run('worker:start')">Start Worker</button>
        <button class="danger" onclick="run('worker:stop')">Stop Worker</button>
        <button onclick="refresh()">Refresh Logs</button>
      </div>
    </section>

    <section class="panel">
      <h2>Status</h2>
      <div id="status"></div>
    </section>

    <section class="panel">
      <h2>Logs</h2>
      <pre id="logs"></pre>
    </section>
  </main>
  <script>
    async function run(command) {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      const data = await res.json();
      if (!data.ok) alert(data.error || 'Command failed');
      await refresh();
    }
    async function refresh() {
      const [statusRes, logsRes] = await Promise.all([fetch('/api/status'), fetch('/api/logs')]);
      const status = await statusRes.json();
      const logs = await logsRes.json();
      document.getElementById('status').innerHTML = [
        '<span class="badge">Worker: ' + (status.workerRunning ? 'Running' : 'Stopped') + '</span>',
        '<span class="badge">PID: ' + (status.workerPid || '-') + '</span>',
        '<span class="badge">Jobs: ' + status.jobs.length + '</span>',
        '<span class="badge">Logs: ' + status.logCount + '</span>'
      ].join('');
      document.getElementById('logs').textContent = logs.logs
        .map((line) => '[' + line.time + '] ' + line.scope + ' ' + line.message)
        .join('\\n');
    }
    setInterval(refresh, 3000);
    refresh();
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageHtml());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      sendJson(res, 200, statusPayload());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/logs') {
      sendJson(res, 200, { logs });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const { command } = await readJson(req);
      if (command === 'worker:start') {
        sendJson(res, 200, startWorker());
        return;
      }
      if (command === 'worker:stop') {
        sendJson(res, 200, stopWorker());
        return;
      }
      const args = COMMANDS[command];
      if (!args) {
        sendJson(res, 403, { ok: false, error: 'Command not allowed' });
        return;
      }
      const child = spawnNpm(args, command);
      sendJson(res, 200, { ok: true, pid: child.pid });
      return;
    }
    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  addLog('dashboard', `open http://${HOST}:${PORT}`);
});
