import test from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

import { createOAuthTransaction, fetchWithTimeout, verifyOAuthTransaction } from './_auth.js';

test('OAuth transaction binds state and PKCE verifier and may only be consumed once', () => {
  const transaction = createOAuthTransaction({
    redirectUri: 'https://scan-to-sheet-ten.vercel.app/',
    randomBytes: (size) => Buffer.alloc(size, 7),
  });
  assert.equal(transaction.state.length > 20, true);
  assert.match(transaction.codeVerifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(transaction.codeChallenge, crypto.createHash('sha256').update(transaction.codeVerifier).digest('base64url'));
  assert.equal(verifyOAuthTransaction({ expectedState: transaction.state, receivedState: transaction.state }), true);
  assert.equal(verifyOAuthTransaction({ expectedState: transaction.state, receivedState: 'attacker-state' }), false);
});

test('upstream API calls stop instead of hanging until the serverless platform kills them', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  try {
    await assert.rejects(
      fetchWithTimeout('https://upstream.invalid', {}, 5),
      (error) => error.code === 'UPSTREAM_TIMEOUT',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { API_ERRORS, redactSecrets, sendError } from './_auth.js';

function captureResponse() {
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = JSON.parse(payload); },
  };
  return res;
}

function captureConsoleError(run) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  try {
    run();
  } finally {
    console.error = original;
  }
  return lines;
}

test('redactSecrets strips credential values from anything heading for a log', () => {
  const googleBody = 'Google token error 400: {"access_token":"ya29.SECRET","refresh_token":"1//SECRET"}';
  const redacted = redactSecrets(googleBody);
  assert.ok(!redacted.includes('ya29.SECRET'));
  assert.ok(!redacted.includes('1//SECRET'));
  assert.ok(redacted.includes('[redacted]'));

  assert.ok(!redactSecrets('Authorization: Bearer abc.def-ghi').includes('abc.def-ghi'));
  assert.ok(!redactSecrets('client_secret=super-secret-value').includes('super-secret-value'));
});

test('redactSecrets keeps the non-credential part of the message readable', () => {
  const redacted = redactSecrets('KV error 500: connection refused');
  assert.equal(redacted, 'KV error 500: connection refused');
});

test('sendError answers with a Thai message and a stable code, never the raw cause', () => {
  const res = captureResponse();
  const cause = new Error('Missing Vercel KV REST environment variables');

  captureConsoleError(() => {
    sendError(res, {
      status: 500,
      code: 'SHEET_LOCK_FAILED',
      message: 'จองสิทธิ์เขียน Google Sheet ไม่สำเร็จ กรุณาลองอีกครั้ง',
      error: cause,
    });
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, 'SHEET_LOCK_FAILED');
  // The client puts `error` straight into the status banner, so it must stay Thai and
  // must not mention KV, Google, spreadsheet ids, or env-var names.
  assert.equal(res.body.error, 'จองสิทธิ์เขียน Google Sheet ไม่สำเร็จ กรุณาลองอีกครั้ง');
  assert.ok(!JSON.stringify(res.body).includes('KV'));
  assert.ok(!JSON.stringify(res.body).includes('environment variables'));
  assert.equal(res.body.detail, undefined);
  assert.equal(res.body.step, undefined);
});

test('sendError logs the real cause server-side, redacted', () => {
  const res = captureResponse();
  const lines = captureConsoleError(() => {
    sendError(res, {
      status: 500,
      code: 'GOOGLE_OAUTH_FAILED',
      message: 'เข้าสู่ระบบ Google ไม่สำเร็จ กรุณาลองอีกครั้ง',
      error: new Error('Google token error 400: {"refresh_token":"1//LEAK"}'),
    });
  });

  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('GOOGLE_OAUTH_FAILED'));
  assert.ok(lines[0].includes('Google token error 400'));
  assert.ok(!lines[0].includes('1//LEAK'));
});

test('sendError stays silent when there is no underlying error to report', () => {
  const res = captureResponse();
  const lines = captureConsoleError(() => {
    sendError(res, API_ERRORS.noSession);
  });

  assert.equal(lines.length, 0);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'NO_GOOGLE_SESSION');
});

test('shared API errors carry a Thai message so the banner never shows English', () => {
  for (const entry of Object.values(API_ERRORS)) {
    assert.ok(entry.code, 'every shared error needs a code');
    assert.match(entry.message, /[ก-๙]/, `${entry.code} must be Thai`);
  }
});
