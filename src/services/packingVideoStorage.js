import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';

import { firebaseStorage } from './firebase.js';

/**
 * Resumable rather than a plain put: a packing video is tens of megabytes over warehouse
 * Wi-Fi, and a single dropped request should cost the last chunk, not the whole upload.
 */
export function uploadPackingVideo({ storagePath, blob, mimeType, metadata = {}, onProgress }) {
  if (!firebaseStorage) {
    return Promise.reject(Object.assign(new Error('ระบบจัดเก็บวิดีโอยังไม่พร้อมใช้งาน'), {
      code: 'PACKING_VIDEO_STORAGE_UNAVAILABLE',
    }));
  }
  if (!blob) {
    return Promise.reject(Object.assign(new Error('ไม่พบไฟล์วิดีโอที่จะอัปโหลด'), {
      code: 'PACKING_VIDEO_BLOB_MISSING',
    }));
  }

  const target = ref(firebaseStorage, storagePath);
  const task = uploadBytesResumable(target, blob, {
    contentType: mimeType || 'video/webm',
    // Enough context to trace a file back to its parcel even if Firestore and Storage drift
    // apart — the Drive worker reads these instead of re-reading the document.
    customMetadata: Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, String(value ?? '')]),
    ),
  });

  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => {
        if (typeof onProgress !== 'function' || !snapshot.totalBytes) return;
        onProgress(snapshot.bytesTransferred / snapshot.totalBytes);
      },
      (error) => reject(toUploadError(error)),
      async () => {
        try {
          resolve({ storagePath, storageUrl: await getDownloadURL(task.snapshot.ref) });
        } catch (error) {
          reject(toUploadError(error));
        }
      },
    );
  });
}

/** Resolve playback only for the current authorized viewer; never store this bearer-like URL. */
export async function getPackingVideoPlaybackUrl(storagePath) {
  if (!firebaseStorage || !storagePath) {
    throw Object.assign(new Error('ยังเปิดวิดีโอไม่ได้'), { code: 'PACKING_VIDEO_PLAYBACK_UNAVAILABLE' });
  }
  return getDownloadURL(ref(firebaseStorage, storagePath));
}

const UPLOAD_ERROR_CODES = {
  'storage/unauthorized': 'PACKING_VIDEO_UPLOAD_FORBIDDEN',
  'storage/quota-exceeded': 'PACKING_VIDEO_UPLOAD_QUOTA',
  'storage/retry-limit-exceeded': 'PACKING_VIDEO_UPLOAD_NETWORK',
  'storage/canceled': 'PACKING_VIDEO_UPLOAD_CANCELLED',
};

const UPLOAD_ERROR_MESSAGES = {
  PACKING_VIDEO_UPLOAD_FORBIDDEN: 'ไม่มีสิทธิ์อัปโหลดวิดีโอ กรุณาเข้าสู่ระบบใหม่',
  PACKING_VIDEO_UPLOAD_QUOTA: 'พื้นที่จัดเก็บวิดีโอเต็ม กรุณาแจ้งผู้ดูแลระบบ',
  PACKING_VIDEO_UPLOAD_NETWORK: 'อัปโหลดวิดีโอไม่สำเร็จเพราะสัญญาณขาดหาย ระบบจะลองใหม่ให้อัตโนมัติ',
  PACKING_VIDEO_UPLOAD_CANCELLED: 'การอัปโหลดถูกยกเลิก',
  PACKING_VIDEO_UPLOAD_FAILED: 'อัปโหลดวิดีโอไม่สำเร็จ ระบบจะลองใหม่ให้อัตโนมัติ',
};

function toUploadError(error) {
  const code = UPLOAD_ERROR_CODES[error?.code] ?? 'PACKING_VIDEO_UPLOAD_FAILED';
  // Firebase puts bucket paths in its own message, so only the stable code crosses over.
  return Object.assign(new Error(UPLOAD_ERROR_MESSAGES[code]), { code, detail: error?.code ?? '' });
}
