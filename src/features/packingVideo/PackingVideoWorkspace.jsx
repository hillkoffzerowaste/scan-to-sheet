import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createPackingVideoPipeline } from '../../services/packingVideoPipeline.js';
import { createPackingVideoQueue } from '../../services/packingVideoQueue.js';
import {
  dropBlob,
  findInterruptedRecordings,
  getMeta,
  listPendingVideos,
  purgeOldMetadata,
  setMeta,
  summarizeQueue,
  updateVideo,
} from '../../services/packingVideoDb.js';
import { DEVICE_ID_KEY, resolveDeviceId } from '../../services/packingVideoIds.js';
import { stopPackingCamera } from '../../services/packingRecorder.js';
import DuplicateTrackingDialog from './DuplicateTrackingDialog.jsx';
import PackingVideoDashboard from './PackingVideoDashboard.jsx';
import RecordPanel from './RecordPanel.jsx';
import SetupPanel from './SetupPanel.jsx';
import { usePackingSession } from './hooks/usePackingSession.js';
import { PACKING_STATE } from './logic/packingSessionMachine.js';
import { readPackingPreferences, writePackingPreferences } from './logic/packingVideoPreferences.js';

const EMPTY_SUMMARY = { pendingCount: 0, failedCount: 0, pendingBytes: 0 };

/**
 * Root of the "บันทึกวิดีโอ" tab.
 *
 * This module is used only for parcels someone has decided need evidence, not for every scan,
 * which is why it is a mode you deliberately enter rather than something layered over the
 * normal packing flow.
 */
export default function PackingVideoWorkspace({
  isSignedIn,
  user,
  firebaseUser,
  packerOptions,
  getToken,
  refreshToken,
  getConfig,
  notify,
  playTone,
}) {
  const [section, setSection] = useState('record');
  const [deviceId, setDeviceId] = useState('');
  const [prefs, setPrefs] = useState(() => readPackingPreferences(window.localStorage));
  const [station, setStation] = useState(prefs.station);
  const [packer, setPacker] = useState(prefs.packer);
  const [deviceSeq, setDeviceSeq] = useState(prefs.deviceSeq);
  const [queueSummary, setQueueSummary] = useState(EMPTY_SUMMARY);
  const [interrupted, setInterrupted] = useState([]);
  const [localVideos, setLocalVideos] = useState([]);
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  const queueRef = useRef(null);

  const refreshLocalState = useCallback(async () => {
    try {
      const [summary, pending] = await Promise.all([summarizeQueue(), listPendingVideos()]);
      setQueueSummary(summary);
      // The blob itself is deliberately dropped here: these rows are rendered and kept in React
      // state, and holding a few hundred megabytes of video in a state object is how the tab
      // gets OOM-killed. The queue reads the blob straight from IndexedDB when it uploads.
      setLocalVideos(pending.map(({ blob, ...row }) => row));
    } catch {
      // A local store that cannot be read must not blank the screen.
    }
  }, []);

  // Device identity is kept in two places so clearing site data does not silently turn one
  // workstation into a new device on every shift.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromIndexedDb = await getMeta(DEVICE_ID_KEY).catch(() => null);
      const resolved = resolveDeviceId({
        fromLocalStorage: window.localStorage.getItem(DEVICE_ID_KEY),
        fromIndexedDb,
      });
      if (cancelled) return;
      window.localStorage.setItem(DEVICE_ID_KEY, resolved.deviceId);
      await setMeta(DEVICE_ID_KEY, resolved.deviceId).catch(() => {});
      setDeviceId(resolved.deviceId);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const queue = createPackingVideoQueue({
      db: {
        listPending: listPendingVideos,
        update: updateVideo,
        dropBlob,
        summarize: summarizeQueue,
      },
      pipeline: createPackingVideoPipeline({
        getToken,
        refreshToken,
        getConfig,
        getUser: () => ({ uid: firebaseUser?.uid, email: user?.email }),
        getDeviceId: () => deviceId,
      }),
      onChange: () => { void refreshLocalState(); },
    });
    queueRef.current = queue;
    void queue.kick();
    return () => {
      queue.dispose();
      queueRef.current = null;
    };
  }, [deviceId, firebaseUser?.uid, user?.email, getToken, refreshToken, getConfig, refreshLocalState]);

  // Recovery pass: chunks with no finalized row mean the tab died mid-recording.
  useEffect(() => {
    void refreshLocalState();
    void purgeOldMetadata();
    findInterruptedRecordings().then(setInterrupted).catch(() => {});
  }, [refreshLocalState]);

  useEffect(() => {
    const goOnline = () => { setOnline(true); void queueRef.current?.kick(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const session = usePackingSession({
    deviceId,
    user: { uid: firebaseUser?.uid, email: user?.email },
    queue: queueRef.current,
    notify,
    playTone,
    initialPrefs: { ...prefs, station, deviceSeq },
  });

  const { state, dispatch } = session;
  const isRecording = state.status === PACKING_STATE.recording;

  // Leaving with a clip still running would confuse more than it would lose — the recorder
  // lives outside React, so the footage itself survives an unmount.
  useEffect(() => {
    if (!isRecording) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isRecording]);

  useEffect(() => () => stopPackingCamera(), []);

  const startSession = useCallback(() => {
    writePackingPreferences(window.localStorage, { station, packer, deviceSeq });
    setPrefs(readPackingPreferences(window.localStorage));
    session.startSession({ station, packer, packerStaffId: '', cameraDeviceId: prefs.cameraDeviceId });
  }, [station, packer, deviceSeq, prefs.cameraDeviceId, session]);

  const inSetup = state.status === PACKING_STATE.setup;
  const sectionButtons = useMemo(() => ([
    { id: 'record', label: 'บันทึกวิดีโอ' },
    { id: 'dashboard', label: 'ค้นหาวิดีโอ' },
  ]), []);

  return (
    <section className="pv-page" aria-labelledby="pv-title">
      <header className="pv-page-header">
        <div>
          <h2 id="pv-title">บันทึกวิดีโอแพ็คพัสดุ</h2>
          <p>สำหรับออเดอร์ที่ต้องเก็บหลักฐานการแพ็คเป็นวิดีโอ ไม่ใช่ทุกออเดอร์</p>
        </div>
        <nav className="pv-section-nav" aria-label="เมนูบันทึกวิดีโอ">
          {sectionButtons.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`pv-section-button ${section === item.id ? 'active' : ''}`}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {interrupted.length > 0 && (
        <p className="pv-banner pv-banner-warn" role="alert">
          พบวิดีโอที่บันทึกค้างไว้ {interrupted.length} รายการ (เครื่องปิดกลางคัน)
          กรุณาแจ้งผู้ดูแลระบบเพื่อกู้ไฟล์ ระบบจะไม่อัปโหลดให้อัตโนมัติเพราะคลิปอาจไม่สมบูรณ์
        </p>
      )}

      {section === 'record' && (
        inSetup
          ? (
            <SetupPanel
              station={station}
              packer={packer}
              deviceSeq={deviceSeq}
              deviceCode={session.deviceCode}
              packerOptions={packerOptions}
              cameraInfo={session.cameraInfo}
              isSignedIn={isSignedIn}
              onStationChange={setStation}
              onPackerChange={setPacker}
              onDeviceSeqChange={setDeviceSeq}
              onStart={startSession}
            />
          )
          : (
            <RecordPanel
              session={session}
              station={station}
              packer={packer}
              deviceCode={session.deviceCode}
              queueSummary={queueSummary}
              online={online}
            />
          )
      )}

      {section === 'dashboard' && (
        <PackingVideoDashboard
          packerOptions={packerOptions}
          user={{ uid: firebaseUser?.uid, email: user?.email }}
          deviceId={deviceId}
          queue={queueRef.current}
          localVideos={localVideos}
          onLocalChange={refreshLocalState}
        />
      )}

      {state.status === PACKING_STATE.duplicatePrompt && (
        <DuplicateTrackingDialog
          tracking={state.tracking}
          history={state.history}
          onContinue={() => dispatch({ type: 'DUP_CONTINUE' })}
          onRerecord={() => dispatch({ type: 'DUP_RERECORD' })}
          onCancel={() => dispatch({ type: 'DUP_CANCEL' })}
        />
      )}
    </section>
  );
}
