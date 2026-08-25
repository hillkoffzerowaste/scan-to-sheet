import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PACKING_STATE,
  RECORD_OUTCOME,
  initialPackingState,
  reducePackingSession,
  shouldBlockScan,
} from './packingSessionMachine.js';

const effectTypes = (state) => state.effects.map((effect) => effect.type);

/** Drives the machine through a list of events, returning the final state. */
const run = (events, from = initialPackingState) =>
  events.reduce((state, event) => reducePackingSession(state, event), from);

const started = () =>
  reducePackingSession(initialPackingState, { type: 'START_SESSION', station: 'PACK-A', packer: 'มิ้ว' });

const recording = (tracking = 'TH111') =>
  run(
    [
      { type: 'SCAN', tracking },
      { type: 'LOOKUP_OK', order: { orderId: 'A1' }, history: [] },
      { type: 'RECORDER_READY', startedAt: new Date('2026-08-15T07:30:25Z') },
    ],
    started(),
  );

test('START_SESSION without both a station and a packer refuses to open the scanner', () => {
  const state = reducePackingSession(initialPackingState, { type: 'START_SESSION', station: 'PACK-A', packer: '' });
  assert.equal(state.status, PACKING_STATE.setup);
  assert.deepEqual(effectTypes(state), ['showError']);
  assert.equal(state.effects[0].code, 'PACKING_VIDEO_SETUP_INCOMPLETE');
});

test('START_SESSION persists the choice and moves to idle', () => {
  const state = started();
  assert.equal(state.status, PACKING_STATE.idle);
  assert.equal(state.station, 'PACK-A');
  assert.deepEqual(effectTypes(state), ['persistPreferences', 'probeCamera', 'focusScanInput']);
});

test('a scan from idle starts a lookup', () => {
  const state = reducePackingSession(started(), { type: 'SCAN', tracking: 'TH123' });
  assert.equal(state.status, PACKING_STATE.searching);
  assert.deepEqual(effectTypes(state), ['lookupOrder']);
  assert.equal(state.effects[0].tracking, 'TH123');
});

test('an unknown tracking number never starts the camera', () => {
  const state = run([{ type: 'SCAN', tracking: 'TH404' }, { type: 'LOOKUP_EMPTY' }], started());
  assert.equal(state.status, PACKING_STATE.notFound);
  assert.ok(!effectTypes(state).includes('startRecording'));
});

test('a lookup failure is reported with its own code and still does not record', () => {
  const state = run(
    [{ type: 'SCAN', tracking: 'TH1' }, { type: 'LOOKUP_ERROR', code: 'PACKING_VIDEO_OFFLINE_LOOKUP' }],
    started(),
  );
  assert.equal(state.status, PACKING_STATE.notFound);
  assert.equal(state.errorCode, 'PACKING_VIDEO_OFFLINE_LOOKUP');
  assert.ok(!effectTypes(state).includes('startRecording'));
});

test('a tracking number with history stops for the packer to choose', () => {
  const state = run(
    [{ type: 'SCAN', tracking: 'TH1' }, { type: 'LOOKUP_OK', order: { orderId: 'A1' }, history: [{ videoId: 'pv_old' }] }],
    started(),
  );
  assert.equal(state.status, PACKING_STATE.duplicatePrompt);
  assert.deepEqual(state.effects, []);
});

test('scanning while the duplicate dialog is open is ignored', () => {
  const prompt = run(
    [{ type: 'SCAN', tracking: 'TH1' }, { type: 'LOOKUP_OK', order: null, history: [{ videoId: 'pv_old' }] }],
    started(),
  );
  const after = reducePackingSession(prompt, { type: 'SCAN', tracking: 'TH999' });
  assert.equal(after.status, PACKING_STATE.duplicatePrompt);
  assert.equal(after.tracking, 'TH1');
  assert.deepEqual(after.effects, []);
  assert.equal(shouldBlockScan(prompt), true);
});

test('the duplicate dialog buttons pick the recording mode', () => {
  const prompt = run(
    [{ type: 'SCAN', tracking: 'TH1' }, { type: 'LOOKUP_OK', order: null, history: [{ videoId: 'pv_old' }] }],
    started(),
  );

  const continued = reducePackingSession(prompt, { type: 'DUP_CONTINUE' });
  assert.equal(continued.status, PACKING_STATE.starting);
  assert.equal(continued.effects[0].mode, 'continue');
  assert.equal(continued.effects[0].linkTo, 'pv_old');

  assert.equal(reducePackingSession(prompt, { type: 'DUP_RERECORD' }).effects[0].mode, 'rerecord');

  const cancelled = reducePackingSession(prompt, { type: 'DUP_CANCEL' });
  assert.equal(cancelled.status, PACKING_STATE.idle);
  assert.equal(cancelled.tracking, '');
});

test('scanning a new label while recording finalizes the current clip and queues the next', () => {
  const state = reducePackingSession(recording('TH111'), { type: 'SCAN', tracking: 'TH222' });
  assert.equal(state.status, PACKING_STATE.finalizing);
  assert.equal(state.outcome, RECORD_OUTCOME.completed);
  assert.equal(state.pendingScan, 'TH222');
  assert.deepEqual(effectTypes(state), ['stopRecorder']);
});

test('re-reading the label already being recorded is ignored', () => {
  const state = reducePackingSession(recording('TH-111'), { type: 'SCAN', tracking: 'th 111' });
  assert.equal(state.status, PACKING_STATE.recording);
  assert.deepEqual(state.effects, []);
});

test('a queued scan reopens straight into a lookup without idling first', () => {
  const state = run(
    [
      { type: 'SCAN', tracking: 'TH222' },
      { type: 'RECORDER_STOPPED', blob: 'blob', durationMs: 1000, mimeType: 'video/webm' },
    ],
    recording('TH111'),
  );
  assert.equal(state.status, PACKING_STATE.searching);
  assert.equal(state.tracking, 'TH222');
  assert.equal(state.pendingScan, '');
  assert.deepEqual(effectTypes(state), ['handOff', 'lookupOrder']);
  // Hand-off is declared before the lookup so the old clip is stored, not awaited.
  assert.equal(state.effects[0].outcome, RECORD_OUTCOME.completed);
});

test('stopping with nothing queued returns to idle', () => {
  const state = run(
    [{ type: 'PACK_DONE' }, { type: 'RECORDER_STOPPED', blob: 'blob', durationMs: 1000 }],
    recording('TH111'),
  );
  assert.equal(state.status, PACKING_STATE.idle);
  assert.equal(state.tracking, '');
  assert.deepEqual(effectTypes(state), ['handOff', 'focusScanInput']);
});

test('an incomplete recording is carried to the hand-off, not silently dropped', () => {
  // The recorder knows when a chunk failed to reach IndexedDB, but that flag reached nobody:
  // the hand-off was built from the event without it, so a clip short in the middle was queued
  // as an ordinary pending_upload and looked exactly like a whole one.
  const short = run(
    [{ type: 'PACK_DONE' }, { type: 'RECORDER_STOPPED', blob: 'blob', complete: false }],
    recording('TH111'),
  );
  assert.equal(short.effects[0].type, 'handOff');
  assert.equal(short.effects[0].complete, false);

  // Whole recordings, and events that say nothing about it, stay complete.
  const whole = run(
    [{ type: 'PACK_DONE' }, { type: 'RECORDER_STOPPED', blob: 'blob', complete: true }],
    recording('TH111'),
  );
  assert.equal(whole.effects[0].complete, true);
  const silent = run(
    [{ type: 'PACK_DONE' }, { type: 'RECORDER_STOPPED', blob: 'blob' }],
    recording('TH111'),
  );
  assert.equal(silent.effects[0].complete, true);
});

test('"บันทึกใหม่" stores the discarded clip then re-scans the same parcel', () => {
  const restarted = reducePackingSession(recording('TH111'), { type: 'RESTART' });
  assert.equal(restarted.outcome, RECORD_OUTCOME.discarded);
  assert.equal(restarted.pendingScan, 'TH111');

  const after = reducePackingSession(restarted, { type: 'RECORDER_STOPPED', blob: 'blob' });
  assert.equal(after.status, PACKING_STATE.searching);
  assert.equal(after.tracking, 'TH111');
});

test('losing the camera keeps whatever was recorded instead of discarding it', () => {
  const state = reducePackingSession(recording(), { type: 'CAMERA_LOST' });
  assert.equal(state.status, PACKING_STATE.finalizing);
  assert.equal(state.outcome, RECORD_OUTCOME.interrupted);
  assert.deepEqual(effectTypes(state), ['stopRecorder']);
});

test('the auto-stop limit finalizes with its own outcome', () => {
  const state = reducePackingSession(recording(), { type: 'AUTO_STOP_LIMIT' });
  assert.equal(state.outcome, RECORD_OUTCOME.autostop);
});

test('cancelling still hands the clip off rather than dropping it', () => {
  const state = reducePackingSession(recording(), { type: 'CANCEL' });
  assert.equal(state.outcome, RECORD_OUTCOME.cancelled);
  assert.deepEqual(effectTypes(state), ['stopRecorder']);
});

test('a failed stop reports a code and clears the pending scan', () => {
  const state = run(
    [{ type: 'SCAN', tracking: 'TH222' }, { type: 'RECORDER_STOP_FAILED' }],
    recording('TH111'),
  );
  assert.equal(state.status, PACKING_STATE.idle);
  assert.equal(state.errorCode, 'PACKING_VIDEO_FINALIZE_FAILED');
  assert.equal(state.pendingScan, '');
});

test('leaving the mode mid-recording finalizes first', () => {
  const state = reducePackingSession(recording(), { type: 'CLOSE_SESSION' });
  assert.equal(state.status, PACKING_STATE.finalizing);
  assert.equal(state.outcome, RECORD_OUTCOME.interrupted);
});

test('a camera failure can be retried', () => {
  const failed = run(
    [
      { type: 'SCAN', tracking: 'TH1' },
      { type: 'LOOKUP_OK', order: null, history: [] },
      { type: 'CAMERA_FAILED', code: 'PACKING_VIDEO_CAMERA_BUSY' },
    ],
    started(),
  );
  assert.equal(failed.status, PACKING_STATE.cameraError);
  const retried = reducePackingSession(failed, { type: 'RETRY' });
  assert.equal(retried.status, PACKING_STATE.starting);
  assert.deepEqual(effectTypes(retried), ['startRecording']);
});

test('the reducer is pure: same input, same output, no mutation', () => {
  const before = recording('TH111');
  const snapshot = JSON.stringify(before);
  const first = reducePackingSession(before, { type: 'PACK_DONE' });
  const second = reducePackingSession(before, { type: 'PACK_DONE' });
  assert.equal(JSON.stringify(before), snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test('unknown events clear stale effects instead of replaying them', () => {
  const withEffects = reducePackingSession(started(), { type: 'SCAN', tracking: 'TH1' });
  assert.ok(withEffects.effects.length > 0);
  assert.deepEqual(reducePackingSession(withEffects, { type: 'NOPE' }).effects, []);
});
