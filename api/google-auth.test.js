import test from 'node:test';
import assert from 'node:assert/strict';

import { canPersistGoogleSession } from './google-auth.js';

test('persists a Google session only when OAuth returned a refresh token', () => {
  assert.equal(canPersistGoogleSession({ refresh_token: 'refresh-token' }), true);
  assert.equal(canPersistGoogleSession({ access_token: 'access-token' }), false);
  assert.equal(canPersistGoogleSession(null), false);
});
