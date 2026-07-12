#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { acquireSyncLock, initFirestore, releaseSyncLock, setSyncStatus, upsertOrders } from './firestore.js';
import { getPlatformConfig, getPlatformExtractorSource, listPlatformKeys } from './platforms.js';
import { normalizeOrder } from './normalize.js';

const BASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(BASE_DIR, 'config.json');
const EXAMPLE_CONFIG_PATH = path.join(BASE_DIR, 'config.example.json');
const MACHINE_NAME = os.hostname();
const RUN_TOKEN = `${MACHINE_NAME}:${randomUUID()}`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const loginIndex = args.indexOf('--login');
  const platformArg = loginIndex >= 0 ? args[loginIndex + 1] : null;
  if (args.includes('--concurrency')) {
    throw new Error('This worker uses one shared browser profile and only supports sequential sync.');
  }
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
  await mkdir(profilePath(config), { recursive: true });
  for (const key of ['logDir', 'screenshotsDir']) {
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

function createShutdownController(logger) {
  let activeContext = null;
  let closingContext = null;
  let signal = '';

  const closeActiveContext = async () => {
    const context = activeContext;
    if (!context || closingContext === context) {
      return;
    }
    closingContext = context;
    try {
      await context.close();
    } catch (error) {
      await logger.warn(`Failed to close Chromium context: ${error.message}`);
    } finally {
      if (activeContext === context) {
        activeContext = null;
      }
      closingContext = null;
    }
  };

  const handleSignal = (nextSignal) => {
    if (signal) {
      return;
    }
    signal = nextSignal;
    void logger.warn(`Received ${nextSignal}; closing the active Chromium context.`);
    void closeActiveContext();
  };

  const onSigint = () => handleSignal('SIGINT');
  const onSigterm = () => handleSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  return {
    setContext(context) {
      activeContext = context;
      if (signal) {
        void closeActiveContext();
      }
    },
    clearContext(context) {
      if (activeContext === context) {
        activeContext = null;
      }
    },
    markContextClosed(context) {
      if (activeContext === context) {
        activeContext = null;
        signal = signal || 'context-closed';
      }
    },
    isStopping: () => Boolean(signal),
    dispose() {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      return signal === 'SIGINT' ? 130 : 0;
    },
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

function profilePath(config) {
  // profilesDir is retained as a fallback for existing local config files.
  return path.resolve(BASE_DIR, config.profileDir ?? config.profilesDir ?? 'marketplace-profile');
}

async function openContext(config) {
  const profileDir = profilePath(config);
  await mkdir(profileDir, { recursive: true });
  return chromium.launchPersistentContext(profileDir, {
    headless: Boolean(config.headless),
    viewport: { width: 1440, height: 960 },
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
  });
}

async function createBrowserSession(config, contextController) {
  const context = await openContext(config);
  contextController.setContext(context);
  context.once('close', () => contextController.markContextClosed(context));
  return {
    context,
    pages: new Map(),
  };
}

async function closeBrowserSession(session, contextController) {
  await session.context.close().catch(() => {});
  contextController.clearContext(session.context);
}

async function getPlatformPage(session, platform) {
  const existing = session.pages.get(platform);
  if (existing && !existing.isClosed()) {
    return existing;
  }

  const page = session.pages.size === 0
    ? (session.context.pages()[0] ?? await session.context.newPage())
    : await session.context.newPage();
  session.pages.set(platform, page);
  return page;
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

function extractTrackingToken(text) {
  return String(text ?? '').match(/\b(?:TH|SPX|SPE|JNT|JT|KEX|LEX|BEST|FLASH|DHL|NINJA|NJV)(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,}\b/i)?.[0] ?? '';
}

async function extractTrackingFromDetail(page) {
  const texts = await page.locator(
    '[class*="tracking" i], [class*="awb" i], [class*="waybill" i], [class*="logistics" i], [id*="tracking" i], [data-testid*="tracking" i], body',
  ).allTextContents();
  for (const text of texts) {
    const trackingNo = extractTrackingToken(text);
    if (trackingNo) return trackingNo;
  }
  return '';
}

async function closeDetailPage({ listPage, detailPage, listUrl }) {
  if (detailPage !== listPage) {
    await detailPage.close().catch(() => {});
    return;
  }
  await listPage.keyboard.press('Escape').catch(() => {});
  if (!listPage.url().includes(listUrl)) {
    await listPage.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
}

async function enrichTrackingFromDetails({ config, platform, orders, page, listUrl, logger }) {
  if (!['tiktok', 'lazada'].includes(platform)) return orders;
  const candidates = [...new Map(
    orders.filter((order) => order.orderId && !order.trackingNo).map((order) => [order.orderId, order]),
  ).values()];
  const maxVisits = Number.parseInt(config.maxDetailPageVisits, 10) || 20;
  let enriched = 0;

  for (const order of candidates.slice(0, maxVisits)) {
    let detailPage = page;
    try {
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
      await page.waitForLoadState('networkidle', { timeout: config.orderLoadTimeoutMs }).catch(() => {});
      await waitForAnySelector(
        page,
        getPlatformConfig(platform).readySelectors,
        config.orderLoadTimeoutMs,
      );
      const orderLink = platform === 'tiktok'
        ? page.locator(`a[href*="/order/detail"][href*="order_no=${order.orderId}"]`).first()
        : page.getByText(String(order.orderId), { exact: false }).first();
      if (!(await orderLink.isVisible({ timeout: 3000 }).catch(() => false))) {
        await logger.warn(`${platform}: order ${order.orderId} is not visible for detail lookup.`);
        continue;
      }
      const popupPromise = page.waitForEvent('popup', { timeout: 2000 }).catch(() => null);
      await orderLink.click({ timeout: 5000 });
      detailPage = (await popupPromise) ?? page;
      await detailPage.waitForLoadState('domcontentloaded', { timeout: config.navigationTimeoutMs }).catch(() => {});
      await detailPage.waitForTimeout(1200);
      const trackingNo = await extractTrackingFromDetail(detailPage);
      if (trackingNo) {
        order.trackingNo = trackingNo;
        enriched += 1;
        await logger.info(`${platform}: tracking enriched for order ${order.orderId}`);
      }
    } catch (error) {
      await logger.warn(`${platform}: detail lookup failed for ${order.orderId}: ${error.message}`);
    } finally {
      await closeDetailPage({ listPage: page, detailPage, listUrl });
    }
  }
  await logger.info(`${platform}: detail tracking enriched=${enriched}/${Math.min(candidates.length, maxVisits)}`);
  return orders;
}

async function loginPlatforms(config, platforms, logger, contextController) {
  const platformConfigs = platforms.map((platform) => {
    const platformConfig = getPlatformConfig(platform);
    if (!platformConfig) {
      throw new Error(`Unknown platform: ${platform}`);
    }
    return platformConfig;
  });
  const profileDir = profilePath(config);
  await logger.info(`Opening one shared profile with ${platformConfigs.length} login tab(s): ${profileDir}`);
  const context = await openContext({ ...config, headless: false });
  contextController.setContext(context);
  const contextClosed = new Promise((resolve) => context.once('close', resolve));
  try {
    const firstPage = context.pages()[0] ?? await context.newPage();
    const pages = await Promise.all(platformConfigs.map((_, index) => (
      index === 0 ? firstPage : context.newPage()
    )));

    await Promise.all(platformConfigs.map(async (platformConfig, index) => {
      try {
        await pages[index].goto(platformConfig.orderListUrl ?? platformConfig.loginUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.navigationTimeoutMs,
        });
        await logger.info(`${platformConfig.label}: login tab is ready.`);
      } catch (error) {
        await logger.error(`${platformConfig.label}: login tab navigation failed: ${error.message}`);
      }
    }));

    await logger.info('All login tabs are open. Complete each login, then close the Chromium window.');
    await contextClosed;
  } finally {
    await context.close().catch(() => {});
    contextController.clearContext(context);
  }
}

async function scrapePlatform(config, platform, logger, session) {
  const platformConfig = getPlatformConfig(platform);
  if (!platformConfig) {
    throw new Error(`Unknown platform: ${platform}`);
  }

  const page = await getPlatformPage(session, platform);
  await page.goto(platformConfig.orderListUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.navigationTimeoutMs,
  });
  await page.waitForLoadState('networkidle', { timeout: config.orderLoadTimeoutMs }).catch(() => {});
  const matchedSelector = await waitForAnySelector(page, platformConfig.readySelectors, config.orderLoadTimeoutMs);
  if (!matchedSelector) {
    await logger.warn(`${platform}: no known order selector found. You may need to log in or tune selectors.`);
  }
  const listUrl = page.url();

  const currentUrl = page.url().toLowerCase();
  const loginDetected = currentUrl.includes('login')
    || currentUrl.includes('signin')
    || await page.locator('input[type="password"]').count() > 0;
  if (loginDetected) {
    const screenshotPath = path.resolve(BASE_DIR, config.screenshotsDir, `${platform}-login-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    await logger.warn(`${platform}: login is required. Screenshot saved: ${screenshotPath}`);
    return { orders: [], status: 'login_required' };
  }

  const rawOrders = await page.evaluate(({ extractorSource, platformKey, maxOrders }) => {
    const factory = new Function(`${extractorSource}\nreturn extractCards;`);
    const extractor = factory();
    return extractor({ platform: platformKey }).slice(0, maxOrders);
  }, {
    extractorSource: getPlatformExtractorSource(platform),
    platformKey: platform,
    maxOrders: config.maxOrdersPerPlatform,
  });

  if (!rawOrders.length) {
    const screenshotPath = path.resolve(BASE_DIR, config.screenshotsDir, `${platform}-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    await logger.warn(`${platform}: extracted 0 orders. Screenshot saved for selector tuning.`);
    return { orders: [], status: 'partial' };
  }

  const itemCount = rawOrders.reduce((sum, order) => sum + (Array.isArray(order.items) ? order.items.length : 0), 0);
  const skuCount = rawOrders.reduce(
    (sum, order) => sum + (Array.isArray(order.items) ? order.items.filter((item) => item?.sku).length : 0),
    0,
  );
  await logger.info(`${platform}: extracted=${rawOrders.length}, buyerNames=0, items=${itemCount}, skus=${skuCount}`);
  const orders = rawOrders.map((order) => normalizeOrder(order, platform));
  await enrichTrackingFromDetails({ config, platform, orders, page, listUrl, logger });
  return { orders, status: 'synced' };
}

async function syncPlatform({ db, config, platform, logger, session }) {
  const startedAt = new Date().toISOString();
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
    const result = await scrapePlatform(config, platform, logger, session);
    const upserted = await upsertOrders({ db, config, platform, orders: result.orders, machineName: MACHINE_NAME });
    await setSyncStatus({
      db,
      config,
      platform,
      status: {
        platform,
        status: result.status,
        lastStartedAt: startedAt,
        lastFinishedAt: new Date().toISOString(),
        lastOk: result.status === 'synced',
        error: '',
        ordersSeen: result.orders.length,
        ordersUpserted: upserted,
        machineName: MACHINE_NAME,
      },
    });
    await logger.info(`${platform}: sync finished with status=${result.status}, seen=${result.orders.length}, upserted=${upserted}`);
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
  const shutdownController = createShutdownController(logger);
  const platforms = resolvePlatforms(config, args.platforms);

  if (!platforms.length) {
    throw new Error('No valid platforms selected.');
  }

  const db = await initFirestore({ config, baseDir: BASE_DIR });
  if (args.login) {
    const lockAcquired = await acquireSyncLock({
      db,
      ownerToken: RUN_TOKEN,
      machineName: MACHINE_NAME,
      ttlMs: config.lockTtlMs ?? 600000,
    });
    if (!lockAcquired) {
      throw new Error('Another worker or login window owns the shared Chromium profile. Try again later.');
    }
    try {
      await loginPlatforms(config, platforms, logger, shutdownController);
    } finally {
      await releaseSyncLock({ db, ownerToken: RUN_TOKEN }).catch(() => {});
      const exitCode = shutdownController.dispose();
      if (exitCode) {
        process.exitCode = exitCode;
      }
    }
    return;
  }

  await logger.info(`Worker starting for ${platforms.join(', ')} with one shared Chromium profile`);
  const lockAcquired = await acquireSyncLock({
    db,
    ownerToken: RUN_TOKEN,
    machineName: MACHINE_NAME,
    ttlMs: config.lockTtlMs ?? 600000,
  });
  if (!lockAcquired) {
    await logger.warn('Sync skipped because another worker owns the shared Chromium profile.');
    shutdownController.dispose();
    return;
  }

  let session = null;
  try {
    session = await createBrowserSession(config, shutdownController);
    do {
      // Refresh the existing lock before each cycle while the browser stays open.
      const lockRefreshed = await acquireSyncLock({
        db,
        ownerToken: RUN_TOKEN,
        machineName: MACHINE_NAME,
        ttlMs: config.lockTtlMs ?? 600000,
      });
      if (!lockRefreshed) {
        throw new Error('Lost the shared Chromium profile lock.');
      }

      for (const platform of platforms) {
        if (shutdownController.isStopping()) {
          break;
        }
        await syncPlatform({ db, config, platform, logger, session });
      }
      if (shutdownController.isStopping()) {
        return;
      }
      if (!args.once) {
        await logger.info(`Waiting ${config.intervalMs}ms before next sync. Chromium stays open.`);
        await sleep(config.intervalMs);
      }
  } while (!args.once);
  } finally {
    if (session) {
      await closeBrowserSession(session, shutdownController);
    }
    await releaseSyncLock({ db, ownerToken: RUN_TOKEN }).catch(() => {});
    const exitCode = shutdownController.dispose();
    if (exitCode) {
      process.exitCode = exitCode;
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
