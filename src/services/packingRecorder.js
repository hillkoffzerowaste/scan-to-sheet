import { acquireCamera, lockCamera, releaseCamera, unlockCamera } from './cameraOwner.js';
import { appendChunk, clearChunks, readChunks } from './packingVideoDb.js';
import {
  AUTO_STOP_LIMIT_MS,
  AUTO_STOP_WARN_MS,
  RECORDER_TIMESLICE_MS,
  buildRecorderOptions,
  buildVideoConstraints,
  pickMimeType,
  toCameraError,
} from '../features/packingVideo/logic/recorderCapabilities.js';

/**
 * The recorder lives at module scope, deliberately outside React.
 *
 * Switching tabs in this app unmounts the previous tab's component tree. If the MediaRecorder
 * were owned by a component, walking over to check a report mid-parcel would silently end the
 * recording. Here the UI only subscribes: unmounting hides the screen, the camera keeps
 * rolling and chunks keep landing in IndexedDB.
 *
 * Chunks are flushed to IndexedDB as they arrive and dropped from memory in batches, because a
 * 15-minute clip is ~169 MB and holding all of it in a tab's heap is how packing tablets get
 * OOM-killed.
 */

const OWNER_ID = 'packing-video';
/** Keep at most this many chunks in RAM before flushing and releasing them. */
const MEMORY_CHUNK_LIMIT = 10;

let stream = null;
let recorder = null;
let active = null;
let listeners = new Set();
let autoStopTimer = null;
let warnTimer = null;

const state = {
  phase: 'idle', // idle | ready | recording | stopping
  videoId: '',
  startedAt: null,
  mimeType: '',
  extension: 'webm',
  resolution: '',
  warned: false,
  errorCode: '',
};

function emit() {
  const snapshot = { ...state, isRecording: state.phase === 'recording' };
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // A broken subscriber must not take the recorder down with it.
    }
  });
}

export function subscribePackingRecorder(listener) {
  listeners.add(listener);
  listener({ ...state, isRecording: state.phase === 'recording' });
  return () => listeners.delete(listener);
}

export function getPackingRecorderState() {
  return { ...state, isRecording: state.phase === 'recording' };
}

export function isPackingRecording() {
  return state.phase === 'recording' || state.phase === 'stopping';
}

function clearTimers() {
  clearTimeout(autoStopTimer);
  clearTimeout(warnTimer);
  autoStopTimer = null;
  warnTimer = null;
}

/**
 * Opens the camera and keeps it open for the whole session.
 *
 * Reusing one MediaStream across parcels matters: releasing and re-acquiring the camera
 * between every scan is what triggers NotReadableError on Android.
 */
export async function preparePackingCamera({ cameraDeviceId = '', onCameraLost } = {}) {
  if (stream?.active) return describeStream();

  await acquireCamera(OWNER_ID, { onEvict: () => stopPackingCamera() });

  const supported = typeof MediaRecorder !== 'undefined'
    ? (type) => MediaRecorder.isTypeSupported(type)
    : null;
  const picked = pickMimeType(supported);
  if (!picked) {
    releaseCamera(OWNER_ID);
    throw Object.assign(new Error('เบราว์เซอร์นี้บันทึกวิดีโอไม่ได้ กรุณาใช้ Chrome รุ่นใหม่'), {
      code: 'PACKING_VIDEO_UNSUPPORTED_BROWSER',
    });
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia(buildVideoConstraints({ cameraDeviceId }));
  } catch (error) {
    releaseCamera(OWNER_ID);
    throw toCameraError(error);
  }

  state.mimeType = picked.mimeType;
  state.extension = picked.extension;
  state.phase = 'ready';
  state.errorCode = '';

  const [track] = stream.getVideoTracks();
  // A camera unplugged or grabbed by another app ends the track; finalize rather than lose it.
  track?.addEventListener('ended', () => {
    state.errorCode = 'PACKING_VIDEO_CAMERA_LOST';
    emit();
    onCameraLost?.('PACKING_VIDEO_CAMERA_LOST');
  });

  emit();
  return describeStream();
}

function describeStream() {
  const settings = stream?.getVideoTracks()[0]?.getSettings?.() ?? {};
  state.resolution = settings.width && settings.height ? `${settings.width}x${settings.height}` : '';
  return {
    stream,
    mimeType: state.mimeType,
    extension: state.extension,
    resolution: state.resolution,
    cameraDeviceId: settings.deviceId ?? '',
  };
}

export function getPackingStream() {
  return stream;
}

/** Starts a clip on the already-open stream. */
export async function startPackingRecording({ videoId, onAutoStopWarning, onAutoStop, onError }) {
  if (!stream?.active) {
    throw Object.assign(new Error('กล้องยังไม่พร้อมใช้งาน'), { code: 'PACKING_VIDEO_CAMERA_NOT_READY' });
  }
  if (state.phase === 'recording') {
    throw Object.assign(new Error('กำลังบันทึกวิดีโออื่นอยู่'), { code: 'PACKING_VIDEO_ALREADY_RECORDING' });
  }

  const startedAt = new Date();
  active = { videoId, startedAt, seq: 0, buffered: [], flushed: 0 };

  recorder = new MediaRecorder(stream, buildRecorderOptions(state.mimeType));

  recorder.ondataavailable = (event) => {
    if (!event.data?.size || !active) return;
    const seq = active.seq;
    active.seq += 1;
    active.buffered.push(event.data);
    // Fire-and-forget: the recorder must not stall waiting on a disk write.
    void appendChunk(videoId, seq, event.data).catch(() => {
      state.errorCode = 'PACKING_VIDEO_CHUNK_WRITE_FAILED';
      emit();
    });
    if (active.buffered.length >= MEMORY_CHUNK_LIMIT) {
      active.flushed += active.buffered.length;
      active.buffered = [];
    }
  };

  recorder.onerror = (event) => {
    state.errorCode = 'PACKING_VIDEO_RECORDER_ERROR';
    emit();
    onError?.(event?.error);
  };

  recorder.start(RECORDER_TIMESLICE_MS);

  state.phase = 'recording';
  state.videoId = videoId;
  state.startedAt = startedAt;
  state.warned = false;
  state.errorCode = '';

  clearTimers();
  warnTimer = setTimeout(() => {
    state.warned = true;
    emit();
    onAutoStopWarning?.();
  }, AUTO_STOP_WARN_MS);
  // A clip nobody stopped would keep growing; at 1.5 Mbps that is ~11 MB a minute of disk and
  // storage cost for a parcel that was packed long ago.
  autoStopTimer = setTimeout(() => onAutoStop?.(), AUTO_STOP_LIMIT_MS);

  emit();
  return { startedAt, mimeType: state.mimeType, extension: state.extension };
}

/** Stops the clip and returns the assembled blob. Reads chunks back from IndexedDB, not RAM. */
export function stopPackingRecording() {
  if (!recorder || state.phase !== 'recording') {
    return Promise.reject(Object.assign(new Error('ไม่มีวิดีโอที่กำลังบันทึก'), {
      code: 'PACKING_VIDEO_NOT_RECORDING',
    }));
  }

  const current = active;
  const currentRecorder = recorder;
  state.phase = 'stopping';
  clearTimers();
  emit();

  return new Promise((resolve, reject) => {
    currentRecorder.onstop = async () => {
      try {
        const finishedAt = new Date();
        const rows = await readChunks(current.videoId);
        const parts = rows.length ? rows.map((row) => row.blob) : current.buffered;
        const blob = new Blob(parts, { type: state.mimeType });

        recorder = null;
        active = null;
        state.phase = 'ready';
        state.videoId = '';
        state.startedAt = null;
        emit();

        resolve({
          videoId: current.videoId,
          blob,
          mimeType: state.mimeType,
          extension: state.extension,
          startedAt: current.startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - current.startedAt.getTime(),
          sizeBytes: blob.size,
        });
      } catch (error) {
        recorder = null;
        active = null;
        state.phase = 'ready';
        emit();
        // Chunks stay in IndexedDB so the next boot can still recover the footage.
        reject(Object.assign(new Error('ปิดไฟล์วิดีโอไม่สำเร็จ'), {
          code: 'PACKING_VIDEO_FINALIZE_FAILED',
          cause: error,
        }));
      }
    };

    try {
      currentRecorder.stop();
    } catch (error) {
      reject(Object.assign(new Error('หยุดบันทึกวิดีโอไม่สำเร็จ'), {
        code: 'PACKING_VIDEO_FINALIZE_FAILED',
        cause: error,
      }));
    }
  });
}

/** Called once a clip is safely in IndexedDB as a finalized row. */
export function discardRecordedChunks(videoId) {
  return clearChunks(videoId).catch(() => {});
}

export function lockCameraForRecording() {
  return lockCamera(OWNER_ID);
}

export function unlockCameraAfterRecording() {
  return unlockCamera(OWNER_ID);
}

/** Closes the camera. Safe to call when nothing is open. */
export function stopPackingCamera() {
  clearTimers();
  try {
    recorder?.stop();
  } catch {
    // Already stopped.
  }
  recorder = null;
  active = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  state.phase = 'idle';
  state.videoId = '';
  state.startedAt = null;
  state.resolution = '';
  releaseCamera(OWNER_ID);
  emit();
}
