import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAppServer } from '../server.js';

async function withServer(options, run) {
  const server = createAppServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function postChunked(baseUrl, pathname, chunks) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (response) => {
      const received = [];
      response.on('data', (chunk) => received.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(received).toString('utf8'),
      }));
    });
    request.on('error', reject);
    chunks.forEach((chunk) => request.write(chunk));
    request.end();
  });
}

test('serves the app entry point for the remote SPA route', async () => {
  const staticDir = await mkdtemp(path.join(os.tmpdir(), 'scan-to-sheet-server-'));
  try {
    await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>app</title>');

    await withServer({ staticDir, apiHandlers: new Map() }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/remote`);

      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(await response.text(), '<!doctype html><title>app</title>');
    });
  } finally {
    await rm(staticDir, { recursive: true, force: true });
  }
});

test('serves files from the build output', async () => {
  const staticDir = await mkdtemp(path.join(os.tmpdir(), 'scan-to-sheet-server-'));
  try {
    await mkdir(path.join(staticDir, 'assets'));
    await writeFile(path.join(staticDir, 'assets', 'app.js'), 'export default 1;');

    await withServer({ staticDir, apiHandlers: new Map() }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/assets/app.js`);

      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /javascript/);
      assert.equal(await response.text(), 'export default 1;');
    });
  } finally {
    await rm(staticDir, { recursive: true, force: true });
  }
});

test('dispatches API requests and parses JSON request bodies', async () => {
  let receivedBody;
  const apiHandlers = new Map([
    ['/api/test', async (req, res) => {
      receivedBody = req.body;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    }],
  ]);

  await withServer({ apiHandlers }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', count: 2 }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(receivedBody, { action: 'save', count: 2 });
  });
});

test('rejects malformed JSON without exposing parser details', async () => {
  await withServer({
    apiHandlers: new Map([
      ['/api/test', async (_req, res) => {
        res.statusCode = 200;
        res.end('{}');
      }],
    ]),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.code, 'INVALID_JSON_BODY');
    assert.equal(payload.error, 'คำขอไม่ถูกต้อง กรุณาลองอีกครั้ง');
    assert.equal(payload.detail, undefined);
  });
});

test('returns JSON 413 for an oversized chunked body without dropping the connection', async () => {
  await withServer({
    apiHandlers: new Map([
      ['/api/test', async (_req, res) => {
        res.statusCode = 200;
        res.end('{}');
      }],
    ]),
  }, async (baseUrl) => {
    const response = await postChunked(baseUrl, '/api/test', [
      Buffer.from('{"data":"'),
      Buffer.alloc(1024 * 1024, 97),
      Buffer.from('"}'),
    ]);
    const payload = JSON.parse(response.body);

    assert.equal(response.status, 413);
    assert.equal(payload.code, 'REQUEST_BODY_TOO_LARGE');
    assert.equal(payload.error, 'คำขอมีขนาดใหญ่เกินไป');
  });
});

test('honors a custom JSON body limit', async () => {
  await withServer({
    maxBodyBytes: 8,
    apiHandlers: new Map([
      ['/api/test', async (_req, res) => {
        res.statusCode = 200;
        res.end('{}');
      }],
    ]),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'more than eight bytes' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 413);
    assert.equal(payload.code, 'REQUEST_BODY_TOO_LARGE');
  });
});

test('returns the existing Thai no-session response from an API handler', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/google-token`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.code, 'NO_GOOGLE_SESSION');
    assert.match(payload.error, /เซสชัน Google/);
  });
});

test('returns JSON 404 for unknown API paths', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/missing`);
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.equal(payload.code, 'API_ROUTE_NOT_FOUND');
    assert.match(payload.error, /ไม่พบ API/);
  });
});
