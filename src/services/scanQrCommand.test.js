import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCourierQrCommand,
  createPackerQrCommand,
  parseScanQrCommand,
  resolveScanQrCommand,
} from './scanQrCommand.js';

test('creates and parses role-specific courier QR commands', () => {
  const command = createCourierQrCommand('admin', 'Shopee Drop Off');
  assert.equal(command, 'SCAN_TO_SHEET:1:ADMIN:COURIER:Shopee%20Drop%20Off');
  assert.deepEqual(parseScanQrCommand(command), {
    kind: 'courier', role: 'admin', courier: 'Shopee Drop Off',
  });
});

test('creates and parses a stable Packer staff QR command', () => {
  const command = createPackerQrCommand('staff/123');
  assert.equal(command, 'SCAN_TO_SHEET:1:PACKER:STAFF:staff%2F123');
  assert.deepEqual(parseScanQrCommand(command), {
    kind: 'packer', role: 'packer', staffId: 'staff/123',
  });
});

test('rejects malformed or unknown QR commands', () => {
  assert.equal(parseScanQrCommand('SCAN_TO_SHEET:2:ADMIN:COURIER:Shopee'), null);
  assert.equal(parseScanQrCommand('tracking-number'), null);
  assert.equal(parseScanQrCommand('SCAN_TO_SHEET:1:ADMIN:STAFF:abc'), null);
});

test('resolves only active, current couriers and Packer staff', () => {
  const courier = parseScanQrCommand(createCourierQrCommand('packer', 'Flash'));
  assert.deepEqual(resolveScanQrCommand(courier, { couriers: ['Shopee', 'Flash'] }), {
    kind: 'courier', role: 'packer', courier: 'Flash',
  });

  const staff = parseScanQrCommand(createPackerQrCommand('muk-id'));
  assert.deepEqual(resolveScanQrCommand(staff, {
    staff: [{ id: 'muk-id', nickname: 'มุก', active: true }],
  }), {
    kind: 'packer', role: 'packer', staffId: 'muk-id', packer: 'มุก',
  });
  assert.equal(resolveScanQrCommand(staff, {
    staff: [{ id: 'muk-id', nickname: 'มุก', active: false }],
  }), null);
});
