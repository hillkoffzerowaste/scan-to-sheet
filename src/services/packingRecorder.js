import { acquireCamera, lockCamera, releaseCamera, unlockCamera } from './cameraOwner.js';
import { appendChunk, clearChunks, readChunks } from './packingVideoDb.js';
import {
  AUTO_STOP_LIMIT_MS,
  AUTO_STOP_WARN_MS,
  RECORDER_TIMESLICE_MS,
  buildRecorderOptions,
  buildVideoConstraints,
  chooseRecordedParts,
  isStaleCameraIdError,
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
    if (!isStaleCameraIdError(error, cameraDeviceId)) {
      releaseCamera(OWNER_ID);
      throw toCameraError(error);
    }
    // The remembered deviceId is pinned with `exact`, and on phones that id is not stable: it
    // changes when camera permission is re-granted or site data is cleared. Retrying with "any
    // camera" turns a dead end into a working session. Without it the packer is told the
    // resolution is unsupported, which is not what went wrong and sends them fixing the
    // wrong thing.
    try {
      stream = await navigator.mediaDevices.getUserMedia(buildVideoConstraints({}));
    } catch (retryError) {
      releaseCamera(OWNER_ID);
      throw toCameraError(retryError);
    }
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
  active = { videoId, startedAt, seq: 0, buffered: [], writes: [] };

  recorder = new MediaRecorder(stream, buildRecorderOptions(state.mimeType));

  recorder.ondataavailable = (event) => {
    if (!event.data?.size || !active) return;
    const seq = active.seq;
    active.seq += 1;
    active.buffered.push(event.data);
    // The write is not awaited here — the recorder must not stall on disk — but the promise is
    // kept so stop() can wait for it. Without that, onstop reads IndexedDB back while the last
    // few writes are still in flight and the assembled clip silently loses its final seconds:
    // exactly the moment the box is closed, and the reason this feature exists.
    active.writes.push(appendChunk(videoId, seq, event.data).catch((error) => {
      state.errorCode = 'PACKING_VIDEO_CHUNK_WRITE_FAILED';
      emit();
      return { failedSeq: seq, error };
    }));
    if (active.buffered.length >= MEMORY_CHUNK_LIMIT) {
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
        // stop() delivers the final ondataavailable before onstop, so every write this clip will
        // ever make has been queued by now; settling them makes the read below see all of them.
        await Promise.allSettled(current.writes);

        const rows = await readChunks(current.videoId);
        const { parts, complete } = chooseRecordedParts({
          storedChunks: rows,
          bufferedChunks: current.buffered,
          expectedCount: current.seq,
        });
        const blob = new Blob(parts, { type: state.mimeType });

        if (!blob.size) {
          throw Object.assign(new Error('ไม่มีข้อมูลวิดีโอที่บันทึกได้'), {
            code: 'PACKING_VIDEO_EMPTY_RECORDING',
          });
        }
        // Surfaced rather than swallowed: a clip missing chunks must not be filed as a clean one.
        if (!complete) state.errorCode = 'PACKING_VIDEO_CHUNK_WRITE_FAILED';

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
