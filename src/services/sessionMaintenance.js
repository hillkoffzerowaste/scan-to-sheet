export const GOOGLE_SHEET_MAINTENANCE_DELAY_MS = 30_000;

export function scheduleDeferredGoogleSheetMaintenance(task, {
  delayMs = GOOGLE_SHEET_MAINTENANCE_DELAY_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  onError = () => {},
} = {}) {
  const timerId = setTimeoutFn(() => {
    Promise.resolve()
      .then(task)
      .catch(onError);
  }, delayMs);

  return () => clearTimeoutFn(timerId);
}
