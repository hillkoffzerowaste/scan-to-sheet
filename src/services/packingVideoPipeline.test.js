import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUploadedPackingVideoSheetDoc } from './packingVideoPipelinePayload.js';

test('the sheet row reflects an upload that has already completed', () => {
  const uploadedAt = new Date('2026-08-26T09:30:00.000Z');
  const reserved = {
    videoId: 'pv_20260826_station_001',
    status: 'pending_upload',
    storageUrl: '',
    uploadedAt: null,
  };

  const rowDoc = buildUploadedPackingVideoSheetDoc(reserved, {
    storageUrl: 'https://storage.example/clip',
    uploadedAt,
  });

  assert.equal(rowDoc.status, 'uploaded');
  assert.equal(rowDoc.storageUrl, 'https://storage.example/clip');
  assert.equal(rowDoc.uploadedAt, uploadedAt);
});
