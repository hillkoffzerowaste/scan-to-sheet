import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_SESSION_EXPIRED_MESSAGE,
  FIREBASE_AUTH_REQUIRED,
  FIREBASE_AUTH_REQUIRED_MESSAGE,
  FIRESTORE_PERMISSION_DENIED_MESSAGE,
  createFirebaseAuthRequiredError,
  isAuthExpiredError,
  scanErrorMessage,
} from './authErrors.js';

test('an expired session is recognised however the backend words it', () => {
  // Firestore reports an expired token as a rules rejection, because every rule here is
  // gated on isSignedIn() rather than on the token itself. A plain permission-denied can
  // also be a valid session that is blocked by a rule, so it must not prescribe a re-login.
  assert.equal(isAuthExpiredError({ code: 'permission-denied' }), false);
  assert.equal(isAuthExpiredError({ code: 'unauthenticated' }), true);
  assert.equal(isAuthExpiredError({ code: 'storage/unauthorized' }), true);
  assert.equal(isAuthExpiredError({ code: 'auth/user-token-expired' }), true);
});

test('ordinary failures are not mistaken for a lost session', () => {
  assert.equal(isAuthExpiredError({ code: 'GOOGLE_TIMEOUT' }), false);
  assert.equal(isAuthExpiredError({ code: 'failed-precondition' }), false);
  assert.equal(isAuthExpiredError({}), false);
  assert.equal(isAuthExpiredError(null), false);
});

test('an expired session gets the sign-in-again message', () => {
  assert.equal(
    scanErrorMessage({ code: 'unauthenticated', message: 'Missing or insufficient permissions.' }),
    AUTH_SESSION_EXPIRED_MESSAGE,
  );
});

test('a denied Firestore write is not misreported as an expired session', () => {
  assert.equal(
    scanErrorMessage({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }),
    FIRESTORE_PERMISSION_DENIED_MESSAGE,
  );
});

test('a missing Firebase session has a safe, actionable error code and message', () => {
  const error = createFirebaseAuthRequiredError();
  assert.equal(error.code, FIREBASE_AUTH_REQUIRED);
  assert.equal(scanErrorMessage(error), FIREBASE_AUTH_REQUIRED_MESSAGE);
});

test('every other error keeps its own Thai message', () => {
  assert.equal(scanErrorMessage({ code: 'GOOGLE_TIMEOUT', message: 'เชื่อมต่อ Google ไม่สำเร็จ' }), 'เชื่อมต่อ Google ไม่สำเร็จ');
  assert.equal(scanErrorMessage({}), 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
});
