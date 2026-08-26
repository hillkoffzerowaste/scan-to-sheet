import { PACKING_VIDEO_STATUS } from './packingVideoModel.js';

/** The sheet is appended after Storage succeeds, so it must not reuse the stale reservation. */
export function buildUploadedPackingVideoSheetDoc(saved, { storageUrl, uploadedAt }) {
  return {
    ...saved,
    status: PACKING_VIDEO_STATUS.uploaded,
    storageUrl,
    uploadedAt,
  };
}
