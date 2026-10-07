import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeScanNotes } from './scanNotes.js';

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
