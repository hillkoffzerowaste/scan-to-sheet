#!/usr/bin/env node
/**
 * launch-cdp.js
 * Launch Chrome with remote debugging enabled, then open scan-to-sheet.
 *
 * Usage:
 *   node scripts/launch-cdp.js                    # open local dev (http://localhost:5173)
 *   node scripts/launch-cdp.js --url https://...   # open custom URL
 *   node scripts/launch-cdp.js --port 9222         # custom debug port (default 9222)
 *   node scripts/launch-cdp.js --headless           # run headless (no window)
 *
 * Once running, connect via:
 *   - Puppeteer:  puppeteer.connect({ browserURL: 'http://localhost:9222' })
 *   - Playwright: playwright.chromium.connectOverCDP('http://localhost:9222')
 *   - MCP Server:  cdp-browser-server (CDP_URL=http://localhost:9222)
 *   - Browser:     open http://localhost:9222/json in any browser
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ──

const DEFAULT_PORT = 9222;
const DEFAULT_URL = 'http://localhost:5173';

function parseArgs() {
  const args = { port: DEFAULT_PORT, url: DEFAULT_URL, headless: false };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--port' && process.argv[i + 1]) {
      args.port = Number(process.argv[++i]);
    } else if (arg === '--url' && process.argv[i + 1]) {
      args.url = process.argv[++i];
    } else if (arg === '--headless') {
      args.headless = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
launch-cdp.js — Launch Chrome with remote debugging

Usage:
  node scripts/launch-cdp.js [options]

Options:
  --port <n>     Debug port (default: 9222)
  --url <url>    URL to open (default: http://localhost:5173)
  --headless     Run in headless mode
  --help, -h     Show this help

Examples:
  node scripts/launch-cdp.js
  node scripts/launch-cdp.js --url https://scan-to-sheet.vercel.app
  node scripts/launch-cdp.js --port 9223 --headless

Connect from Puppeteer/Playwright/MCP:
  CDP endpoint: http://localhost:<port>
  List tabs:    http://localhost:<port>/json
`);
      process.exit(0);
    }
  }
  return args;
}

function findChromePath() {
  const platform = os.platform();
  const candidates = [];

  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.CHROME_PATH,
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      process.env.CHROME_PATH,
    );
  } else {
    candidates.push(
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
      process.env.CHROME_PATH,
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: try to find via command
  try {
    const which = platform === 'win32'
      ? execSync('where chrome 2>nul || where google-chrome 2>nul || echo notfound', { encoding: 'utf8' }).trim().split('\n')[0]
      : execSync('which google-chrome-stable 2>/dev/null || which google-chrome 2>/dev/null || which chromium 2>/dev/null || echo notfound', { encoding: 'utf8' }).trim();
    if (which && which !== 'notfound' && fs.existsSync(which)) {
      return which;
    }
  } catch { /* ignore */ }

  return null;
}

async function main() {
  const args = parseArgs();
  const chromePath = findChromePath();

  if (!chromePath) {
    console.error('❌ Chrome not found. Install Google Chrome or set CHROME_PATH environment variable.');
    console.error('   Download: https://www.google.com/chrome/');
    process.exit(1);
  }

  console.log(`🔍 Chrome: ${chromePath}`);
  console.log(`🔌 CDP Port: ${args.port}`);
  console.log(`🌐 Opening: ${args.url}`);
  if (args.headless) console.log('👻 Mode: headless');

  // Chrome flags for remote debugging
  const flags = [
    `--remote-debugging-port=${args.port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--disable-features=Translate',
    '--metrics-recording-only',
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',
    '--disable-client-side-phishing-detection',
    '--password-store=basic',
    '--use-mock-keychain',
    '--disable-component-update',
    '--safebrowsing-disable-auto-update',
    args.url,
  ];

  if (args.headless) {
    flags.unshift('--headless=new');
  }

  // Create a temp user data dir so it doesn't conflict with your main Chrome profile
  const userDataDir = path.join(os.tmpdir(), `chrome-cdp-${args.port}-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  flags.unshift(`--user-data-dir=${userDataDir}`);

  console.log(`📁 Profile: ${userDataDir}`);

  const child = spawn(chromePath, flags, {
    stdio: 'ignore',
    detached: true,
  });

  child.unref();

  console.log(`\n✅ Chrome launched (PID: ${child.pid})`);
  console.log(`\n📡 CDP endpoint:  http://localhost:${args.port}`);
  console.log(`📋 List tabs:     http://localhost:${args.port}/json`);
  console.log(`\nConnect from Puppeteer:`);
  console.log(`  const browser = await puppeteer.connect({ browserURL: 'http://localhost:${args.port}' });`);
  console.log(`\nConnect from Playwright:`);
  console.log(`  const browser = await chromium.connectOverCDP('http://localhost:${args.port}');`);
  console.log(`\nStop Chrome: kill PID ${child.pid} or close the window`);
}

main().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});