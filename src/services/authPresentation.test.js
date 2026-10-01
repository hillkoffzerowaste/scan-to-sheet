import assert from 'node:assert/strict';
import test from 'node:test';

import { getAuthPresentation } from './authPresentation.js';

test('offers Google sign-in when Firebase remains signed in but Sheet session is gone', () => {
  assert.deepEqual(getAuthPresentation({
    isSignedIn: true,
    isSheetConnected: false,
    isGoogleReady: true,
    user: { email: 'ยังไม่ได้เข้าสู่ระบบ' },
    firebaseUser: { email: 'online_marketing@hillkoff.com' },
  }), {
    displayEmail: 'online_marketing@hillkoff.com',
    showSignIn: true,
    showSignOut: true,
    signInLabel: 'เชื่อม Google ใหม่',
    signInDisabled: false,
  });
});

test('keeps the normal sign-in presentation when there is no authenticated user', () => {
  assert.deepEqual(getAuthPresentation({
    isSignedIn: false,
    isSheetConnected: false,
    isGoogleReady: true,
    user: { email: 'ยังไม่ได้เข้าสู่ระบบ' },
    firebaseUser: null,
  }), {
    displayEmail: 'ยังไม่ได้เข้าสู่ระบบ',
    showSignIn: true,
    showSignOut: false,
    signInLabel: 'เข้าสู่ระบบด้วย Google',
    signInDisabled: false,
  });
});
