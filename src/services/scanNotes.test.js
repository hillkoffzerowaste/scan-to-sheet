import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeScanNotes } from './scanNotes.js';
import { getSearchIssueAction } from './searchIssueAction.js';

test('deduplicates repeated operational notes while preserving order', () => {
  assert.equal(
    mergeScanNotes(
      'แพ็คเกอร์เลือกขนส่งไม่ตรงกับแอดมิน (เลือก Flash)',
      'แพ็คเกอร์เลือกขนส่งไม่ตรงกับแอดมิน (เลือก Flash) | แพ็คข้ามวัน (สแกน 2026-10-07)',
    ),
    'แพ็คเกอร์เลือกขนส่งไม่ตรงกับแอดมิน (เลือก Flash) | แพ็คข้ามวัน (สแกน 2026-10-07)',
  );
});

test('ignores blank notes and keeps distinct notes', () => {
  assert.equal(mergeScanNotes('', 'ลูกค้ายกเลิก', ' ', 'แพ็คข้ามวัน'), 'ลูกค้ายกเลิก | แพ็คข้ามวัน');
});

test('search issue action preserves damaged and cancelled behavior with scan count markers', () => {
  const marker = '[สแกนซ้ำ: Admin 2 ครั้ง, Packer 2 ครั้ง]';
  assert.deepEqual(getSearchIssueAction({ status: 'Issue', note: `สินค้าเสียหาย | ${marker}` }), { disabled: true, label: 'บันทึกแล้ว' });
  assert.deepEqual(getSearchIssueAction({ status: 'Issue', note: `ลูกค้ายกเลิก | ${marker}` }), { disabled: true, label: 'ยกเลิกแล้ว' });
  assert.deepEqual(getSearchIssueAction({ status: 'Issue', note: `สินค้าตีกลับ | ${marker}` }), { disabled: false, label: 'สินค้าเสียหาย' });
  assert.deepEqual(getSearchIssueAction({ status: 'Damaged', note: '' }), { disabled: true, label: 'บันทึกแล้ว' });
  assert.deepEqual(getSearchIssueAction({ status: 'Cancelled', note: '' }), { disabled: true, label: 'ยกเลิกแล้ว' });
});
