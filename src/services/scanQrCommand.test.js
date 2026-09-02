import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCourierQrCommand,
  createPackerQrCommand,
  getScanQrAnnouncement,
  parseScanQrCommand,
  resolveScanQrName,
  resolveScanQrCommand,
} from './scanQrCommand.js';

test('creates and parses role-specific courier QR commands', () => {
  const command = createCourierQrCommand('admin', 'Shopee Drop Off');
  assert.equal(command, 'SCAN_TO_SHEET:1:ADMIN:COURIER:Shopee%20Drop%20Off');
  assert.deepEqual(parseScanQrCommand(command), {
    kind: 'courier', role: 'admin', courier: 'Shopee Drop Off',
  });
  assert.deepEqual(parseScanQrCommand(command.toLowerCase()), {
    kind: 'courier', role: 'admin', courier: 'shopee drop off',
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

test('resolves plain courier and Packer names from name-only QR labels', () => {
  assert.deepEqual(resolveScanQrName(' Shopee ', {
    couriers: ['Shopee', 'Flash'],
    packers: ['ยังไม่ได้เลือก', 'มุก'],
  }), { kind: 'courier', courier: 'Shopee' });
  assert.deepEqual(resolveScanQrName('มุก', {
    couriers: ['Shopee'],
    packers: ['ยังไม่ได้เลือก', 'มุก'],
  }), { kind: 'packer', packer: 'มุก' });
  assert.equal(resolveScanQrName('TH1234567890', {
    couriers: ['Shopee'],
    packers: ['มุก'],
  }), null);
  assert.equal(resolveScanQrName('มุก', {
    couriers: ['มุก'],
    packers: ['มุก'],
  }), null);
});

test('creates Thai voice announcements only for resolved QR selections', () => {
  assert.equal(getScanQrAnnouncement({ kind: 'courier', courier: 'Shopee' }), 'เลือกขนส่ง Shopee แล้ว');
  assert.equal(getScanQrAnnouncement({ kind: 'packer', packer: 'มุก' }), 'เลือก Packer มุก แล้ว');
  assert.equal(getScanQrAnnouncement({ kind: 'courier' }), '');
  assert.equal(getScanQrAnnouncement(null), '');
});

test('resolves only courier and Packer QR commands that match one active dropdown option', () => {
  const courier = parseScanQrCommand(createCourierQrCommand('packer', 'Flash'));
  assert.deepEqual(resolveScanQrCommand(courier, { couriers: ['Shopee', 'Flash'] }), {
    kind: 'courier', role: 'packer', courier: 'Flash',
  });
  assert.equal(resolveScanQrCommand(courier, { couriers: [] }), null);
  assert.equal(resolveScanQrCommand(courier, { couriers: ['Flash', ' flash '] }), null);

  const shopee = parseScanQrCommand(createCourierQrCommand('admin', 'Shopee'));
  assert.deepEqual(resolveScanQrCommand(shopee, { couriers: ['Shopee', 'Shopee Drop Off'] }), {
    kind: 'courier', role: 'admin', courier: 'Shopee',
  });
  assert.equal(resolveScanQrCommand(shopee, { couriers: ['Shopee Drop Off'] }), null);
  assert.equal(resolveScanQrCommand(shopee, { couriers: ['Shopee', 'SHOPEE'] }), null);

  const staff = parseScanQrCommand(createPackerQrCommand('muk-id'));
  assert.deepEqual(resolveScanQrCommand(staff, {
    packers: ['ยังไม่ได้เลือก', 'มุก'],
    staff: [{ id: 'muk-id', nickname: 'มุก', position: 'packer', active: true }],
  }), {
    kind: 'packer', role: 'packer', staffId: 'muk-id', packer: 'มุก',
  });
  assert.equal(resolveScanQrCommand(staff, {
    packers: ['ยังไม่ได้เลือก', 'มุก'],
    staff: [{ id: 'muk-id', nickname: 'มุก', position: 'packer', active: false }],
  }), null);
  assert.equal(resolveScanQrCommand(staff, {
    packers: ['ยังไม่ได้เลือก', 'มุก'],
    staff: [{ id: 'muk-id', nickname: 'มุก', position: 'office', active: true }],
  }), null);
  assert.equal(resolveScanQrCommand(staff, {
    packers: ['ยังไม่ได้เลือก', 'มุก'],
    staff: [
      { id: 'muk-id', nickname: 'มุก', position: 'packer', active: true },
      { id: 'other-id', nickname: ' มุก ', position: 'checker', active: true },
    ],
  }), null);
  assert.equal(resolveScanQrCommand(staff, {
    packers: ['ยังไม่ได้เลือก'],
    staff: [{ id: 'muk-id', nickname: 'มุก', position: 'packer', active: true }],
  }), null);
});
