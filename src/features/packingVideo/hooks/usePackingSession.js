import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { AUTH_SESSION_EXPIRED, isAuthExpiredError } from '../../../services/authErrors.js';
import { findMarketplaceOrderByTracking } from '../../../services/firebaseScans.js';
import {
  discardRecordedChunks,
  preparePackingCamera,
  startPackingRecording,
  stopPackingCamera,
  stopPackingRecording,
  subscribePackingRecorder,
  lockCameraForRecording,
  unlockCameraAfterRecording,
} from '../../../services/packingRecorder.js';
import {
  checkRecordingCapacity,
  finalizeRecording,
  requestPersistentStorage,
} from '../../../services/packingVideoDb.js';
import { newSessionId, newVideoId } from '../../../services/packingVideoIds.js';
import { PACKING_VIDEO_STATUS } from '../../../services/packingVideoModel.js';
import { allocatePackingAttempt, findPackingVideosByTracking } from '../../../services/packingVideos.js';
import { buildDeviceCode } from '../logic/packingVideoIdentity.js';
import {
  PACKING_STATE,
  RECORD_OUTCOME,
  initialPackingState,
  reducePackingSession,
} from '../logic/packingSessionMachine.js';
import { packingVideoErrorText } from '../logic/packingVideoMessages.js';
import { writePackingPreferences } from '../logic/packingVideoPreferences.js';

const OUTCOME_STATUS = {
  [RECORD_OUTCOME.cancelled]: PACKING_VIDEO_STATUS.cancelled,
  [RECORD_OUTCOME.discarded]: PACKING_VIDEO_STATUS.cancelled,
  [RECORD_OUTCOME.interrupted]: PACKING_VIDEO_STATUS.needsReview,
  [RECORD_OUTCOME.autostop]: PACKING_VIDEO_STATUS.needsReview,
};

/**
 * Wires the pure session reducer to the recorder, the local store and Firestore.
 *
 * The reducer decides *what* should happen; this hook is the only place that performs it.
 * Effects run after the state has already been committed, so the screen updates before any
 * await — that is what lets a packer scan the next label while the previous clip is still
 * being written.
 */
export function usePackingSession({ deviceId, user, queue, notify, playTone, initialPrefs }) {
  const [state, dispatch] = useReducer(reducePackingSession, initialPackingState);
  const [cameraInfo, setCameraInfo] = useState({ ready: false, resolution: '', errorCode: '' });
  const [sessionId, setSessionId] = useState('');

  const sessionRef = useRef({ sessionId: '', station: '', packer: '', packerStaffId: '', cameraDeviceId: '' });
  const scanInputRef = useRef(null);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const deviceCode = useMemo(() => {
    try {
      return buildDeviceCode(state.station || initialPrefs?.station, initialPrefs?.deviceSeq ?? 1);
    } catch {
      return '';
    }
  }, [state.station, initialPrefs?.station, initialPrefs?.deviceSeq]);

  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  /**
   * Faults the recorder notices while a clip is still running — a chunk that would not write,
   * a camera that went away. PACKING_VIDEO_CHUNK_WRITE_FAILED's own text says "กรุณาหยุดบันทึก
   * และแจ้ง Admin", which is only actionable if the packer is told at the time; nothing
   * subscribed to the recorder, so it was never shown while there was still something to save.
   */
  useEffect(() => {
    let lastCode = '';
    return subscribePackingRecorder((snapshot) => {
      if (!snapshot.errorCode || snapshot.errorCode === lastCode) return;
      lastCode = snapshot.errorCode;
      notify?.({
        type: 'warning',
        title: 'กล้องหรือการบันทึกมีปัญหา',
        message: packingVideoErrorText(snapshot.errorCode),
      });
    });
  }, [notify]);

  const focusScan = useCallback(() => {
    window.requestAnimationFrame(() => scanInputRef.current?.focus({ preventScroll: true }));
  }, []);

  const lookupOrder = useCallback(async (tracking) => {
    try {
      const [order, history] = await Promise.all([
        findMarketplaceOrderByTracking({ trackingNo: tracking }),
        findPackingVideosByTracking({ trackingNo: tracking }).catch(() => []),
      ]);
      if (!order) {
        dispatchRef.current({ type: 'LOOKUP_EMPTY' });
        return;
      }
      dispatchRef.current({ type: 'LOOKUP_OK', order, history });
    } catch (error) {
      // Offline is a different problem from "this parcel does not exist", and telling the
      // packer the wrong one sends them looking for a missing order that is really just Wi-Fi.
      // An expired sign-in is a third case again: the rules here are all gated on isSignedIn(),
      // so a stale token arrives as permission-denied and would otherwise show nothing at all.
      let code;
      if (navigator.onLine === false) code = 'PACKING_VIDEO_OFFLINE_LOOKUP';
      else if (isAuthExpiredError(error)) code = AUTH_SESSION_EXPIRED;
      else code = error?.code ?? 'PACKING_VIDEO_LOOKUP_FAILED';
      dispatchRef.current({ type: 'LOOKUP_ERROR', code });
    }
  }, []);

  const beginRecording = useCallback(async ({ tracking, order }) => {
    try {
      await checkRecordingCapacity();
      const camera = await preparePackingCamera({
        cameraDeviceId: sessionRef.current.cameraDeviceId,
        onCameraLost: () => dispatchRef.current({ type: 'CAMERA_LOST' }),
      });
      setCameraInfo({ ready: true, resolution: camera.resolution, errorCode: '' });

      const videoId = newVideoId({ deviceId, startedAt: new Date() });
      // Locked before the recorder starts, not after. The QR scanner can claim the camera at
      // any moment and eviction runs stopPackingCamera(), which stops the recorder and drops
      // the stream — so locking afterwards left a window where a just-started clip died.
      lockCameraForRecording();
      const started = await startPackingRecording({
        videoId,
        onAutoStopWarning: () => notify?.({
          type: 'warning',
          title: 'บันทึกมานานแล้ว',
          message: 'บันทึกวิดีโอมา 8 นาทีแล้ว ถ้าแพ็คเสร็จแล้วกรุณากดปุ่ม "แพ็คเสร็จ"',
        }),
        onAutoStop: () => dispatchRef.current({ type: 'AUTO_STOP_LIMIT' }),
        onError: () => dispatchRef.current({ type: 'RECORDER_ERROR' }),
      });

      sessionRef.current.pending = {
        videoId,
        trackingNo: tracking,
        order,
        startedAt: started.startedAt,
        mimeType: started.mimeType,
        extension: started.extension,
      };
      dispatchRef.current({ type: 'RECORDER_READY', startedAt: started.startedAt });
    } catch (error) {
      // Nothing is recording after a failure, so the camera must go back to being evictable —
      // otherwise a failed start would hold it un-evictable and block QR scanning.
      unlockCameraAfterRecording();
      setCameraInfo((current) => ({ ...current, ready: false, errorCode: error?.code ?? '' }));
      notify?.({ type: 'error', title: 'เริ่มบันทึกวิดีโอไม่ได้', message: error?.message ?? '' });
      dispatchRef.current({ type: 'CAMERA_FAILED', code: error?.code ?? 'PACKING_VIDEO_CAMERA_UNAVAILABLE' });
    }
  }, [deviceId, notify]);

  const stopRecording = useCallback(async () => {
    try {
      const result = await stopPackingRecording();
      unlockCameraAfterRecording();
      dispatchRef.current({ type: 'RECORDER_STOPPED', ...result });
    } catch (error) {
      unlockCameraAfterRecording();
      notify?.({ type: 'error', title: 'ปิดไฟล์วิดีโอไม่สำเร็จ', message: error?.message ?? '' });
      dispatchRef.current({ type: 'RECORDER_STOP_FAILED' });
    }
  }, [notify]);

  /**
   * Stores the finished clip and queues it. Intentionally not awaited by the caller: the
   * packer must be able to scan the next parcel while this runs.
   */
  const handOff = useCallback(async (effect) => {
    const pending = sessionRef.current.pending;
    sessionRef.current.pending = null;
    if (!pending || !effect.blob) return;

    const order = pending.order ?? {};
    // A clip whose chunks did not all reach IndexedDB is short in the middle. The footage is
    // kept — the blob stays in IndexedDB and an Admin can still release it from the dashboard —
    // but it must never enter the upload lane as if it were whole, which is exactly what
    // happened while the recorder's `complete` flag reached nobody. Same treatment as an
    // interrupted or auto-stopped clip.
    const status = effect.complete === false
      ? PACKING_VIDEO_STATUS.needsReview
      : OUTCOME_STATUS[effect.outcome] ?? PACKING_VIDEO_STATUS.pendingUpload;
    const notes = [
      effect.outcome === RECORD_OUTCOME.autostop ? 'หยุดบันทึกอัตโนมัติเมื่อครบ 15 นาที' : '',
      effect.complete === false ? 'วิดีโอไม่สมบูรณ์: เขียนลงเครื่องไม่ครบทุกช่วง' : '',
    ].filter(Boolean);

    if (effect.complete === false) {
      notify?.({
        type: 'warning',
        title: 'วิดีโอไม่สมบูรณ์',
        message: 'เขียนวิดีโอลงเครื่องไม่ครบทุกช่วง คลิปนี้รอ Admin ตรวจสอบก่อนอัปโหลด',
      });
    }

    try {
      // The attempt number is reserved server-side; if that fails the clip is still stored and
      // gets its number on retry, so it must never block the local write.
      const attemptNo = await allocatePackingAttempt({
        trackingNo: pending.trackingNo,
        videoId: pending.videoId,
      }).catch(() => 0);

      await finalizeRecording({
        videoId: pending.videoId,
        trackingNo: pending.trackingNo,
        attemptNo,
        orderId: order.orderId ?? '',
        platform: order.platform ?? '',
        marketplaceOrderDocId: order.id ?? '',
        packer: sessionRef.current.packer,
        packerStaffId: sessionRef.current.packerStaffId,
        stationId: sessionRef.current.station,
        deviceId,
        sessionId: sessionRef.current.sessionId,
        startedAt: pending.startedAt,
        finishedAt: effect.finishedAt ?? new Date(),
        durationMs: effect.durationMs ?? 0,
        mimeType: effect.mimeType || pending.mimeType,
        extension: pending.extension,
        sizeBytes: effect.blob.size ?? 0,
        blob: effect.blob,
        status,
        createdByUid: user?.uid ?? '',
        createdByEmail: user?.email ?? '',
        note: notes.join(' | '),
      });
      await discardRecordedChunks(pending.videoId);
      void queue?.kick();
    } catch (error) {
      notify?.({
        type: 'error',
        title: 'เก็บวิดีโอในเครื่องไม่สำเร็จ',
        message: error?.message ?? 'กรุณาแจ้งผู้ดูแลระบบ',
      });
    }
  }, [deviceId, notify, queue, user]);

  // Effects are executed after the render that committed them.
  useEffect(() => {
    state.effects.forEach((effect) => {
      switch (effect.type) {
        case 'lookupOrder':
          void lookupOrder(effect.tracking);
          break;
        case 'startRecording':
          void beginRecording({ tracking: effect.tracking, order: effect.order });
          break;
        case 'stopRecorder':
          void stopRecording();
          break;
        case 'handOff':
          void handOff(effect);
          break;
        case 'focusScanInput':
          focusScan();
          break;
        case 'playTone':
          playTone?.(effect.tone);
          break;
        case 'showError':
          // `notify` is App.jsx's setStatus, which renders title + message and ignores `code`,
          // so passing the code alone left the banner with a blank body.
          notify?.({
            type: 'error',
            title: 'บันทึกวิดีโอไม่สำเร็จ',
            message: packingVideoErrorText(effect.code),
          });
          break;
        case 'persistPreferences':
          writePackingPreferences(window.localStorage, {
            station: effect.station,
            packer: effect.packer,
          });
          break;
        case 'probeCamera':
          void preparePackingCamera({ cameraDeviceId: sessionRef.current.cameraDeviceId })
            .then((camera) => setCameraInfo({ ready: true, resolution: camera.resolution, errorCode: '' }))
            .catch((error) => setCameraInfo({ ready: false, resolution: '', errorCode: error?.code ?? '' }));
          break;
        case 'releaseCamera':
          stopPackingCamera();
          break;
        default:
          break;
      }
    });
  }, [state.effects, lookupOrder, beginRecording, stopRecording, handOff, focusScan, notify, playTone]);

  const startSession = useCallback(({ station, packer, packerStaffId, cameraDeviceId }) => {
    const id = newSessionId();
    sessionRef.current = { sessionId: id, station, packer, packerStaffId, cameraDeviceId, pending: null };
    setSessionId(id);
    dispatch({ type: 'START_SESSION', station, packer });
  }, []);

  return {
    state,
    dispatch,
    cameraInfo,
    deviceCode,
    sessionId,
    scanInputRef,
    startSession,
    scan: (tracking) => dispatch({ type: 'SCAN', tracking }),
    packDone: () => dispatch({ type: 'PACK_DONE' }),
    cancel: () => dispatch({ type: 'CANCEL' }),
    restart: () => dispatch({ type: 'RESTART' }),
    retryCamera: () => dispatch({ type: 'RETRY' }),
    closeSession: () => dispatch({ type: 'CLOSE_SESSION' }),
    isRecording: state.status === PACKING_STATE.recording,
  };
}
