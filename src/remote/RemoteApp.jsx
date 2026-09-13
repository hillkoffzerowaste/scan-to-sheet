import React, { useEffect, useRef, useState } from 'react';
import { PACKER_UNASSIGNED } from '../constants.js';
import { COURIERS } from '../services/googleSheets.js';
import { subscribeCouriers } from '../services/firebaseScans.js';
import { subscribeStaffMembers } from '../features/staff/staffService.js';
import { buildPackerOptions } from '../features/staff/staffDirectory.js';
import {
  firebaseAuth,
  GoogleAuthProvider,
  isFirebaseConfigured,
  onAuthStateChanged,
  signInWithCredential,
} from '../services/firebase.js';
import { subscribeRemoteControl, writeRemoteControl } from '../services/remoteControl.js';
import {
  REMOTE_CONTROL_TAB_USES_PACKER,
  REMOTE_ORIGIN_REMOTE,
  remoteControlSignature,
} from '../services/remoteControlRules.js';
import { REMOTE_ROUTE_PATH } from '../services/remoteRoute.js';
import './remote.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
// ถ้า Vercel ตั้ง GOOGLE_OAUTH_REDIRECT_URI ไว้ ปลายทาง /remote จะถูกปฏิเสธด้วย code นี้
// ทางสำรองคือไปล็อกอินที่หน้าหลักแล้วเด้งกลับมาเอง
const REDIRECT_FALLBACK_FLAG = 'scan-to-sheet-remote-login-v1';
// ห้องแพ็คเป็นค่าเริ่มต้น เพราะเป็นงานที่ใช้รีโมทจริงเกือบทั้งวัน
const TABS = [
  { id: 'packer', label: 'ห้องแพ็ค' },
  { id: 'drive', label: 'ลง Drive' },
];

async function apiJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
    error.code = data?.code;
    throw error;
  }
  return data;
}

function readSessionFlag(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    // sessionStorage ถูกปิดได้ในโหมดส่วนตัวของบางเบราว์เซอร์
    return null;
  }
}

function writeSessionFlag(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // ไม่มี sessionStorage ก็ยังล็อกอินได้ แค่เสียทางสำรองไป
  }
}

function RemoteApp() {
  const [authState, setAuthState] = useState('checking');
  const [user, setUser] = useState(null);
  const [couriers, setCouriers] = useState(COURIERS);
  const [packers, setPackers] = useState([PACKER_UNASSIGNED]);
  const [tab, setTab] = useState('packer');
  const [board, setBoard] = useState(null);
  const [pending, setPending] = useState(null);
  const [message, setMessage] = useState(null);
  const [connected, setConnected] = useState(false);
  const pendingSignatureRef = useRef(null);

  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseAuth) {
      setAuthState('unconfigured');
      return () => {};
    }
    // Firebase เก็บ session ไว้ใน IndexedDB และต่ออายุเอง = ล็อกอินครั้งเดียวแล้วจำไว้
    return onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser ?? null);
      setAuthState(nextUser ? 'signed-in' : 'signed-out');
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || !firebaseAuth) return;

    let cancelled = false;
    setAuthState('completing');
    (async () => {
      try {
        const data = await apiJson('/api/google-auth', { code, state });
        // รีโมทไม่แตะ Google Sheet เลย จึงใช้แค่ credential สำหรับ Firestore ไม่เรียก prepareSheet
        const credential = GoogleAuthProvider.credential(data.idToken, data.accessToken);
        await signInWithCredential(firebaseAuth, credential);
        writeSessionFlag(REDIRECT_FALLBACK_FLAG, null);
      } catch (error) {
        if (!cancelled) {
          setAuthState('signed-out');
          setMessage({ tone: 'error', text: error.message || 'เข้าสู่ระบบไม่สำเร็จ' });
        }
      } finally {
        window.history.replaceState({}, '', REMOTE_ROUTE_PATH);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return () => {};
    return subscribeCouriers({
      defaultCouriers: COURIERS,
      onChange: setCouriers,
      onError: (error) => console.warn('Courier list sync failed:', error),
    });
  }, [user]);

  useEffect(() => {
    if (!user) return () => {};
    return subscribeStaffMembers({
      onChange: (members) => {
        try {
          setPackers([PACKER_UNASSIGNED, ...buildPackerOptions(members)]);
        } catch (error) {
          console.warn('Packer list sync failed:', error);
        }
      },
      onError: (error) => console.warn('Staff sync failed:', error),
    });
  }, [user]);

  useEffect(() => {
    if (!user) return () => {};
    // สลับแท็บ = ฟังกระดานอีกใบ ค่าที่ค้างจากแท็บก่อนต้องไม่แสดงเป็นค่าปัจจุบันของแท็บใหม่
    setBoard(null);
    setPending(null);
    pendingSignatureRef.current = null;
    return subscribeRemoteControl({
      tab,
      onChange: (data) => {
        setConnected(true);
        if (!data) return;
        setBoard(data);
        // คำสั่งถือว่าถึงปลายทางเมื่อค่าบนกระดานตรงกับที่กดไป ไม่ต้องรอให้คอมเขียนตอบ
        const signature = remoteControlSignature({ courier: data.courier, packer: data.packer });
        if (pendingSignatureRef.current && signature === pendingSignatureRef.current) {
          pendingSignatureRef.current = null;
          setPending(null);
        }
      },
      onError: (error) => {
        setConnected(false);
        console.warn('Remote control sync failed:', error);
      },
    });
  }, [user, tab]);

  async function signIn() {
    if (!GOOGLE_CLIENT_ID) {
      setMessage({ tone: 'error', text: 'ยังไม่ได้ตั้งค่า OAuth Client ID' });
      return;
    }
    setMessage(null);
    try {
      const data = await apiJson('/api/google-oauth-start', {
        redirectUri: `${window.location.origin}${REMOTE_ROUTE_PATH}`,
      });
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      if (error.code === 'OAUTH_REDIRECT_INVALID' && !readSessionFlag(REDIRECT_FALLBACK_FLAG)) {
        // เซิร์ฟเวอร์อนุญาตปลายทางเดียว: ไปล็อกอินที่หน้าหลักแล้วกลับมาที่นี่เอง
        writeSessionFlag(REDIRECT_FALLBACK_FLAG, '1');
        window.location.assign('/');
        return;
      }
      setMessage({ tone: 'error', text: error.message || 'เริ่มเข้าสู่ระบบไม่สำเร็จ' });
    }
  }

  function send(next) {
    if (!user) return;
    const signature = remoteControlSignature(next);
    pendingSignatureRef.current = signature;
    setPending(next);
    setMessage(null);
    writeRemoteControl({ ...next, tab, origin: REMOTE_ORIGIN_REMOTE, uid: user.uid })
      .catch((error) => {
        pendingSignatureRef.current = null;
        setPending(null);
        setMessage({ tone: 'error', text: error.message || 'ส่งคำสั่งไม่สำเร็จ' });
      });
  }

  const currentCourier = pending?.courier ?? board?.courier ?? null;
  const currentPacker = pending?.packer ?? board?.packer ?? PACKER_UNASSIGNED;
  const usesPacker = REMOTE_CONTROL_TAB_USES_PACKER[tab];

  if (authState === 'unconfigured') {
    return (
      <main className="remote-app" id="main" tabIndex={-1}>
        <p className="remote-empty">ยังไม่ได้ตั้งค่า Firebase สำหรับเครื่องนี้</p>
      </main>
    );
  }

  if (authState !== 'signed-in') {
    return (
      <main className="remote-app" id="main" tabIndex={-1}>
        <header className="remote-header">
          <h1>รีโมทสแกน</h1>
        </header>
        <p className="remote-empty">
          {authState === 'completing' ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบด้วยบัญชีเดียวกับเครื่องที่สแกน'}
        </p>
        {message && <p className="remote-message remote-message-error">{message.text}</p>}
        <button type="button" className="remote-signin" onClick={signIn} disabled={authState === 'completing'}>
          เข้าสู่ระบบด้วย Google
        </button>
      </main>
    );
  }

  return (
    <main className="remote-app" id="main" tabIndex={-1}>
      <header className="remote-header">
        <h1>รีโมทสแกน</h1>
        <span className={connected ? 'remote-link remote-link-on' : 'remote-link'}>
          {connected ? 'เชื่อมต่อแล้ว' : 'กำลังเชื่อมต่อ…'}
        </span>
      </header>

      <div className="remote-tabs" role="tablist" aria-label="โหมดที่ควบคุม">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === tab}
            className={item.id === tab ? 'remote-tab remote-tab-on' : 'remote-tab'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="remote-now">
        <p className="remote-now-label">
          {tab === 'drive' ? 'กำลังรับเข้า Drive ที่เครื่องคอม' : 'กำลังสแกนที่เครื่องคอม'}
        </p>
        <p className="remote-now-value">
          {currentCourier ?? 'ยังไม่มีข้อมูล'}{usesPacker ? ` · ${currentPacker}` : ''}
        </p>
        {pending && <p className="remote-now-note">กำลังส่งคำสั่ง…</p>}
      </section>

      {message && <p className="remote-message remote-message-error">{message.text}</p>}

      <h2 className="remote-section-title">ขนส่ง</h2>
      <div className="remote-grid">
        {couriers.map((courier) => (
          <button
            key={courier}
            type="button"
            className={courier === currentCourier ? 'remote-choice remote-choice-on' : 'remote-choice'}
            aria-pressed={courier === currentCourier}
            onClick={() => send({ courier, packer: currentPacker })}
          >
            {courier}
          </button>
        ))}
      </div>

      {usesPacker && <h2 className="remote-section-title">คนแพ็ค</h2>}
      {usesPacker && (
      <div className="remote-grid">
        {packers.map((packer) => (
          <button
            key={packer}
            type="button"
            className={packer === currentPacker ? 'remote-choice remote-choice-on' : 'remote-choice'}
            aria-pressed={packer === currentPacker}
            disabled={!currentCourier}
            onClick={() => send({ courier: currentCourier, packer })}
          >
            {packer}
          </button>
        ))}
      </div>
      )}

      <p className="remote-foot">
        {board?.origin === 'desktop' ? 'ค่าล่าสุดตั้งจากเครื่องคอม' : board ? 'ค่าล่าสุดตั้งจากมือถือ' : 'รอค่าจากเครื่องคอม'}
      </p>
    </main>
  );
}

export default RemoteApp;
