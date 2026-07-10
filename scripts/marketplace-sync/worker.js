#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { chromium } from 'playwright';
import { acquireSyncLock, initFirestore, releaseSyncLock, setSyncStatus, upsertOrders } from './firestore.js';
import { getPlatformConfig, listPlatformKeys } from './platforms.js';
import { normalizeOrder } from './normalize.js';

const BASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(BASE_DIR, 'config.json');
const EXAMPLE_CONFIG_PATH = path.join(BASE_DIR, 'config.example.json');
const MACHINE_NAME = os.hostname();

function parseArgs(argv) {
  const args = argv.slice(2);
  const loginIndex = args.indexOf('--login');
  const platformArg = loginIndex >= 0 ? args[loginIndex + 1] : null;
  return {
    login: loginIndex >= 0,
    once: args.includes('--once'),
    platforms: platformArg && !platformArg.startsWith('--')
      ? platformArg.split(',').map((value) => value.trim()).filter(Boolean)
      : null,
  };
}

async function loadConfig() {
  try {
    return JSON.parse(await readFile(DEFAULT_CONFIG_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    await writeFile(DEFAULT_CONFIG_PATH, await readFile(EXAMPLE_CONFIG_PATH, 'utf8'));
    throw new Error(`Created ${DEFAULT_CONFIG_PATH}. Edit it first, then run the worker again.`);
  }
}

async function ensureLocalDirs(config) {
  for (const key of ['profilesDir', 'logDir', 'screenshotsDir']) {
    await mkdir(path.resolve(BASE_DIR, config[key]), { recursive: true });
  }
}

function createLogger(config) {
  const logPath = path.resolve(BASE_DIR, config.logDir, `marketplace-${new Date().toISOString().slice(0, 10)}.log`);
  async function append(level, message) {
    const line = `[${new Date().toISOString()}] ${level} ${message}`;
    console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](line);
    await writeFile(logPath, `${line}\n`, { flag: 'a' }).catch(() => {});
  }
  return {
    info: (message) => append('INFO', message),
    warn: (message) => append('WARN', message),
    error: (message) => append('ERROR', message),
  };
}

function resolvePlatforms(config, requestedPlatforms) {
  const platforms = requestedPlatforms?.length ? requestedPlatforms : config.enabledPlatforms;
  const known = new Set(listPlatformKeys());
  const selected = (platforms ?? listPlatformKeys()).map((platform) => platform.toLowerCase());
  if (selected.includes('all')) {
    return listPlatformKeys();
  }
  return selected.filter((platform) => known.has(platform));
}

function profilePath(config, platform) {
  return path.resolve(BASE_DIR, config.profilesDir, platform);
}

async function openContext(config, platform) {
  const profileDir = profilePath(config, platform);
  await mkdir(profileDir, { recursive: true });
  return chromium.launchPersistentContext(profileDir, {
    headless: Boolean(config.headless),
    viewport: { width: 1440, height: 960 },
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

async function waitForAnySelector(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (const selector of selectors) {
    const remaining = Math.max(deadline - Date.now(), 1000);
    try {
      await page.waitForSelector(selector, { timeout: remaining });
      return selector;
    } catch {
    }
  }
  return null;
}

async function loginPlatform(config, platform, logger) {
  const platformConfig = getPlatformConfig(platform);
  if (!platformConfig) {
    throw new Error(`Unknown platform: ${platform}`);
  }

  const profileDir = profilePath(config, platform);
  await logger.info(`Opening ${platformConfig.label} with profile: ${profileDir}`);
  const context = await openContext({ ...config, headless: false }, platform);
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(platformConfig.orderListUrl ?? platformConfig.loginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.navigationTimeoutMs,
  });

  await logger.info('Login window is open. Sign in if needed, then close the browser window yourself.');
  await Promise.race([
    new Promise((resolve) => context.once('close', resolve)),
    page.waitForEvent('close').catch(() => null),
  ]);
  await context.close().catch(() => {});
}

async function scrapePlatform(config, platform, logger) {
  const platformConfig = getPlatformConfig(platform);
  if (!platformConfig) {
    throw new Error(`Unknown platform: ${platform}`);
  }

  const context = await openContext(config, platform);
  const page = context.pages()[0] ?? await context.newPage();
  try {
    await page.goto(platformConfig.orderListUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.navigationTimeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: config.orderLoadTimeoutMs }).catch(() => {});
    const matchedSelector = await waitForAnySelector(page, platformConfig.readySelectors, config.orderLoadTimeoutMs);
    if (!matchedSelector) {
      await logger.warn(`${platform}: no known order selector found. You may need to log in or tune selectors.`);
    }

    const rawOrders = await page.evaluate(({ extractorSource, platformKey, maxOrders }) => {
      const extractor = new Function(`return (${extractorSource});`)();
      return extractor({ platform: platformKey }).slice(0, maxOrders);
    }, {
      extractorSource: platformConfig.extractor.toString(),
      platformKey: platform,
      maxOrders: config.maxOrdersPerPlatform,
    });

    if (!rawOrders.length) {
      const screenshotPath = path.resolve(BASE_DIR, config.screenshotsDir, `${platform}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      await logger.warn(`${platform}: extracted 0 orders. Screenshot saved for selector tuning.`);
    }

    return rawOrders.map((order) => normalizeOrder(order, platform));
  } finally {
    await context.close();
  }
}

async function syncPlatform({ db, config, platform, logger }) {
  const startedAt = new Date().toISOString();
  const lockAcquired = await acquireSyncLock({
    db,
    platform,
    machineName: MACHINE_NAME,
    ttlMs: config.lockTtlMs ?? 600000,
  });

  if (!lockAcquired) {
    await logger.warn(`${platform}: skipped because another machine owns the sync lock`);
    await setSyncStatus({
      db,
      config,
      platform,
      status: {
        platform,
        status: 'locked',
        lastStartedAt: startedAt,
        lastFinishedAt: new Date().toISOString(),
        lastOk: true,
        error: '',
        machineName: MACHINE_NAME,
      },
    });
    return;
  }

  await setSyncStatus({
    db,
    config,
    platform,
    status: {
      platform,
      status: 'running',
      lastStartedAt: startedAt,
      machineName: MACHINE_NAME,
      lastOk: false,
      error: '',
    },
  });

  try {
    await logger.info(`${platform}: sync started`);
    const orders = await scrapePlatform(config, platform, logger);
    const upserted = await upsertOrders({ db, config, platform, orders, machineName: MACHINE_NAME });
    await setSyncStatus({
      db,
      config,
      platform,
      status: {
        platform,
        status: 'idle',
        lastStartedAt: startedAt,
        lastFinishedAt: new Date().toISOString(),
        lastOk: true,
        error: '',
        ordersSeen: orders.length,
        ordersUpserted: upserted,
        machineName: MACHINE_NAME,
      },
    });
    await logger.info(`${platform}: sync finished, seen=${orders.length}, upserted=${upserted}`);
  } catch (error) {
    await setSyncStatus({
      db,
      config,
      platform,
      status: {
        platform,
        status: 'error',
        lastStartedAt: startedAt,
        lastFinishedAt: new Date().toISOString(),
        lastOk: false,
        error: error.message,
        machineName: MACHINE_NAME,
      },
    });
    await logger.error(`${platform}: ${error.stack || error.message}`);
  } finally {
    await releaseSyncLock({ db, platform, machineName: MACHINE_NAME }).catch(() => {});
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  const config = await loadConfig();
  await ensureLocalDirs(config);
  const logger = createLogger(config);
  const platforms = resolvePlatforms(config, args.platforms);

  if (!platforms.length) {
    throw new Error('No valid platforms selected.');
  }

  if (args.login) {
    for (const platform of platforms) {
      await loginPlatform(config, platform, logger);
    }
    return;
  }

  const db = await initFirestore({ config, baseDir: BASE_DIR });
  do {
    for (const platform of platforms) {
      await syncPlatform({ db, config, platform, logger });
    }
    if (!args.once) {
      await logger.info(`Waiting ${config.intervalMs}ms before next sync.`);
      await sleep(config.intervalMs);
    }
  } while (!args.once);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
