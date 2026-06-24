import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileSpreadsheet,
  LogIn,
  LogOut,
  Mail,
  Moon,
  PackageCheck,
  Play,
  RefreshCw,
  ScanLine,
  Sun,
  Truck,
  Volume2,
} from 'lucide-react';
import {
  COURIERS,
  appendScanGoogle,
  fetchGoogleProfile,
  getBangkokParts,
  getTodayRowsGoogle,
  loadGoogleConfig,
  prepareGoogleSheets,
} from './services/googleSheets.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

const EMPTY_USER = {
  email: 'ยังไม่ได้เข้าสู่ระบบ',
  name: '',
};
const THEME_KEY = 'scan-to-sheet-theme';

function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(EMPTY_USER);
  const [config, setConfig] = useState(() => loadGoogleConfig());
  const [selectedCourier, setSelectedCourier] = useState(COURIERS[0]);
  const [scanValue, setScanValue] = useState('');
  const [status, setStatus] = useState(() => ({
    type: GOOGLE_CLIENT_ID ? 'idle' : 'warning',
    title: GOOGLE_CLIENT_ID ? 'พร้อมเชื่อม Google' : 'ต้องใส่ OAuth Client ID',
    message: GOOGLE_CLIENT_ID
      ? 'เข้าสู่ระบบด้วย Google ก่อนเริ่มสแกนจริง'
      : 'เพิ่ม VITE_GOOGLE_CLIENT_ID ใน Vercel Environment Variables แล้ว deploy ใหม่',
  }));
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState(() => getBangkokParts());
  const [summary, setSummary] = useState(() => COURIERS.map((courier) => ({ courier, count: 0 })));
  const [recentRows, setRecentRows] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light');
  const inputRef = useRef(null);
  const audioContextRef = useRef(null);

  const isGoogleReady = Boolean(GOOGLE_CLIENT_ID);
  const isSignedIn = Boolean(token && config);
  const selectedCount = useMemo(
    () => summary.find((item) => item.courier === selectedCourier)?.count ?? 0,
    [selectedCourier, summary],
  );
  const sheetUrl = config?.sheets?.[selectedCourier]?.webViewLink;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute('content', theme === 'dark' ? '#111816' : '#f3f6f8');
    }
  }, [theme]);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const error = hash.get('error');
    const errorDescription = hash.get('error_description');

    if (!accessToken && !error) {
      return;
    }

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

    if (error) {
      setStatus({
        type: 'error',
        title: 'เข้าสู่ระบบไม่สำเร็จ',
        message: errorDescription || error,
      });
      setBusy(false);
      return;
    }

    completeGoogleSignIn(accessToken);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday(getBangkokParts());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isSignedIn) {
      inputRef.current?.focus();
    }
  }, [isSignedIn, selectedCourier, busy]);

  useEffect(() => {
    if (!isSignedIn) {
      setRecentRows([]);
      return;
    }

    refreshSelectedCourierRows();
  }, [selectedCourier, today.date, isSignedIn]);

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
      setStatus({
        type: 'warning',
        title: 'ยังไม่ได้ใส่ OAuth Client ID',
        message: 'ตั้งค่า VITE_GOOGLE_CLIENT_ID บน Vercel แล้ว deploy ใหม่ก่อนใช้งานจริง',
      });
      return;
    }

    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope: SCOPES,
      include_granted_scopes: 'true',
      prompt: 'consent',
    });

    setBusy(true);
    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  async function completeGoogleSignIn(accessToken) {
    try {
      setBusy(true);
      setToken(accessToken);
      const profile = await fetchGoogleProfile(accessToken);
      const prepared = await prepareGoogleSheets(accessToken);
      setUser({
        email: profile.email ?? 'google-user',
        name: profile.name ?? 'Google User',
      });
      setConfig(prepared);
      await refreshAllCounts(accessToken, prepared);
      setStatus({
        type: 'success',
        title: 'เชื่อม Google Sheet แล้ว',
        message: 'ระบบเตรียมโฟลเดอร์และไฟล์ขนส่งทั้ง 8 รายการเรียบร้อย',
      });
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'เชื่อม Google ไม่สำเร็จ',
        message: error.message,
      });
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    setToken(null);
    setUser(EMPTY_USER);
    setSummary(COURIERS.map((courier) => ({ courier, count: 0 })));
    setRecentRows([]);
    setStatus({
      type: 'idle',
      title: 'ออกจากระบบแล้ว',
      message: 'เข้าสู่ระบบด้วย Google อีกครั้งเมื่อต้องการสแกน',
    });
  }

  async function refreshAllCounts(accessToken = token, googleConfig = config) {
    if (!accessToken || !googleConfig) {
      return;
    }

    const date = getBangkokParts().date;
    const rowsByCourier = await Promise.all(
      COURIERS.map(async (courier) => {
        const rows = await getTodayRowsGoogle({
          token: accessToken,
          config: googleConfig,
          courier,
          date,
        });
        return { courier, rows };
      }),
    );

    setSummary(rowsByCourier.map(({ courier, rows }) => ({ courier, count: rows.length })));
    const selected = rowsByCourier.find((item) => item.courier === selectedCourier);
    setRecentRows(selected?.rows ?? []);
  }

  async function refreshSelectedCourierRows() {
    if (!token || !config) {
      return;
    }

    try {
      const rows = await getTodayRowsGoogle({
        token,
        config,
        courier: selectedCourier,
        date: today.date,
      });
      setRecentRows(rows);
      setSummary((current) => updateSummary(current, selectedCourier, rows.length));
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'โหลดรายการไม่สำเร็จ',
        message: error.message,
      });
    }
  }

  async function handleScanSubmit(event) {
    event.preventDefault();

    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'กด Login with Google เพื่อบันทึกเข้า Google Sheet จริง',
      });
      playTone('error');
      return;
    }

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
      const result = await appendScanGoogle({
        token,
        config,
        courier: selectedCourier,
        code,
        email: user.email,
      });

      setScanValue('');
      setToday({ date: result.date, time: result.time });
      setRecentRows(result.rows ?? []);
      setSummary((current) => updateSummary(current, selectedCourier, result.count));

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
          <div className="theme-toggle" aria-label="เลือกโหมดสี">
            <button
              className={theme === 'light' ? 'active' : ''}
              type="button"
              onClick={() => setTheme('light')}
              title="Light mode"
            >
              <Sun size={16} />
              <span>Light</span>
            </button>
            <button
              className={theme === 'dark' ? 'active' : ''}
              type="button"
              onClick={() => setTheme('dark')}
              title="Dark mode"
            >
              <Moon size={16} />
              <span>Dark</span>
            </button>
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
                disabled={!isSignedIn}
              >
                <span>{courier}</span>
                <strong>{summary.find((item) => item.courier === courier)?.count ?? 0}</strong>
              </button>
            ))}
          </div>

          <div className="connect-box">
            <div className="connect-title">
              <FileSpreadsheet size={18} />
              <span>{isSignedIn ? 'Google พร้อมใช้งาน' : 'Google ยังไม่เชื่อม'}</span>
            </div>
            <p>
              {isSignedIn
                ? 'กำลังบันทึกเข้า Google Drive และ Google Sheet จริง'
                : 'ระบบนี้ใช้ Google Sheet จริงเท่านั้น'}
            </p>
            {isSignedIn ? (
              <button className="ghost-button" type="button" onClick={signOut}>
                <LogOut size={16} />
                <span>ออกจากระบบ</span>
              </button>
            ) : (
              <button className="secondary-button" type="button" onClick={signInWithGoogle} disabled={busy || !isGoogleReady}>
                {busy ? <RefreshCw size={16} className="spin" /> : <LogIn size={16} />}
                <span>{isGoogleReady ? 'Login with Google' : 'รอใส่ OAuth Client ID'}</span>
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
                placeholder={isSignedIn ? 'ยิงบาร์โค้ดหรือ QR แล้วกด Enter' : 'Login with Google ก่อนเริ่มสแกน'}
                autoComplete="off"
                disabled={busy || !isSignedIn}
              />
              <button type="submit" disabled={busy || !isSignedIn}>
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
              <strong>{isSignedIn ? 'Google Sheet' : 'รอ Login'}</strong>
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
                      {isSignedIn ? 'ยังไม่มีรายการของวันนี้' : 'เข้าสู่ระบบเพื่อโหลดรายการจาก Google Sheet'}
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

export default App;
