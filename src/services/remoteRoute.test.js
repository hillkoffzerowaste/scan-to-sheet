import test from 'node:test';
import assert from 'node:assert/strict';

import { isRemoteRoute } from './remoteRoute.js';

test('only the remote path itself opens the remote tree', () => {
  assert.equal(isRemoteRoute({ pathname: '/remote' }), true);
  assert.equal(isRemoteRoute({ pathname: '/remote/' }), true);
  // The OAuth callback comes back with a query string and must still be the remote screen.
  assert.equal(isRemoteRoute({ pathname: '/remote', search: '?code=abc&state=xyz' }), true);
});

test('every other path keeps the desktop app', () => {
  for (const pathname of ['/', '/remotely', '/remote-setup', '/api/remote', '/REMOTE', '']) {
    assert.equal(isRemoteRoute({ pathname }), false, `${pathname} must not open the remote tree`);
  }
  assert.equal(isRemoteRoute(undefined), false);
});
