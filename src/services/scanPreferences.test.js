import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SCAN_METHOD, getScanReadinessMessage, SCAN_READINESS } from './scanPreferences.js';

test('opens scanner controls in barcode gun mode by default', () => {
  assert.equal(DEFAULT_SCAN_METHOD, 'manual');
});

test('describes the scan readiness gate in Thai', () => {
  assert.equal(getScanReadinessMessage(SCAN_READINESS.CHECKING), 'กำลังตรวจสอบ session ก่อนเริ่มสแกน');
  assert.equal(getScanReadinessMessage(SCAN_READINESS.REAUTH_REQUIRED), 'ยังเริ่มสแกนไม่ได้ กรุณาออกจากระบบ แล้วเข้าสู่ระบบใหม่');
});
