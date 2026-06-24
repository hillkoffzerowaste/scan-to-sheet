import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eraser,
  ExternalLink,
  FileSpreadsheet,
  Mail,
  PackageCheck,
  Play,
  RefreshCw,
  ScanLine,
  Truck,
  UserRound,
  Volume2,
} from 'lucide-react';
import {
  COURIERS,
  appendScanGoogle,
  appendScanLocal,
  getBangkokParts,
  getLocalRows,
  getLocalSummary,
  fetchGoogleProfile,
  loadGoogleConfig,
  prepareGoogleSheets,
  resetDemoData,
} from './services/googleSheets.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

const DEFAULT_USER = {
  email: 'demo@scan-to-sheet.local',
  name: 'Demo User',
};

function App() {
  const [mode, setMode] = useState(GOOGLE_CLIENT_ID ? 'google-ready' : 'demo');
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(DEFAULT_USER);
  const [config, setConfig] = useState(() => loadGoogleConfig());
  const [selectedCourier, setSelectedCourier] = useState(COURIERS[0]);
  const [scanValue, setScanValue] = useState('');
  const [status, setStatus] = useState({
    type: 'idle',
    title: 'พร้อมสแกน',
    message: 'เลือกขนส่ง แล้วสแกนบาร์โค้ดหรือ QR ได้ทันที',
  });
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState(() => getBangkokParts());
  const [summary, setSummary] = useState(() => getLocalSummary());
  const [recentRows, setRecentRows] = useState(() => getLocalRows(COURIERS[0]));
  const [soundEnabled, setSoundEnabled] = useState(true);
  const inputRef = useRef(null);
  const audioContextRef = useRef(null);

  const selectedCount = useMemo(
    () => summary.find((item) => item.courier === selectedCourier)?.count ?? 0,
    [selectedCourier, summary],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday(getBangkokParts());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mode === 'demo') {
      setSummary(getLocalSummary(today.date));
      setRecentRows(getLocalRows(selectedCourier, today.date));
    }
  }, [mode, selectedCourier, today.date]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [selectedCourier, busy]);

  function playTone(type) {
    if (!soundEnabled) {
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }

    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.value = type === 'success' ? 980 : type === 'duplicate' ? 260 : 180;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(type === 'success' ? 0.18 : 0.25, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (type === 'success' ? 0.12 : 0.38));
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + (type === 'success' ? 0.14 : 0.4));
  }

  async function signInWithGoogle() {
    if (!GOOGLE_CLIENT_ID) {
      setMode('demo');
      setStatus({
        type: 'warning',
        title: 'ยังไม่ได้ใส่ Google Client ID',
        message: 'ตอนนี้ใช้งานโหมด demo ได้ก่อน แล้วค่อยใส่ Web OAuth client ภายหลัง',
      });
      return;
    }

    try {
      await loadGoogleIdentityScript();
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        prompt: 'consent',
        callback: async (response) => {
          if (response.error) {
            throw new Error(response.error);
          }

          setBusy(true);
          setToken(response.access_token);
          setMode('google');
          const profile = await fetchGoogleProfile(response.access_token);
          setUser({
            email: profile.email ?? DEFAULT_USER.email,
            name: profile.name ?? 'Google User',
          });
          const prepared = await prepareGoogleSheets(response.access_token);
          setConfig(prepared);
          setStatus({
            type: 'success',
            title: 'เชื่อม Google Sheet แล้ว',
            message: 'ระบบเตรียมโฟลเดอร์และไฟล์ขนส่งทั้ง 8 รายการเรียบร้อย',
          });
          setBusy(false);
        },
      });
      tokenClient.requestAccessToken();
    } catch (error) {
      setBusy(false);
      setStatus({
        type: 'error',
        title: 'เชื่อม Google ไม่สำเร็จ',
        message: error.message,
      });
    }
  }

  async function handleScanSubmit(event) {
    event.preventDefault();
    const code = scanValue.trim();
    if (!code) {
      setStatus({
        type: 'warning',
        title: 'ยังไม่มีเลขสแกน',
        message: 'ยิงบาร์โค้ดหรือกรอกเลขก่อนบันทึก',
      });
      playTone('error');
      return;
    }

    setBusy(true);
    try {
      const result =
        mode === 'google' && token && config
          ? await appendScanGoogle({
              token,
              config,
              courier: selectedCourier,
              code,
              email: user.email,
            })
          : await appendScanLocal({
              courier: selectedCourier,
              code,
              email: user.email,
            });

      setScanValue('');
      setToday({ date: result.date, time: result.time });
      setRecentRows(result.rows ?? []);
      setSummary(mode === 'demo' ? getLocalSummary(result.date) : updateSummary(summary, selectedCourier, result.count));

      if (result.status === 'duplicate') {
        setStatus({
          type: 'duplicate',
          title: 'เลขซ้ำ',
          message: `${result.code} มีอยู่แล้วใน ${selectedCourier} วันที่ ${result.date}`,
        });
        playTone('duplicate');
      } else {
        setStatus({
          type: 'success',
          title: 'สแกนสำเร็จ',
          message: `${result.code} ถูกบันทึกเข้า ${selectedCourier} วันที่ ${result.date}`,
        });
        playTone('success');
      }
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'บันทึกไม่สำเร็จ',
        message: error.message,
      });
      playTone('error');
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }

  function clearDemo() {
    resetDemoData();
    setSummary(getLocalSummary(today.date));
    setRecentRows([]);
    setStatus({
      type: 'idle',
      title: 'ล้างข้อมูล demo แล้ว',
      message: 'ข้อมูลจริงบน Google Sheet จะไม่ถูกแตะ',
    });
  }

  const sheetUrl = config?.sheets?.[selectedCourier]?.webViewLink;

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Scan to Sheet</p>
          <h1>สแกนใบปะหน้าเข้า Google Sheet</h1>
        </div>
        <div className="account-strip">
          <div className="account-pill">
            <Mail size={16} />
            <span>{user.email}</span>
          </div>
          <button className="icon-button" type="button" onClick={() => setSoundEnabled((value) => !value)} title="เปิด/ปิดเสียง">
            <Volume2 size={18} />
          </button>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="side-panel">
          <div className="panel-heading">
            <Truck size={18} />
            <span>เลือกขนส่ง</span>
          </div>

          <div className="courier-list">
            {COURIERS.map((courier) => (
              <button
                className={`courier-button ${courier === selectedCourier ? 'active' : ''}`}
                key={courier}
                type="button"
                onClick={() => setSelectedCourier(courier)}
              >
                <span>{courier}</span>
                <strong>{summary.find((item) => item.courier === courier)?.count ?? 0}</strong>
              </button>
            ))}
          </div>

          <div className="connect-box">
            <div className="connect-title">
              <FileSpreadsheet size={18} />
              <span>{mode === 'google' ? 'Google พร้อมใช้งาน' : 'Demo mode'}</span>
            </div>
            <p>
              {mode === 'google'
                ? 'กำลังบันทึกเข้า Google Drive และ Google Sheet จริง'
                : 'ทดลอง flow ได้ทันที ข้อมูลเก็บใน browser ก่อนใส่ Web OAuth client'}
            </p>
            <button className="secondary-button" type="button" onClick={signInWithGoogle} disabled={busy}>
              <UserRound size={16} />
              <span>{GOOGLE_CLIENT_ID ? 'Login with Google' : 'รอใส่ OAuth Client ID'}</span>
            </button>
            {mode === 'demo' && (
              <button className="ghost-button" type="button" onClick={clearDemo}>
                <Eraser size={16} />
                <span>ล้างข้อมูล demo</span>
              </button>
            )}
          </div>
        </aside>

        <section className="scan-panel">
          <div className="scan-header">
            <div>
              <p className="eyebrow">ขนส่งที่เลือก</p>
              <h2>{selectedCourier}</h2>
            </div>
            <div className="date-box">
              <Clock3 size={18} />
              <span>{today.date}</span>
              <strong>{today.time}</strong>
            </div>
          </div>

          <form className="scan-form" onSubmit={handleScanSubmit}>
            <label htmlFor="scan-input">Tracking / Barcode</label>
            <div className="scan-input-row">
              <ScanLine size={24} />
              <input
                id="scan-input"
                ref={inputRef}
                value={scanValue}
                onChange={(event) => setScanValue(event.target.value)}
                placeholder="ยิงบาร์โค้ดหรือ QR แล้วกด Enter"
                autoComplete="off"
                disabled={busy}
              />
              <button type="submit" disabled={busy}>
                {busy ? <RefreshCw size={18} className="spin" /> : <Play size={18} />}
                <span>บันทึก</span>
              </button>
            </div>
          </form>

          <StatusBanner status={status} />

          <div className="metric-row">
            <div>
              <span>ยอดวันนี้</span>
              <strong>{selectedCount}</strong>
            </div>
            <div>
              <span>แผ่นงาน</span>
              <strong>{today.date}</strong>
            </div>
            <div>
              <span>สถานะ</span>
              <strong>{mode === 'google' ? 'Google Sheet' : 'Demo'}</strong>
            </div>
          </div>

          <div className="recent-header">
            <h3>รายการล่าสุด</h3>
            {sheetUrl && (
              <a href={sheetUrl} target="_blank" rel="noreferrer">
                เปิด Sheet <ExternalLink size={14} />
              </a>
            )}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>เวลา</th>
                  <th>Tracking / Barcode</th>
                  <th>ผู้สแกน</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="empty-cell">
                      ยังไม่มีรายการของวันนี้
                    </td>
                  </tr>
                ) : (
                  recentRows.slice(0, 12).map((row) => (
                    <tr key={`${row.no}-${row.code}-${row.time}`}>
                      <td>{row.no}</td>
                      <td>{row.time}</td>
                      <td className="code-cell">{row.code}</td>
                      <td>{row.email}</td>
                      <td>{row.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function StatusBanner({ status }) {
  const Icon = status.type === 'success' ? CheckCircle2 : status.type === 'duplicate' || status.type === 'warning' ? AlertTriangle : PackageCheck;
  return (
    <div className={`status-banner ${status.type}`}>
      <Icon size={22} />
      <div>
        <strong>{status.title}</strong>
        <span>{status.message}</span>
      </div>
    </div>
  );
}

function updateSummary(summary, courier, count) {
  return summary.map((item) => (item.courier === courier ? { ...item, count } : item));
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('โหลด Google Identity Services ไม่สำเร็จ'));
    document.head.appendChild(script);
  });
}

export default App;
