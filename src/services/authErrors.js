/**
 * Recognises the "your sign-in ran out" family of backend errors.
 *
 * Firestore uses `permission-denied` both when a session is absent and when an authenticated
 * request fails a rule. The scan boundary verifies Firebase Auth before writing, so a remaining
 * `permission-denied` is actionable as an authorization or data-validation problem rather than
 * incorrectly sending an already signed-in operator through another login.
 */

/** Stable code for branching and tests; the Thai text below is free to change. */
export const AUTH_SESSION_EXPIRED = 'AUTH_SESSION_EXPIRED';

export const AUTH_SESSION_EXPIRED_MESSAGE = 'เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่';

export const FIREBASE_AUTH_REQUIRED = 'FIREBASE_AUTH_REQUIRED';

export const FIREBASE_AUTH_REQUIRED_MESSAGE = 'เชื่อม Google แล้ว แต่ Firebase ยังยืนยันตัวตนไม่สำเร็จ จึงบันทึกข้อมูลไม่ได้ กรุณาแจ้งผู้ดูแลระบบ';

export const FIRESTORE_PERMISSION_DENIED_MESSAGE = 'ไม่มีสิทธิ์บันทึกข้อมูลใน Firebase กรุณาติดต่อผู้ดูแลระบบ';

const EXPIRED_CODES = [
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

export function createFirebaseAuthRequiredError() {
  return Object.assign(new Error(FIREBASE_AUTH_REQUIRED_MESSAGE), {
    code: FIREBASE_AUTH_REQUIRED,
  });
}

/**
 * API endpoints normally return their own Thai message. A proxy, timeout page, or malformed
 * response has no such payload, so keep the fallback safe for the status banner as well.
 */
export function apiResponseErrorMessage(payload, status) {
  const message = typeof payload?.error === 'string' ? payload.error.trim() : '';
  return message || `ระบบตอบกลับไม่สำเร็จ (รหัส ${status}) กรุณาลองใหม่`;
}

export function oauthCallbackErrorMessage(code) {
  return code === 'access_denied'
    ? 'ยกเลิกการเข้าสู่ระบบ Google แล้ว'
    : 'Google ไม่อนุมัติการเข้าสู่ระบบ กรุณาลองใหม่';
}

/**
 * สัญญาของระบบคือ throw ข้อความสรุปภาษาไทย แล้วเก็บ payload ดิบไว้ที่ `error.detail`
 * (ดู googleSheets.js) ฟังก์ชันนี้เป็นชั้นกันพลาด ไม่ใช่ตัวบังคับสัญญานั้น
 *
 * ด่านแรกเช็คว่ามีอักษรไทย ซึ่งกันข้อความของ provider ที่เป็นอังกฤษล้วนได้ แต่กันไม่ได้ถ้ามีคน
 * เขียน `throw new Error('ผิดพลาด: ' + JSON.stringify(body))` — ด่านที่สองจึงตัดข้อความที่มี
 * โครงสร้างของ payload เครื่อง (JSON, อาเรย์, เครื่องหมายคำพูด, แท็ก, URL) ซึ่งไม่เคยปรากฏใน
 * ข้อความที่เขียนให้ผู้ใช้อ่านเลยแม้แต่ข้อความเดียวในโปรเจกต์นี้
 *
 * ไม่ใช้กฎ "เลขติดกันยาว" เพราะเลขพัสดุมี 13 หลักและถูกฝังในข้อความให้ผู้ใช้อ่านอยู่จริง
 */
const MACHINE_PAYLOAD_PATTERN = /[{}[\]"<>]|https?:\/\//;

export function userErrorMessage(error, fallback = 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่') {
  const message = String(error?.message ?? '').trim();
  if (!/[ก-๙]/.test(message)) return fallback;
  if (MACHINE_PAYLOAD_PATTERN.test(message)) return fallback;
  return message;
}

/**
 * Message for a failed scan. Anything that is not an expired session keeps the error's own
 * message, which is where the existing Thai `throw new Error(...)` texts live.
 */
export function scanErrorMessage(error) {
  if (error?.code === FIREBASE_AUTH_REQUIRED) return FIREBASE_AUTH_REQUIRED_MESSAGE;
  if (isAuthExpiredError(error)) return AUTH_SESSION_EXPIRED_MESSAGE;
  if (String(error?.code ?? '').toLowerCase().includes('permission-denied')) {
    return FIRESTORE_PERMISSION_DENIED_MESSAGE;
  }
  return userErrorMessage(error, 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
}
