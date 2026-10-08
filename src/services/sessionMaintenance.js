export const GOOGLE_SHEET_MAINTENANCE_DELAY_MS = 30_000;
export const GOOGLE_SESSION_EXPIRED = 'GOOGLE_SESSION_EXPIRED';
export const GOOGLE_SESSION_EXPIRED_MESSAGE = 'เซสชัน Google หมดอายุ กรุณาเชื่อม Google ใหม่';

export function createGoogleSessionExpiredError(cause) {
  return Object.assign(new Error(GOOGLE_SESSION_EXPIRED_MESSAGE), {
    code: GOOGLE_SESSION_EXPIRED,
    status: 401,
    cause,
  });
}

export function isGoogleAuthError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    message.includes('401')
    || message.includes('invalid authentication')
    || message.includes('invalid credentials')
    || message.includes('unauthorized')
    || (message.includes('google api error 403') && message.includes('permission_denied'))
  );
}

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
