/**
 * Recognises the "your sign-in ran out" family of backend errors.
 *
 * Every Firestore rule in this project is gated on `isSignedIn()`, so an expired token does not
 * fail as an auth error — it comes back as `permission-denied` on whatever the user happened to
 * do next. Raw, that reads as "Missing or insufficient permissions." in English on the scan
 * screen, and as nothing at all on the packing-video screen, which looks like a frozen app to a
 * packer who cannot act on either.
 */

/** Stable code for branching and tests; the Thai text below is free to change. */
export const AUTH_SESSION_EXPIRED = 'AUTH_SESSION_EXPIRED';

export const AUTH_SESSION_EXPIRED_MESSAGE = 'เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่';

const EXPIRED_CODES = [
  'permission-denied',
  'unauthenticated',
  'storage/unauthorized',
  'storage/unauthenticated',
  'auth/user-token-expired',
  'auth/id-token-expired',
];

export function isAuthExpiredError(error) {
  const code = String(error?.code ?? '').toLowerCase();
  return EXPIRED_CODES.some((candidate) => code.includes(candidate));
}

/**
 * Message for a failed scan. Anything that is not an expired session keeps the error's own
 * message, which is where the existing Thai `throw new Error(...)` texts live.
 */
export function scanErrorMessage(error) {
  if (isAuthExpiredError(error)) return AUTH_SESSION_EXPIRED_MESSAGE;
  return error?.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่';
}
