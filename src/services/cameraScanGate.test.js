import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraScanGate } from './cameraScanGate.js';

test('stationary camera frames never count as another physical submission even after cooldown', () => {
  const gate = createCameraScanGate({ rearmAfterMs: 800 });
  assert.equal(gate.detect('TH123', 0), true);
  assert.equal(gate.detect('TH123', 5000), false);
  gate.miss(5300);
  assert.equal(gate.detect('TH123', 5400), false);
  gate.miss(6300);
  assert.equal(gate.detect('TH123', 6400), true);
  assert.equal(gate.detect('TH456', 6500), true);
});
