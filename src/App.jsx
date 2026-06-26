import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Camera,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileSpreadsheet,
  LogIn,
  LogOut,
  Mail,
  Moon,
  PackageCheck,
  ClipboardCopy,
  Play,
  RefreshCw,
  Repeat,
  ScanLine,
  Search,
  Square,
  Sun,
  Truck,
  Volume2,
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  COURIERS,
  appendScanGoogle,
  fetchGoogleProfile,
  getBangkokParts,
  getScanReportGoogle,
  getTodayRowsGoogle,
  listDatesBetween,
  listDatesInMonth,
  loadGoogleConfig,
  prepareGoogleSheets,
  searchScansGoogle,
  updateScanIssueGoogle,
  validateScanCode,
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
const GOOGLE_SESSION_KEY = 'scan-to-sheet-google-session-v1';
const CAMERA_REGION_ID = 'camera-reader';
const CAMERA_COOLDOWN_MS = 2500;
const CAMERA_SCAN_FPS = 18;
const ISSUE_CUSTOMER_CANCELLED = 'ลูกค้ายกเลิก';
const ISSUE_DAMAGED = 'สินค้าเสียหาย';
const PACKER_UNASSIGNED = 'ยังไม่ระบุ';
const PACKERS = [PACKER_UNASSIGNED, 'กิต', 'มาย', 'ยุทธ', 'หล้า', 'มุก'];

function loadStoredGoogleSession() {
  try {
    return JSON.parse(localStorage.getItem(GOOGLE_SESSION_KEY)) ?? null;
  } catch {
    return null;
  }
}

function saveStoredGoogleSession(session) {
  localStorage.setItem(GOOGLE_SESSION_KEY, JSON.stringify(session));
}

function clearStoredGoogleSession() {
  localStorage.removeItem(GOOGLE_SESSION_KEY);
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `API error ${response.status}`);
  }
  return data;
}

async function loadServerGoogleConfig() {
  const data = await apiJson('/api/google-config');
  return data.config ?? null;
}

async function saveServerGoogleConfig(config) {
  if (!config?.master?.id) {
    return;
  }

  await apiJson('/api/google-config', {
    method: 'POST',
    body: JSON.stringify({ config }),
  });
}

function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(EMPTY_USER);
  const [config, setConfig] = useState(() => loadGoogleConfig());
  const [selectedCourier, setSelectedCourier] = useState(COURIERS[0]);
  const [scanValue, setScanValue] = useState('');
  const [selectedPacker, setSelectedPacker] = useState(PACKER_UNASSIGNED);
  const [scanRemark, setScanRemark] = useState('');
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
  const [showAllRecentRows, setShowAllRecentRows] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light');
  const [scanMethod, setScanMethod] = useState('camera');
  const [scanMode, setScanMode] = useState('single');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraMessage, setCameraMessage] = useState('เปิดกล้อง แล้วเล็งบาร์โค้ดหลักให้อยู่ในกรอบ');
  const [cameraMessageType, setCameraMessageType] = useState('idle');
  const [searchValue, setSearchValue] = useState('');
  const [searchScope, setSearchScope] = useState('selected');
  const [searchMode, setSearchMode] = useState('today');
  const [searchStartDate, setSearchStartDate] = useState(() => getBangkokParts().date);
  const [searchEndDate, setSearchEndDate] = useState(() => getBangkokParts().date);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [reportMode, setReportMode] = useState('daily');
  const [reportDate, setReportDate] = useState(() => getBangkokParts().date);
  const [reportStartDate, setReportStartDate] = useState(() => getBangkokParts().date);
  const [reportEndDate, setReportEndDate] = useState(() => getBangkokParts().date);
  const [reportMonth, setReportMonth] = useState(() => getBangkokParts().date.slice(0, 7));
  const [reportBusy, setReportBusy] = useState(false);
  const [reportData, setReportData] = useState(null);
  const inputRef = useRef(null);
  const audioContextRef = useRef(null);
  const cameraRef = useRef(null);
  const scanModeRef = useRef(scanMode);
  const lastCameraScanRef = useRef({ code: '', time: 0 });
  const cameraSavingRef = useRef(false);

  const isGoogleReady = Boolean(GOOGLE_CLIENT_ID);
  const isSignedIn = Boolean(token && config);
  const selectedCount = useMemo(
    () => summary.find((item) => item.courier === selectedCourier)?.count ?? 0,
    [selectedCourier, summary],
  );
  const totalTodayCount = useMemo(() => summary.reduce((sum, item) => sum + item.count, 0), [summary]);
  const displayedRecentRows = showAllRecentRows ? recentRows : recentRows.slice(0, 3);
  const sheetUrl = config?.master?.webViewLink;
  const requiresPacker = scanRemark !== ISSUE_CUSTOMER_CANCELLED;
  const isPackerReady = !requiresPacker || selectedPacker !== PACKER_UNASSIGNED;

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
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    if (!code && !error) {
      restoreGoogleSession();
      return;
    }

    window.history.replaceState(null, '', window.location.pathname);

    if (error) {
      setStatus({
        type: 'error',
        title: 'เข้าสู่ระบบไม่สำเร็จ',
        message: errorDescription || error,
      });
      setBusy(false);
      return;
    }

    completeGoogleSignIn(code);
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
    if (!isSignedIn || scanMethod !== 'camera') {
      stopCamera();
    }
  }, [isSignedIn, scanMethod]);

  useEffect(() => {
    scanModeRef.current = scanMode;
  }, [scanMode]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      setRecentRows([]);
      return;
    }

    refreshSelectedCourierRows();
  }, [selectedCourier, today.date, isSignedIn]);

  useEffect(() => {
    setShowAllRecentRows(false);
  }, [selectedCourier, today.date]);

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
    const now = context.currentTime;
    const patterns = {
      success: [
        { frequency: 1320, duration: 0.22, offset: 0, peak: 0.82, wave: 'square' },
        { frequency: 1760, duration: 0.28, offset: 0.24, peak: 0.86, wave: 'square' },
      ],
      duplicate: [
        { frequency: 220, duration: 0.38, offset: 0, peak: 0.9, wave: 'sawtooth' },
        { frequency: 150, duration: 0.38, offset: 0.4, peak: 0.9, wave: 'sawtooth' },
        { frequency: 220, duration: 0.42, offset: 0.82, peak: 0.9, wave: 'sawtooth' },
      ],
      ignored: [
        { frequency: 420, duration: 0.28, offset: 0, peak: 0.78, wave: 'square' },
        { frequency: 300, duration: 0.32, offset: 0.3, peak: 0.82, wave: 'square' },
      ],
      error: [
        { frequency: 180, duration: 0.46, offset: 0, peak: 0.92, wave: 'sawtooth' },
        { frequency: 120, duration: 0.52, offset: 0.48, peak: 0.92, wave: 'sawtooth' },
      ],
    };
    const pattern = patterns[type] ?? patterns.error;

    pattern.forEach((tone) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startsAt = now + tone.offset;
      const endsAt = startsAt + tone.duration;

      oscillator.type = tone.wave;
      oscillator.frequency.setValueAtTime(tone.frequency, startsAt);
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(tone.peak, startsAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, endsAt - 0.02);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(endsAt);
    });
  }

  function showCameraMessage(message, type = 'idle') {
    setCameraMessage(message);
    setCameraMessageType(type);
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
      response_type: 'code',
      scope: SCOPES,
      include_granted_scopes: 'true',
      // access_type=offline + prompt=consent ensures each login receives a
      // refresh token.  Google allows up to 50 valid refresh tokens per
      // account+client, which is enough for several machines scanning
      // simultaneously.  Each browser’s session stores its own refresh
      // token independently in Vercel KV, so concurrent logins do not
      // invalidate other devices.
      access_type: 'offline',
      prompt: 'consent',
    });

    setBusy(true);
    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  async function completeGoogleSignIn(code) {
    try {
      setBusy(true);
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const data = await apiJson('/api/google-auth', {
        method: 'POST',
        body: JSON.stringify({ code, redirectUri }),
      });
      await activateGoogleSession(data);
      setStatus({
        type: 'success',
        title: 'เชื่อม Google Sheet แล้ว',
        message: 'ระบบเตรียม Google Sheet Master เรียบร้อย',
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

  async function restoreGoogleSession() {
    const stored = loadStoredGoogleSession();
    if (stored?.accessToken && stored.expiresAt > Date.now() + 60_000) {
      try {
        setBusy(true);
        setToken(stored.accessToken);
        setUser(stored.user ?? EMPTY_USER);
        const serverConfig = await loadServerGoogleConfig().catch(() => null);
        const prepared = serverConfig ?? (await prepareGoogleSheets(stored.accessToken));
        setConfig(prepared);
        saveStoredGoogleSession({ ...stored, config: prepared });
        await saveServerGoogleConfig(prepared).catch(() => {});
        await refreshAllCounts(stored.accessToken, prepared);
        setStatus({
          type: 'success',
          title: 'กลับมาใช้งานต่อได้',
          message: 'ใช้ session เดิมจาก browser',
        });
        return;
      } catch {
        clearStoredGoogleSession();
      } finally {
        setBusy(false);
      }
    }

    await refreshGoogleSessionFromServer();
  }

  async function refreshGoogleSessionFromServer({ silent = false } = {}) {
    try {
      setBusy(true);
      const data = await apiJson('/api/google-token');
      const session = await activateGoogleSession(data);
      if (!silent) {
        setStatus({
          type: 'success',
          title: 'ต่ออายุ Login แล้ว',
          message: 'ดึง session จาก Vercel KV สำเร็จ',
        });
      }
      return session;
    } catch {
      clearStoredGoogleSession();
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function activateGoogleSession(data) {
    const accessToken = data.accessToken;
    const profile = data.profile ?? (await fetchGoogleProfile(accessToken));
    const serverConfig = data.config ?? (await loadServerGoogleConfig().catch(() => null));
    const prepared = serverConfig ?? (await prepareGoogleSheets(accessToken));
    const nextUser = {
      email: profile.email ?? 'google-user',
      name: profile.name ?? 'Google User',
    };
    setToken(accessToken);
    setUser(nextUser);
    setConfig(prepared);
    saveStoredGoogleSession({
      accessToken,
      expiresAt: Date.now() + Math.max((data.expiresIn ?? 3600) - 60, 60) * 1000,
      user: nextUser,
      config: prepared,
    });
    await saveServerGoogleConfig(prepared).catch(() => {});
    await refreshAllCounts(accessToken, prepared);
    return { accessToken, config: prepared, user: nextUser };
  }

  async function runWithGoogleRetry(action) {
    try {
      return await action(token, config);
    } catch (error) {
      if (!isGoogleAuthError(error)) {
        throw error;
      }

      const session = await refreshGoogleSessionFromServer({ silent: true });
      if (!session?.accessToken || !session?.config) {
        throw error;
      }

      return action(session.accessToken, session.config);
    }
  }

  function isGoogleAuthError(error) {
    const message = String(error?.message ?? '').toLowerCase();
    return (
      message.includes('401') ||
      message.includes('invalid authentication') ||
      message.includes('invalid credentials') ||
      message.includes('unauthorized')
    );
  }

  async function signOut() {
    try {
      await fetch('/api/google-logout', { method: 'POST' });
    } catch {
      // Local sign-out still clears browser state even if the server is unreachable.
    }
    clearStoredGoogleSession();
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
      const rows = await runWithGoogleRetry((accessToken, googleConfig) =>
        getTodayRowsGoogle({
          token: accessToken,
          config: googleConfig,
          courier: selectedCourier,
          date: today.date,
        }),
      );
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

  async function saveScannedCode(rawCode, source = 'manual') {
    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'กด Login with Google เพื่อบันทึกเข้า Google Sheet จริง',
      });
      playTone('error');
      return { status: 'error' };
    }

    if (scanRemark !== ISSUE_CUSTOMER_CANCELLED && selectedPacker === PACKER_UNASSIGNED) {
      setStatus({
        type: 'warning',
        title: 'เลือก Packer ก่อนสแกน',
        message: 'ต้องเลือกชื่อผู้แพ็คก่อนบันทึกออเดอร์ปกติ',
      });
      showCameraMessage('เลือก Packer ก่อนสแกน', 'error');
      playTone('error');
      return { status: 'error' };
    }

    const validation = validateScanCode(selectedCourier, rawCode);
    if (!validation.ok) {
      const isEmpty = !validation.code;
      setStatus({
        type: isEmpty ? 'warning' : 'ignored',
        title: isEmpty ? 'ยังไม่มีเลขสแกน' : 'ไม่ใช่บาร์โค้ดหลัก',
        message: validation.reason,
      });
      showCameraMessage(validation.reason, isEmpty ? 'error' : 'ignored');
      playTone(isEmpty ? 'error' : 'ignored');
      return { status: isEmpty ? 'error' : 'ignored', code: validation.code };
    }

    setBusy(true);
    try {
      const result = await runWithGoogleRetry((accessToken, googleConfig) =>
        appendScanGoogle({
          token: accessToken,
          config: googleConfig,
          courier: selectedCourier,
          code: validation.code,
          email: user.email,
          packer: selectedPacker === PACKER_UNASSIGNED ? '' : selectedPacker,
          note: scanRemark,
        }),
      );

      if (source === 'manual') {
        setScanValue('');
      } else {
        setScanValue(result.code);
      }
      setToday({ date: result.date, time: result.time });
      setRecentRows(result.rows ?? []);
      setSummary((current) => updateSummary(current, selectedCourier, result.count));

      if (result.status === 'cancelled') {
        setStatus({
          type: 'success',
          title: 'บันทึกยกเลิกแล้ว',
          message: `${result.code} ถูกทำเครื่องหมาย ${ISSUE_CUSTOMER_CANCELLED} ใน ${selectedCourier}`,
        });
        showCameraMessage(`${result.code} ยกเลิกแล้ว`, 'success');
        playTone('success');
        setScanRemark('');
      } else if (result.status === 'duplicate') {
        setStatus({
          type: 'duplicate',
          title: 'เลขซ้ำ',
          message: `${result.code} มีอยู่แล้วใน ${selectedCourier} วันที่ ${result.date}`,
        });
        showCameraMessage(`เลขซ้ำ: ${result.code}`, 'duplicate');
        playTone('duplicate');
      } else {
        setStatus({
          type: 'success',
          title: 'สแกนสำเร็จ',
          message: `${result.code} ถูกบันทึกเข้า ${selectedCourier} โดย ${selectedPacker} วันที่ ${result.date}${scanRemark ? ` (${scanRemark})` : ''}`,
        });
        showCameraMessage(`${result.code} บันทึกสำเร็จ`, 'success');
        playTone('success');
        setScanRemark('');
      }
      return { ...result, status: result.status };
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'บันทึกไม่สำเร็จ',
        message: error.message,
      });
      showCameraMessage(error.message, 'error');
      playTone('error');
      return { status: 'error', message: error.message };
    } finally {
      setBusy(false);
      cameraSavingRef.current = false;
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }

  async function handleScanSubmit(event) {
    event.preventDefault();
    await saveScannedCode(scanValue, 'manual');
  }

  async function stopCamera() {
    const scanner = cameraRef.current;
    cameraRef.current = null;
    cameraSavingRef.current = false;
    lastCameraScanRef.current = { code: '', time: 0 };

    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
        await scanner.clear();
      } catch {
        // Camera cleanup can throw if the stream has already stopped.
      }
    }

    setCameraActive(false);
  }

  async function handleCameraDetected(decodedText) {
    const code = String(decodedText ?? '').trim();
    if (!code || cameraSavingRef.current) {
      return;
    }

    const now = Date.now();
    const lastScan = lastCameraScanRef.current;
    if (lastScan.code === code && now - lastScan.time < CAMERA_COOLDOWN_MS) {
      return;
    }

    lastCameraScanRef.current = { code, time: now };
    cameraSavingRef.current = true;
    showCameraMessage(`อ่านได้: ${code}`, 'idle');

    const result = await saveScannedCode(code, 'camera');
    if (scanModeRef.current === 'single') {
      await stopCamera();
      if (result.status === 'success' || result.status === 'cancelled') {
        showCameraMessage('หยุดแล้ว: สแกนทีละรายการเสร็จ', 'success');
      }
    }
  }

  async function startCamera() {
    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'Login with Google ก่อนเปิดกล้องสแกน',
      });
      playTone('error');
      return;
    }

    if (cameraActive || cameraRef.current) {
      return;
    }

    try {
      showCameraMessage('กำลังเปิดกล้อง...', 'idle');
      const scanner = new Html5Qrcode(CAMERA_REGION_ID, {
        useBarCodeDetectorIfSupported: true,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.ITF,
        ],
        verbose: false,
      });
      cameraRef.current = scanner;

      const scanConfig = {
        fps: CAMERA_SCAN_FPS,
        qrbox: (viewfinderWidth, viewfinderHeight) => ({
          width: Math.floor(Math.min(viewfinderWidth * 0.92, 680)),
          height: Math.floor(Math.min(viewfinderHeight * 0.72, 360)),
        }),
        disableFlip: true,
      };

      await scanner.start({ facingMode: 'environment' }, scanConfig, handleCameraDetected, () => {});

      await improveCameraFocus(scanner);
      setCameraActive(true);
      showCameraMessage('เล็ง QR หรือบาร์โค้ดหลักให้อยู่ในกรอบใหญ่ ถอยห่างเล็กน้อยให้เห็นโค้ดครบทั้งแถบ', 'idle');
    } catch (error) {
      cameraRef.current = null;
      setCameraActive(false);
      showCameraMessage(error.message, 'error');
      setStatus({
        type: 'error',
        title: 'เปิดกล้องไม่สำเร็จ',
        message: error.message,
      });
      playTone('error');
    }
  }

  async function improveCameraFocus(scanner) {
    try {
      const capabilities = scanner.getRunningTrackCapabilities?.() ?? {};
      const constraints = {};

      if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
        constraints.focusMode = 'continuous';
      }

      if (Object.keys(constraints).length > 0) {
        await scanner.applyVideoConstraints(constraints);
      }
    } catch {
      // Some mobile browsers reject advanced camera constraints; scanning can continue normally.
    }
  }

  async function handleSearchSubmit(event) {
    event.preventDefault();

    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'Login with Google ก่อนค้นหาเลขพัสดุจาก Google Sheet',
      });
      return;
    }

    const query = searchValue.trim();
    if (!query) {
      setStatus({
        type: 'warning',
        title: 'กรอกเลขที่ต้องการค้นหา',
        message: 'พิมพ์เลขพัสดุหรือบางส่วนของเลขก่อนกดค้นหา',
      });
      return;
    }

    const dates = getSearchDates();
    if (searchMode !== 'all' && dates.length === 0) {
      setStatus({
        type: 'warning',
        title: 'ช่วงวันที่ไม่ถูกต้อง',
        message: 'เลือกวันที่เริ่มต้นและสิ้นสุดให้ถูกต้องก่อนค้นหา',
      });
      return;
    }

    setSearchBusy(true);
    try {
      const results = await runWithGoogleRetry((accessToken, googleConfig) =>
        searchScansGoogle({
          token: accessToken,
          config: googleConfig,
          query,
          couriers: searchScope === 'all' ? COURIERS : [selectedCourier],
          dates: searchMode === 'all' ? null : dates,
        }),
      );
      setSearchResults(results);
      setStatus({
        type: results.length > 0 ? 'success' : 'warning',
        title: results.length > 0 ? 'พบเลขพัสดุ' : 'ไม่พบเลขพัสดุ',
        message:
          results.length > 0
            ? `พบ ${results.length} รายการจาก Google Sheet`
            : `${query} ยังไม่พบในเงื่อนไขที่เลือก`,
      });
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'ค้นหาไม่สำเร็จ',
        message: error.message,
      });
    } finally {
      setSearchBusy(false);
    }
  }

  async function markSearchResultDamaged(row) {
    if (!isSignedIn || !row) {
      return;
    }

    setSearchBusy(true);
    try {
      const updatedRow = await runWithGoogleRetry((accessToken, googleConfig) =>
        updateScanIssueGoogle({
          token: accessToken,
          config: googleConfig,
          row,
          issue: ISSUE_DAMAGED,
        }),
      );
      setSearchResults((current) =>
        current?.map((item) =>
          item.date === row.date && item.no === row.no && item.code === row.code ? { ...item, ...updatedRow } : item,
        ) ?? null,
      );
      if (updatedRow.date === today.date && updatedRow.courier === selectedCourier) {
        await refreshSelectedCourierRows();
      }
      setStatus({
        type: 'success',
        title: 'บันทึกสินค้าเสียหายแล้ว',
        message: `${updatedRow.code} ถูกบันทึกใน Remark / Issue`,
      });
      playTone('success');
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'บันทึกสินค้าเสียหายไม่สำเร็จ',
        message: error.message,
      });
      playTone('error');
    } finally {
      setSearchBusy(false);
    }
  }

  function getSearchDates() {
    if (searchMode === 'today') {
      return [today.date];
    }

    if (searchMode === 'range') {
      return listDatesBetween(searchStartDate, searchEndDate);
    }

    return [];
  }

  async function generateReport() {
    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'Login with Google ก่อนดูรายงานจาก Google Sheet',
      });
      return;
    }

    const dates = getReportDates();
    if (dates.length === 0) {
      setStatus({
        type: 'warning',
        title: 'ช่วงวันที่ไม่ถูกต้อง',
        message: 'เลือกวันที่เริ่มต้นและสิ้นสุดให้ถูกต้องก่อนสร้างรายงาน',
      });
      return;
    }

    setReportBusy(true);
    try {
      const data = await runWithGoogleRetry((accessToken, googleConfig) =>
        getScanReportGoogle({ token: accessToken, config: googleConfig, dates }),
      );
      setReportData({
        ...data,
        mode: reportMode,
        label: getReportLabel(dates),
      });
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'สร้างรายงานไม่สำเร็จ',
        message: error.message,
      });
    } finally {
      setReportBusy(false);
    }
  }

  function getReportDates() {
    if (reportMode === 'daily') {
      return reportDate ? [reportDate] : [];
    }

    if (reportMode === 'range') {
      return listDatesBetween(reportStartDate, reportEndDate);
    }

    return listDatesInMonth(reportMonth);
  }

  function getReportLabel(dates) {
    if (reportMode === 'daily') {
      return reportDate;
    }

    if (reportMode === 'range') {
      return `${dates[0]} ถึง ${dates[dates.length - 1]}`;
    }

    return reportMonth;
  }

  function buildReportText(data = reportData) {
    if (!data) {
      return '';
    }

    const generatedAt = getBangkokParts();
    const modeLabel = data.mode === 'daily' ? 'รายวัน' : data.mode === 'range' ? 'ช่วงวันที่' : 'รายเดือน';
    const lines = [
      `รายงานสแกนพัสดุ (${modeLabel})`,
      `ช่วงรายงาน: ${data.label}`,
      `ยอดส่งจริง: ${data.total} รายการ`,
      `ยกเลิก: ${data.cancelledTotal ?? 0} รายการ`,
      `สินค้าเสียหาย: ${data.damagedTotal ?? 0} รายการ`,
      '',
      'ยอดแยกตามขนส่ง',
      ...COURIERS.map((courier) => {
        const count = data.couriers?.find((item) => item.courier === courier)?.count ?? 0;
        return `${courier}: ${count} รายการ`;
      }),
    ];

    if (data.days?.length > 1) {
      lines.push('', 'สรุปตามวันที่');
      data.days.forEach((day) => {
        lines.push(`${day.date}: ${day.total} รายการ`);
      });
    }

    if (data.cancelledRows?.length > 0) {
      lines.push('', 'รายการยกเลิก');
      data.cancelledRows.forEach((row) => {
        lines.push(`${row.date} ${row.time} | ${row.courier} | ${row.code}`);
      });
    }

    if (data.damagedRows?.length > 0) {
      lines.push('', 'รายการสินค้าเสียหาย');
      data.damagedRows.forEach((row) => {
        lines.push(`${row.date} ${row.time} | ${row.courier} | ${row.code}`);
      });
    }

    lines.push('', `สร้างจากระบบ Scan to Sheet เวลา ${generatedAt.date} ${generatedAt.time}`);
    return lines.join('\n');
  }

  async function copyReport() {
    if (!reportData) {
      return;
    }

    const text = buildReportText(reportData);
    try {
      await navigator.clipboard.writeText(text);
      setStatus({
        type: 'success',
        title: 'คัดลอกรายงานแล้ว',
        message: 'นำไปวางใน Gmail, LINE หรือช่องทางที่ต้องการได้เลย',
      });
      playTone('success');
    } catch {
      setStatus({
        type: 'error',
        title: 'คัดลอกไม่สำเร็จ',
        message: 'เบราว์เซอร์ไม่อนุญาตให้เข้าถึง Clipboard ลองกดคัดลอกใหม่อีกครั้ง',
      });
      playTone('error');
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
          <div className="top-connect-box">
            <div className="connect-title">
              <FileSpreadsheet size={18} />
              <span>{isSignedIn ? 'Google พร้อมใช้งาน' : 'Google ยังไม่เชื่อม'}</span>
            </div>
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
          {sheetUrl && (
            <a className="ghost-button master-sheet-link" href={sheetUrl} target="_blank" rel="noreferrer">
              <FileSpreadsheet size={16} />
              <span>Master Sheet</span>
            </a>
          )}
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
                disabled={!isSignedIn || cameraActive}
              >
                <span>{courier}</span>
                <strong>{summary.find((item) => item.courier === courier)?.count ?? 0}</strong>
              </button>
            ))}
          </div>

          <div className="scan-tool-panel" aria-label="เลือกวิธีสแกน">
            <div className="segmented-control">
              <button
                className={scanMethod === 'manual' ? 'active' : ''}
                type="button"
                onClick={() => setScanMethod('manual')}
              >
                <ScanLine size={16} />
                <span>เครื่องยิง/พิมพ์</span>
              </button>
              <button
                className={scanMethod === 'camera' ? 'active' : ''}
                type="button"
                onClick={() => setScanMethod('camera')}
              >
                <Camera size={16} />
                <span>กล้องมือถือ</span>
              </button>
            </div>
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

          <div className="scan-controls" aria-label="เลือกโหมดสแกน">
            <div className="segmented-control">
              <button
                className={scanMode === 'single' ? 'active' : ''}
                type="button"
                onClick={() => setScanMode('single')}
              >
                <Square size={15} />
                <span>ทีละรายการ</span>
              </button>
              <button
                className={scanMode === 'continuous' ? 'active' : ''}
                type="button"
                onClick={() => setScanMode('continuous')}
              >
                <Repeat size={15} />
                <span>ต่อเนื่อง</span>
              </button>
            </div>
          </div>

          <div className={`issue-bar ${scanRemark ? 'active' : ''}`}>
            <label className="packer-control">
              <span>Packer</span>
              <select value={selectedPacker} onChange={(event) => setSelectedPacker(event.target.value)} disabled={!isSignedIn || busy}>
                {PACKERS.map((packer) => (
                  <option key={packer} value={packer}>
                    {packer}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={scanRemark === ISSUE_CUSTOMER_CANCELLED ? 'active' : ''}
              type="button"
              onClick={() =>
                setScanRemark((value) => (value === ISSUE_CUSTOMER_CANCELLED ? '' : ISSUE_CUSTOMER_CANCELLED))
              }
              disabled={!isSignedIn || busy}
            >
              {ISSUE_CUSTOMER_CANCELLED}
            </button>
            <span>
              {scanRemark
                ? `รายการถัดไป: ${selectedPacker} / ${scanRemark}`
                : selectedPacker === PACKER_UNASSIGNED
                  ? 'ต้องเลือก Packer ก่อนสแกน'
                  : `รายการถัดไปบันทึก Packer: ${selectedPacker}`}
            </span>
          </div>

          {scanMethod === 'camera' ? (
            <div className="camera-panel">
              <div className={`camera-stage ${cameraActive ? 'active' : ''}`}>
                <div id={CAMERA_REGION_ID} className="camera-reader" />
                <div className="scan-frame" aria-hidden="true">
                  <span />
                </div>
              </div>
              <div className="camera-footer">
                <p className={`camera-message ${cameraMessageType}`}>{cameraMessage}</p>
                <div className="camera-actions">
                  {cameraActive ? (
                    <button className="ghost-button" type="button" onClick={stopCamera}>
                      <Square size={16} />
                      <span>หยุดกล้อง</span>
                    </button>
                  ) : (
                    <button className="secondary-button" type="button" onClick={startCamera} disabled={busy || !isSignedIn || !isPackerReady}>
                      <Camera size={16} />
                      <span>เปิดกล้อง</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <form className="scan-form" onSubmit={handleScanSubmit}>
              <label htmlFor="scan-input">Tracking / Barcode</label>
              <div className="scan-input-row">
                <ScanLine size={24} />
                <input
                  id="scan-input"
                  ref={inputRef}
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value)}
                  placeholder={
                    isSignedIn
                      ? isPackerReady
                        ? 'ยิงบาร์โค้ดหรือ QR แล้วกด Enter'
                        : 'เลือก Packer ก่อนเริ่มสแกน'
                      : 'Login with Google ก่อนเริ่มสแกน'
                  }
                  autoComplete="off"
                  disabled={busy || !isSignedIn || !isPackerReady}
                />
                <button type="submit" disabled={busy || !isSignedIn || !isPackerReady}>
                  {busy ? <RefreshCw size={18} className="spin" /> : <Play size={18} />}
                  <span>บันทึก</span>
                </button>
              </div>
            </form>
          )}

          <section className="search-panel" aria-label="ค้นหาเลขพัสดุ">
            <div className="search-heading">
              <div>
                <p className="eyebrow">Lookup</p>
                <h3>ค้นหาเลขพัสดุ</h3>
              </div>
              <span>{searchResults ? `${searchResults.length} รายการ` : 'ยังไม่ได้ค้นหา'}</span>
            </div>

            <form className="search-form" onSubmit={handleSearchSubmit}>
              <label className="field-control search-code-field">
                <span>เลขพัสดุ</span>
                <div className="search-input-row">
                  <Search size={20} />
                  <input
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="พิมพ์เลขพัสดุหรือบางส่วนของเลข"
                    autoComplete="off"
                    disabled={searchBusy || !isSignedIn}
                  />
                </div>
              </label>

              <div className="segmented-control search-scope-control">
                <button className={searchScope === 'selected' ? 'active' : ''} type="button" onClick={() => setSearchScope('selected')}>
                  ขนส่งนี้
                </button>
                <button className={searchScope === 'all' ? 'active' : ''} type="button" onClick={() => setSearchScope('all')}>
                  ทุกขนส่ง
                </button>
              </div>

              <div className="segmented-control search-date-control">
                <button className={searchMode === 'today' ? 'active' : ''} type="button" onClick={() => setSearchMode('today')}>
                  วันนี้
                </button>
                <button className={searchMode === 'range' ? 'active' : ''} type="button" onClick={() => setSearchMode('range')}>
                  ช่วงวันที่
                </button>
                <button className={searchMode === 'all' ? 'active' : ''} type="button" onClick={() => setSearchMode('all')}>
                  ทุกวัน
                </button>
              </div>

              {searchMode === 'range' && (
                <div className="range-fields search-range">
                  <label className="field-control">
                    <span>เริ่มต้น</span>
                    <input type="date" value={searchStartDate} onChange={(event) => setSearchStartDate(event.target.value)} />
                  </label>
                  <label className="field-control">
                    <span>สิ้นสุด</span>
                    <input type="date" value={searchEndDate} onChange={(event) => setSearchEndDate(event.target.value)} />
                  </label>
                </div>
              )}

              <button className="secondary-button search-button" type="submit" disabled={searchBusy || !isSignedIn}>
                {searchBusy ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
                <span>ค้นหา</span>
              </button>
            </form>

            {searchResults && (
              <div className="search-results">
                {searchResults.length === 0 ? (
                  <div className="empty-search">ไม่พบเลขพัสดุในเงื่อนไขที่เลือก</div>
                ) : (
                  <div className="table-wrap search-table">
                    <table>
                      <thead>
                        <tr>
                          <th>ขนส่ง</th>
                          <th>วันที่</th>
                          <th>เวลา</th>
                          <th>Tracking / Barcode</th>
                          <th>Status</th>
                          <th>Remark / Issue</th>
                          <th>ผู้สแกน</th>
                          <th>หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchResults.map((row) => (
                          <tr key={`${row.courier}-${row.date}-${row.no}-${row.code}`}>
                            <td>{row.courier}</td>
                            <td>{row.date}</td>
                            <td>{row.time}</td>
                            <td className="code-cell">{row.code}</td>
                            <td>{row.status}</td>
                            <td>{row.note || '-'}</td>
                            <td>{row.email}</td>
                            <td>
                              <button
                                className="table-action-button"
                                type="button"
                                onClick={() => markSearchResultDamaged(row)}
                                disabled={
                                  searchBusy ||
                                  row.note === ISSUE_DAMAGED ||
                                  row.status === 'Damaged' ||
                                  row.note === ISSUE_CUSTOMER_CANCELLED ||
                                  row.status === 'Cancelled'
                                }
                              >
                                {row.note === ISSUE_DAMAGED || row.status === 'Damaged'
                                  ? 'บันทึกแล้ว'
                                  : row.note === ISSUE_CUSTOMER_CANCELLED || row.status === 'Cancelled'
                                    ? 'ยกเลิกแล้ว'
                                    : ISSUE_DAMAGED}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>

          <StatusBanner status={status} />

          <div className="metric-row">
            <div>
              <span>รวมวันนี้ทั้งหมด</span>
              <strong>{totalTodayCount}</strong>
            </div>
            <div>
              <span>{selectedCourier} วันนี้</span>
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
            <div className="recent-actions">
              {recentRows.length > 3 && (
                <button className="text-button" type="button" onClick={() => setShowAllRecentRows((value) => !value)}>
                  {showAllRecentRows ? 'ย่อกลับ' : `ดูเพิ่มเติม (${recentRows.length})`}
                </button>
              )}
              {sheetUrl && (
                <a href={sheetUrl} target="_blank" rel="noreferrer">
                  เปิด Sheet <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Courier No.</th>
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
                  displayedRecentRows.map((row) => (
                    <tr key={`${row.no}-${row.courierNo}-${row.code}-${row.time}`}>
                      <td>{row.courierNo}</td>
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

      <section className="report-panel">
        <div className="report-header">
          <div>
            <p className="eyebrow">Reports</p>
            <h2>รายงานสแกน</h2>
          </div>
          <div className="report-badge">
            <BarChart3 size={18} />
            <span>{reportData ? `${reportData.total} รายการ` : 'รอสร้างรายงาน'}</span>
          </div>
        </div>

        <div className="report-controls">
          <div className="segmented-control">
            <button className={reportMode === 'daily' ? 'active' : ''} type="button" onClick={() => setReportMode('daily')}>
              รายวัน
            </button>
            <button className={reportMode === 'range' ? 'active' : ''} type="button" onClick={() => setReportMode('range')}>
              ช่วงวันที่
            </button>
            <button className={reportMode === 'month' ? 'active' : ''} type="button" onClick={() => setReportMode('month')}>
              รายเดือน
            </button>
          </div>

          {reportMode === 'daily' && (
            <label className="field-control">
              <span>วันที่</span>
              <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
            </label>
          )}

          {reportMode === 'range' && (
            <div className="range-fields">
              <label className="field-control">
                <span>เริ่มต้น</span>
                <input type="date" value={reportStartDate} onChange={(event) => setReportStartDate(event.target.value)} />
              </label>
              <label className="field-control">
                <span>สิ้นสุด</span>
                <input type="date" value={reportEndDate} onChange={(event) => setReportEndDate(event.target.value)} />
              </label>
            </div>
          )}

          {reportMode === 'month' && (
            <label className="field-control">
              <span>เดือน</span>
              <input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
            </label>
          )}

          <button className="secondary-button report-button" type="button" onClick={generateReport} disabled={!isSignedIn || reportBusy}>
            {reportBusy ? <RefreshCw size={16} className="spin" /> : <CalendarDays size={16} />}
            <span>สร้างรายงาน</span>
          </button>

          <button className="ghost-button report-button" type="button" onClick={copyReport} disabled={!reportData}>
            <ClipboardCopy size={16} />
            <span>คัดลอกรายงาน</span>
          </button>
        </div>

        <div className="report-summary">
          <div>
            <span>ช่วงรายงาน</span>
            <strong>{reportData?.label ?? '-'}</strong>
          </div>
          <div>
            <span>ยอดส่งจริง</span>
            <strong>{reportData?.total ?? 0}</strong>
          </div>
          <div>
            <span>ยกเลิก</span>
            <strong>{reportData?.cancelledTotal ?? 0}</strong>
          </div>
          <div>
            <span>สินค้าเสียหาย</span>
            <strong>{reportData?.damagedTotal ?? 0}</strong>
          </div>
          <div>
            <span>จำนวนวัน</span>
            <strong>{reportData?.days?.length ?? 0}</strong>
          </div>
        </div>

        <div className="report-grid">
          {COURIERS.map((courier) => {
            const count = reportData?.couriers?.find((item) => item.courier === courier)?.count ?? 0;
            return (
              <div className="report-card" key={courier}>
                <span>{courier}</span>
                <strong>{count}</strong>
              </div>
            );
          })}
        </div>

        <div className="recent-header">
          <h3>สรุปตามวันที่</h3>
        </div>
        <div className="table-wrap report-table">
          <table>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ส่งจริง</th>
                <th>ยกเลิก</th>
                <th>เสียหาย</th>
                {COURIERS.map((courier) => (
                  <th key={courier}>{courier}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!reportData ? (
                <tr>
                  <td colSpan={COURIERS.length + 4} className="empty-cell">
                    เลือกรูปแบบรายงานแล้วกดสร้างรายงาน
                  </td>
                </tr>
              ) : (
                reportData.days.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.total}</td>
                    <td>{day.cancelledTotal ?? 0}</td>
                    <td>{day.damagedTotal ?? 0}</td>
                    {COURIERS.map((courier) => (
                      <td key={courier}>{day.couriers.find((item) => item.courier === courier)?.count ?? 0}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="recent-header">
          <h3>รายการสินค้าเสียหาย</h3>
        </div>
        <div className="table-wrap report-table">
          <table>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>เวลา</th>
                <th>ขนส่ง</th>
                <th>Tracking / Barcode</th>
              </tr>
            </thead>
            <tbody>
              {!reportData ? (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    เลือกรูปแบบรายงานแล้วกดสร้างรายงาน
                  </td>
                </tr>
              ) : reportData.damagedRows?.length > 0 ? (
                reportData.damagedRows.map((row) => (
                  <tr key={`${row.date}-${row.time}-${row.courier}-${row.code}`}>
                    <td>{row.date}</td>
                    <td>{row.time}</td>
                    <td>{row.courier}</td>
                    <td className="code-cell">{row.code}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    ไม่มีรายการสินค้าเสียหายในช่วงนี้
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="recent-header">
          <h3>รายการยกเลิก</h3>
        </div>
        <div className="table-wrap report-table">
          <table>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>เวลา</th>
                <th>ขนส่ง</th>
                <th>Tracking / Barcode</th>
              </tr>
            </thead>
            <tbody>
              {!reportData ? (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    เลือกรูปแบบรายงานแล้วกดสร้างรายงาน
                  </td>
                </tr>
              ) : reportData.cancelledRows?.length > 0 ? (
                reportData.cancelledRows.map((row) => (
                  <tr key={`${row.date}-${row.time}-${row.courier}-${row.code}`}>
                    <td>{row.date}</td>
                    <td>{row.time}</td>
                    <td>{row.courier}</td>
                    <td className="code-cell">{row.code}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    ไม่มีรายการยกเลิกในช่วงนี้
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
