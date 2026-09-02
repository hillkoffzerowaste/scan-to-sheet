export const DEFAULT_SCAN_METHOD = 'manual';

export const SCAN_READINESS = Object.freeze({
  SIGNED_OUT: 'signed_out',
  CHECKING: 'checking',
  READY: 'ready',
  REAUTH_REQUIRED: 'reauth_required',
});

export function getScanReadinessMessage(readiness) {
  if (readiness === SCAN_READINESS.CHECKING) {
    return 'กำลังตรวจสอบ session ก่อนเริ่มสแกน';
  }
  if (readiness === SCAN_READINESS.REAUTH_REQUIRED) {
    return 'ยังเริ่มสแกนไม่ได้ กรุณาออกจากระบบ แล้วเข้าสู่ระบบใหม่';
  }
  return 'Login with Google ก่อนเริ่มสแกน';
}
