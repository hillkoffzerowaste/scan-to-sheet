import test from 'node:test';
import assert from 'node:assert/strict';

import { getCanonicalAppRedirect } from './canonicalApp.js';

const PRIMARY_APP_URL = 'https://scan-to-sheet-ten.vercel.app';

test('redirects Firebase Hosting to the primary Vercel origin and preserves safe navigation state', () => {
  assert.equal(
    getCanonicalAppRedirect({
      hostname: 'hillkoff-twin-oganization.web.app',
      pathname: '/scanner',
      search: '?courier=Flash&code=oauth-secret&error_description=private',
      hash: '#popup',
    }, PRIMARY_APP_URL),
    'https://scan-to-sheet-ten.vercel.app/scanner?courier=Flash#popup',
  );
});

test('does not redirect Vercel, local development, or an unsafe primary URL', () => {
  assert.equal(getCanonicalAppRedirect({ hostname: 'scan-to-sheet-ten.vercel.app' }, PRIMARY_APP_URL), null);
  assert.equal(getCanonicalAppRedirect({ hostname: 'localhost' }, PRIMARY_APP_URL), null);
  assert.equal(
    getCanonicalAppRedirect({ hostname: 'legacy.firebaseapp.com' }, 'http://scan-to-sheet-ten.vercel.app'),
    null,
  );
});
