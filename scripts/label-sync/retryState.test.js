import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const codePath = path.resolve(TEST_DIR, '../../apps-script/label-sync/Code.gs');

// Code.gs only touches Apps Script services inside function bodies, so evaluating the file
// in a bare context exposes the pure retry helpers without any of Drive/Properties.
function loadCode() {
  // Fail loudly rather than returning {}. A silent skip is what let a second, untested
  // copy of Code.gs sit in scripts/ and drift from the one that actually deploys.
  if (!existsSync(codePath)) throw new Error(`Missing ${codePath}`);
  const context = {};
  vm.runInNewContext(readFileSync(codePath, 'utf8'), context, { filename: codePath });
  return context;
}

const MINUTE = 60 * 1000;
const NOW = 1_800_000_000_000;
const MODIFIED = '2026-08-12T03:00:00.000Z';

test('a file never seen before is processed', () => {
  const { shouldProcessFile_, fileStateEntry_ } = loadCode();
  assert.equal(shouldProcessFile_(fileStateEntry_(undefined), MODIFIED, NOW), true);
});

test('a finished file is not re-read until Drive says it changed', () => {
  const { shouldProcessFile_, fileStateEntry_ } = loadCode();
  const done = fileStateEntry_({ modifiedAt: MODIFIED, status: 'done', attempts: 0, nextRetryAt: 0 });

  assert.equal(shouldProcessFile_(done, MODIFIED, NOW), false);
  assert.equal(shouldProcessFile_(done, '2026-08-12T04:00:00.000Z', NOW), true);
});

test('state written by the pre-retry version is read as finished, not re-OCRd', () => {
  const { shouldProcessFile_, fileStateEntry_ } = loadCode();
  // V1 stored a bare modifiedAt string.
  const legacy = fileStateEntry_(MODIFIED);

  assert.equal(legacy.status, 'done');
  assert.equal(shouldProcessFile_(legacy, MODIFIED, NOW), false);
});

test('an unmatched label keeps the file queued instead of marking it processed', () => {
  const { summarizeFileOutcome_, nextFileState_, shouldProcessFile_ } = loadCode();

  // The label arrived before the order row was scanned — the case that used to be lost.
  const outcome = summarizeFileOutcome_([
    { status: 'updated', matchedRows: 1, errorCode: '' },
    { status: 'unmatched', matchedRows: 0, errorCode: 'order_not_found' },
  ]);
  assert.equal(outcome, 'retry');

  const next = nextFileState_(null, { modifiedAt: MODIFIED, outcome: outcome, nowMs: NOW });
  assert.equal(next.status, 'retry');
  assert.equal(next.attempts, 1);
  assert.equal(next.nextRetryAt, NOW + (15 * MINUTE));

  // Not due yet, then due.
  assert.equal(shouldProcessFile_(next, MODIFIED, NOW + MINUTE), false);
  assert.equal(shouldProcessFile_(next, MODIFIED, NOW + (15 * MINUTE)), true);
});

test('a file whose labels all landed is marked done', () => {
  const { summarizeFileOutcome_, nextFileState_ } = loadCode();

  assert.equal(summarizeFileOutcome_([{ status: 'updated' }, { status: 'updated' }]), 'done');
  const next = nextFileState_(
    { modifiedAt: MODIFIED, status: 'retry', attempts: 3, nextRetryAt: NOW },
    { modifiedAt: MODIFIED, outcome: 'done', nowMs: NOW },
  );
  // Objects come back from the vm realm, so compare structurally, not by prototype.
  assert.deepEqual({ ...next }, { modifiedAt: MODIFIED, status: 'done', attempts: 0, nextRetryAt: 0 });
});

test('a file that produced no label at all is retried, not silently accepted', () => {
  const { summarizeFileOutcome_ } = loadCode();
  assert.equal(summarizeFileOutcome_([]), 'retry');
  assert.equal(summarizeFileOutcome_(null), 'retry');
});

test('backoff widens and stops at the daily ceiling', () => {
  const { nextFileState_, LABEL_SYNC } = loadCode();

  let entry = null;
  const delays = [];
  for (let attempt = 0; attempt < LABEL_SYNC.maxRetryAttempts; attempt += 1) {
    entry = nextFileState_(entry, { modifiedAt: MODIFIED, outcome: 'retry', nowMs: NOW });
    delays.push((entry.nextRetryAt - NOW) / MINUTE);
  }

  assert.deepEqual(delays, [15, 30, 60, 120, 240, 480]);
  assert.ok(delays.every((delay) => delay <= LABEL_SYNC.maxRetryMinutes));
});

test('retrying stops after the attempt budget so OCR is not re-run forever', () => {
  const { nextFileState_, shouldProcessFile_, LABEL_SYNC } = loadCode();

  let entry = null;
  for (let attempt = 0; attempt < LABEL_SYNC.maxRetryAttempts; attempt += 1) {
    entry = nextFileState_(entry, { modifiedAt: MODIFIED, outcome: 'retry', nowMs: NOW });
  }

  assert.equal(entry.attempts, LABEL_SYNC.maxRetryAttempts);
  assert.equal(entry.status, 'gave_up');
  // Even long after the backoff elapsed, an exhausted file stays put...
  assert.equal(shouldProcessFile_(entry, MODIFIED, NOW + (365 * 24 * 60 * MINUTE)), false);
  // ...unless the file itself changes, which is a fresh case.
  assert.equal(shouldProcessFile_(entry, '2026-08-13T03:00:00.000Z', NOW), true);
});

test('editing the file resets the attempt budget', () => {
  const { nextFileState_ } = loadCode();
  const exhausted = { modifiedAt: MODIFIED, status: 'gave_up', attempts: 6, nextRetryAt: NOW };

  const next = nextFileState_(exhausted, {
    modifiedAt: '2026-08-13T03:00:00.000Z',
    outcome: 'retry',
    nowMs: NOW,
  });

  assert.equal(next.attempts, 1);
  assert.equal(next.status, 'retry');
});

test('the run budgets are small enough to finish inside an Apps Script execution', () => {
  // State is persisted only after the file loop, so a run killed at the 6-minute ceiling threw
  // away everything it had done and re-OCR'd every file next time. The budget has to stop the
  // loop before Apps Script stops the script.
  const { LABEL_SYNC } = loadCode();
  const APPS_SCRIPT_LIMIT_MS = 6 * 60 * 1000;
  assert.ok(
    LABEL_SYNC.runBudgetMs < APPS_SCRIPT_LIMIT_MS,
    'run budget must leave room to write state and logs before the hard limit',
  );
  assert.ok(APPS_SCRIPT_LIMIT_MS - LABEL_SYNC.runBudgetMs >= 60 * 1000, 'leave at least a minute');
  assert.ok(LABEL_SYNC.maxFilesPerRun > 0);
});

test('the state cap covers more files than the candidate window can hold', () => {
  // A file inside the lookback window with no state entry gets OCR'd from scratch, for ever.
  // At 500 entries and warehouse volume that happened within days.
  const { LABEL_SYNC } = loadCode();
  const busyDayFiles = 500;
  assert.ok(
    LABEL_SYNC.maxStateEntries >= busyDayFiles * LABEL_SYNC.defaultFileLookbackDays / 3,
    'state cap is too small for the default file lookback window',
  );
});

test('the retry backoff never exceeds its declared ceiling', () => {
  const { nextFileState_, LABEL_SYNC } = loadCode();
  let entry = { modifiedAt: MODIFIED, status: 'retry', attempts: 0, nextRetryAt: 0 };
  for (let index = 0; index < LABEL_SYNC.maxRetryAttempts; index += 1) {
    entry = nextFileState_(entry, { modifiedAt: MODIFIED, outcome: 'retry', nowMs: NOW });
    assert.ok(entry.nextRetryAt - NOW <= LABEL_SYNC.maxRetryMinutes * MINUTE);
  }
  assert.equal(entry.status, 'gave_up');
});
