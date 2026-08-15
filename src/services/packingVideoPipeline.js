import { SHEET_STATUS } from './packingVideoModel.js';
import { buildStoragePath } from './packingVideoIds.js';
import { appendPackingVideoRow, withFreshToken } from './packingVideoSheet.js';
import { uploadPackingVideo } from './packingVideoStorage.js';
import { createPackingVideo, updatePackingVideoUpload } from './packingVideos.js';

/**
 * Storage → Firestore → Sheet, in that order.
 *
 * The sheet is deliberately last and deliberately non-fatal: it is the reporting layer, not
 * the source of truth. A clip whose row failed to append is still safely stored and still
 * findable in the dashboard; a sweeper can fill the row in later. Failing the whole job here
 * would send a perfectly good upload back through the retry backoff.
 */
export function createPackingVideoPipeline({ getToken, refreshToken, getConfig, getUser, getDeviceId }) {
  return async function runPipeline(job) {
    const storagePath = job.storagePath || buildStoragePath({
      videoId: job.videoId,
      startedAt: job.startedAt,
      retryNo: job.retryNo ?? 0,
      extension: job.extension,
    });

    const { storageUrl } = await uploadPackingVideo({
      storagePath,
      blob: job.blob,
      mimeType: job.mimeType,
      metadata: {
        videoId: job.videoId,
        trackingNo: job.trackingNo,
        orderId: job.orderId,
        platform: job.platform,
        packer: job.packer,
        stationId: job.stationId,
        deviceId: getDeviceId?.() ?? job.deviceId,
        sessionId: job.sessionId,
        attemptNo: job.attemptNo,
        startedAt: new Date(job.startedAt).toISOString(),
      },
    });

    const user = getUser?.() ?? {};
    // setDoc with the video id as the key: a retry rewrites the same document rather than
    // creating a second one.
    const saved = await createPackingVideo({
      ...job,
      storagePath,
      storageUrl,
      createdByUid: user.uid ?? job.createdByUid,
      createdByEmail: user.email ?? job.createdByEmail,
    });
    await updatePackingVideoUpload(job.videoId, { status: 'uploaded', storageUrl, storagePath, uploadedAt: new Date() });

    const spreadsheetId = getConfig?.()?.packingVideos?.id;
    if (!spreadsheetId) {
      return { storagePath, storageUrl, sheetStatus: SHEET_STATUS.pending, sheetRowNumber: 0 };
    }

    try {
      const { rowNumber } = await withFreshToken(
        (token) => appendPackingVideoRow({ token, spreadsheetId, doc: { ...saved, storageUrl } }),
        { getToken, refreshToken },
      );
      await updatePackingVideoUpload(job.videoId, {
        sheetStatus: SHEET_STATUS.written,
        sheetRowNumber: rowNumber,
      });
      return { storagePath, storageUrl, sheetStatus: SHEET_STATUS.written, sheetRowNumber: rowNumber };
    } catch (error) {
      console.warn('Packing video sheet row deferred:', error?.code ?? error?.message ?? error);
      return { storagePath, storageUrl, sheetStatus: SHEET_STATUS.pending, sheetRowNumber: 0 };
    }
  };
}
