// Google documents a 60 requests/minute/user/project limit for both reads and writes.
// Keep the browser-wide Sheets queue at half that rate so reads used for verification do
// not consume the whole allowance while a burst of scans is still being drained.
export const SHEET_REQUEST_MIN_INTERVAL_MS = 2_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isSheetsApiRequest(url) {
  return String(url).startsWith('https://sheets.googleapis.com/v4/spreadsheets');
}

export function createSheetRequestScheduler({
  minIntervalMs = SHEET_REQUEST_MIN_INTERVAL_MS,
  now = () => Date.now(),
  sleep = defaultSleep,
} = {}) {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new RangeError('Invalid Sheets request interval');
  }

  let tail = Promise.resolve();
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  function schedule(task) {
    const run = tail.then(async () => {
      const waitMs = Math.max(0, minIntervalMs - (now() - lastStartedAt));
      if (waitMs > 0) await sleep(waitMs);
      lastStartedAt = now();
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
