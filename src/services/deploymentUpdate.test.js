import test from 'node:test';
import assert from 'node:assert/strict';

import { getAppEntrypointPath, hasDeploymentUpdate } from './deploymentUpdate.js';

test('getAppEntrypointPath finds the Vite application entrypoint', () => {
  const html = [
    '<script type="module" src="/assets/vendor-abc.js"></script>',
    '<script type="module" crossorigin src="/assets/index-next-build.js"></script>',
  ].join('');

  assert.equal(
    getAppEntrypointPath(html, 'https://scan-to-sheet-ten.vercel.app/'),
    '/assets/index-next-build.js',
  );
});

test('hasDeploymentUpdate only reports a different application entrypoint', () => {
  const documentUrl = 'https://scan-to-sheet-ten.vercel.app/';
  const currentEntrypointUrl = 'https://scan-to-sheet-ten.vercel.app/assets/index-current-build.js';

  assert.equal(hasDeploymentUpdate({
    html: '<script type="module" src="/assets/index-current-build.js"></script>',
    documentUrl,
    currentEntrypointUrl,
  }), false);
  assert.equal(hasDeploymentUpdate({
    html: '<script type="module" src="/assets/index-new-build.js"></script>',
    documentUrl,
    currentEntrypointUrl,
  }), true);
});
