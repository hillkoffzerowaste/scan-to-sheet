// Google documents a 60 requests/minute/user/project limit for both reads and writes.
// Keep the browser-wide Sheets queue at half that rate so reads used for verification do
// not consume the whole allowance while a burst of scans is still being drained. A small
// token bucket lets one scan finish its first few dependent calls quickly, while the refill
// rate keeps sustained traffic at the same ceiling. The shared Redis gate in /api/sheet-lock
// remains the final strict 30-request rolling-minute limit across every browser and sheet.
export const SHEET_REQUEST_MIN_INTERVAL_MS = 2_000;
export const SHEET_REQUEST_BURST_SIZE = 3;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isSheetsApiRequest(url) {
  return String(url).startsWith('https://sheets.googleapis.com/v4/spreadsheets');
}

export function createSheetRequestScheduler({
  minIntervalMs = SHEET_REQUEST_MIN_INTERVAL_MS,
  burstCapacity = SHEET_REQUEST_BURST_SIZE,
  now = () => Date.now(),
  sleep = defaultSleep,
} = {}) {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new RangeError('Invalid Sheets request interval');
  }
  if (!Number.isInteger(burstCapacity) || burstCapacity < 1) {
    throw new RangeError('Invalid Sheets request burst capacity');
  }

  let tail = Promise.resolve();
  let availableTokens = burstCapacity;
  let lastRefillAt = now();

  function refillTokens() {
    if (minIntervalMs === 0) {
      availableTokens = burstCapacity;
      lastRefillAt = now();
      return;
    }

    const currentTime = now();
    const elapsed = Math.max(0, currentTime - lastRefillAt);
    if (elapsed > 0) {
      availableTokens = Math.min(
        burstCapacity,
        availableTokens + elapsed / minIntervalMs,
      );
      lastRefillAt = currentTime;
    }
  }

  async function waitForToken() {
    while (true) {
      refillTokens();
      if (availableTokens >= 1) {
        availableTokens -= 1;
        return;
      }

      const waitMs = Math.max(1, Math.ceil((1 - availableTokens) * minIntervalMs));
      await sleep(waitMs);
    }
  }

  function schedule(task) {
    const run = tail.then(async () => {
      await waitForToken();
      return task();
    });

    // A failed request must not reject the queue itself. The caller still receives the
    // original rejection through `run`, while later requests remain runnable.
    tail = run.catch(() => {});
    return run;
  }

  return { schedule };
}

// The app is a browser client. Node-based unit tests and server-side tooling should not
// wait two seconds per mocked API request; production browser execution always has window.
export const sheetRequestScheduler = createSheetRequestScheduler({
  minIntervalMs: typeof window === 'undefined' ? 0 : SHEET_REQUEST_MIN_INTERVAL_MS,
});

export function scheduleSheetRequest(task) {
  return sheetRequestScheduler.schedule(task);
}
