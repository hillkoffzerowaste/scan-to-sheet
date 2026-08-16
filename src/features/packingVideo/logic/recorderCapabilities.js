/**
 * Container choice, in preference order.
 *
 * VP8 is first on purpose. Android WebView on the cheap tablets used at packing benches often
 * has no hardware VP9 encoder and silently falls back to software, which drops frames and
 * pins the CPU while someone is trying to pack. At 1.5 Mbps on a near-static bench shot the
 * quality difference against VP9 is negligible, so the safer encoder wins.
 *
 * MP4 sits last as a forward-looking option (Chrome 130+/Safari) rather than a default.
 */
const MIME_CANDIDATES = [
  { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
  { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
];

export const VIDEO_BITS_PER_SECOND = 1_500_000;
/**
 * Chunk cadence. Anything already handed to `ondataavailable` is in IndexedDB, so a crash
 * costs at most this much footage rather than the whole clip.
 */
export const RECORDER_TIMESLICE_MS = 5_000;
export const AUTO_STOP_WARN_MS = 8 * 60 * 1000;
export const AUTO_STOP_LIMIT_MS = 15 * 60 * 1000;

export function listMimeCandidates() {
  return MIME_CANDIDATES.map((candidate) => ({ ...candidate }));
}

/**
 * Decides which copy of the footage to assemble, given what came back from IndexedDB and what
 * is still in memory.
 *
 * `expectedCount` is how many chunks the recorder handed over. A disk read shorter than that
 * means a write failed rather than merely lagged, and the in-memory copy — which only holds the
 * most recent chunks — may or may not be the better of two bad options. Reporting `complete`
 * lets the caller flag the clip instead of filing a short recording as a clean one.
 */
export function chooseRecordedParts({ storedChunks = [], bufferedChunks = [], expectedCount = 0 }) {
  const stored = [...storedChunks].sort((left, right) => left.seq - right.seq).map((row) => row.blob);
  const complete = stored.length >= expectedCount;
  if (complete || stored.length >= bufferedChunks.length) {
    return { parts: stored, source: 'indexeddb', complete };
  }
  return { parts: [...bufferedChunks], source: 'memory', complete: false };
}

/** `isSupported` is injected so this stays testable without a MediaRecorder. */
export function pickMimeType(isSupported) {
  if (typeof isSupported !== 'function') return null;
  const match = MIME_CANDIDATES.find((candidate) => {
    try {
      return Boolean(isSupported(candidate.mimeType));
    } catch {
      return false;
    }
  });
  return match ? { ...match } : null;
}

/**
 * `ideal`, never `exact`. USB webcams frequently top out just under 1280x720, and an `exact`
 * constraint turns that into an OverconstrainedError instead of a slightly smaller picture.
 * Read `track.getSettings()` afterwards to show what was actually negotiated.
 *
 * `audio: false` — the Android manifest carries no RECORD_AUDIO permission, and packing-bench
 * audio would capture staff conversation without a reason to.
 */
export function buildVideoConstraints({ cameraDeviceId = '' } = {}) {
  const video = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 24, max: 30 },
    facingMode: { ideal: 'environment' },
  };
  if (cameraDeviceId) {
    video.deviceId = { exact: cameraDeviceId };
  }
  return { audio: false, video };
}

export function buildRecorderOptions(mimeType) {
  return { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND };
}

const CAMERA_ERROR_CODES = {
  NotAllowedError: 'PACKING_VIDEO_PERMISSION_DENIED',
  PermissionDeniedError: 'PACKING_VIDEO_PERMISSION_DENIED',
  NotFoundError: 'PACKING_VIDEO_NO_CAMERA',
  DevicesNotFoundError: 'PACKING_VIDEO_NO_CAMERA',
  NotReadableError: 'PACKING_VIDEO_CAMERA_BUSY',
  TrackStartError: 'PACKING_VIDEO_CAMERA_BUSY',
  OverconstrainedError: 'PACKING_VIDEO_CAMERA_UNSUPPORTED',
  ConstraintNotSatisfiedError: 'PACKING_VIDEO_CAMERA_UNSUPPORTED',
};

const CAMERA_ERROR_MESSAGES = {
  PACKING_VIDEO_PERMISSION_DENIED: 'ยังไม่ได้อนุญาตให้ใช้กล้อง เปิดสิทธิ์กล้องในเบราว์เซอร์แล้วลองใหม่',
  PACKING_VIDEO_NO_CAMERA: 'ไม่พบกล้องบนเครื่องนี้',
  PACKING_VIDEO_CAMERA_BUSY: 'กล้องถูกโปรแกรมอื่นใช้อยู่ ปิดโปรแกรมนั้นแล้วลองใหม่',
  PACKING_VIDEO_CAMERA_UNSUPPORTED: 'กล้องนี้ไม่รองรับความละเอียดที่ตั้งไว้',
  PACKING_VIDEO_CAMERA_UNAVAILABLE: 'เปิดกล้องไม่สำเร็จ กรุณาลองใหม่',
};

/** Maps a getUserMedia DOMException onto a stable code plus Thai display text. */
export function toCameraError(error) {
  const code = CAMERA_ERROR_CODES[error?.name] ?? 'PACKING_VIDEO_CAMERA_UNAVAILABLE';
  return Object.assign(new Error(CAMERA_ERROR_MESSAGES[code]), { code, cause: error });
}
