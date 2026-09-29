import test from 'node:test';
import assert from 'node:assert/strict';

import { canPersistGoogleSession } from './google-auth.js';
import oauthStartHandler from './google-oauth-start.js';

function captureResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = JSON.parse(payload);
    },
  };
}

test('persists a Google session only when OAuth returned a refresh token', () => {
  assert.equal(canPersistGoogleSession({ refresh_token: 'refresh-token' }), true);
  assert.equal(canPersistGoogleSession({ access_token: 'access-token' }), false);
  assert.equal(canPersistGoogleSession(null), false);
});

test('returns a client error when OAuth redirectUri is not a URL', async () => {
  const response = captureResponse();

  await oauthStartHandler({
    method: 'POST',
    headers: { host: 'scan-to-sheet.example' },
    body: { redirectUri: 'not-a-url' },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'OAUTH_REDIRECT_INVALID');
});
