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
  Upload,
  MonitorCheck,
  ShieldAlert,
  ArrowRightLeft,
  Plus,
} from 'lucide-react';
import {
  COURIERS,
  appendScanGoogle,
  appendAdminScanGoogle,
  batchAppendScanGoogle,
  backfillMarketplaceOrdersGoogle,
  colorAllHistoricalSheetsGoogle,
  ensureGoogleSheetOrganization,
  checkMissingOrders,
  fetchGoogleProfile,
  fetchTodayPackerCounts,
  fetchTodaySummary,
  getBangkokParts,
  getDriveRowsGoogle,
  getRowsForFirestoreBackfillGoogle,
  getScanReportGoogle,
  getTodayRowsGoogle,
  listDatesBetween,
  listDatesInMonth,
  loadGoogleConfig,
  prepareGoogleSheets,
  searchScansGoogle,
  syncLateOrdersGoogle,
  updateScanIssueGoogle,
  validateScanCode,
} from './services/googleSheets.js';
import {
  buildMissingAlertMessage,
  buildCompactSummary,
  formatMissingResultsForUI,
  buildDashboardSummary,
} from './services/missingOrderCheck.js';
import {
  createGoogleProvider,
  firebaseAuth,
  getRedirectResult,
  GoogleAuthProvider,
  isFirebaseConfigured,
  onAuthStateChanged,
  signInWithCredential,
  signInWithRedirect,
  signOutFirebase,
} from './services/firebase.js';
import {
  backfillOrdersFromSheetRows,
  canUseFirestorePrimary,
  checkMissingOrdersFirestore,
  fetchTodaySummaryFirestore,
  findMarketplaceOrderByTracking,
  getDriveRowsFirestore,
  getScanReportFirestore,
  getTodayRowsFirestore,
  getUploadedMarketplaceOrders,
  markSheetSyncResult,
  mirrorScanToFirestore,
  recordAdminScanPrimary,
  recordPackerScanPrimary,
  searchScansFirestore,
  upsertFirebaseUser,
  importMarketplaceOrders,
  addCourier,
  claimRecoverableSheetSyncs,
  subscribeCouriers,
} from './services/firebaseScans.js';
import { groupMarketplaceRows, parseCsvText, parseMarketplaceRows } from './services/marketplaceImport.js';
import { parseXlsxArrayBuffer } from './services/xlsxImport.js';
import { loadHtml5Qrcode } from './services/cameraLoader.js';
import { commitFallbackScan } from './services/scanCommit.js';
import { getAdminScanTiming, getScanIssueMeta, shouldBlockPackerScan } from './services/sheetSyncReconciliation.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];
const SCOPES = GOOGLE_SCOPES.join(' ');
const MARKETPLACE_BACKFILL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SHEET_RECOVERY_BATCH_SIZE = 20;
const SHEET_RECOVERY_COOLDOWN_MS = 5 * 1000;
const COUNT_REFRESH_DELAY_MS = 1000;

const EMPTY_USER = {
  email: 'ยังไม่ได้เข้าสู่ระบบ',
  name: '',
};
const THEME_KEY = 'scan-to-sheet-theme';
const GOOGLE_SESSION_KEY = 'scan-to-sheet-google-session-v1';
const LOGGED_OUT_FLAG = 'scan-to-sheet-logged-out-v1';
const CAMERA_REGION_ID = 'camera-reader';
const CAMERA_POPUP_ID = 'camera-reader-popup';
const CAMERA_COOLDOWN_MS = 5000;
const CAMERA_SCAN_FPS = 18;
const ISSUE_CUSTOMER_CANCELLED = 'ลูกค้ายกเลิก';
const ISSUE_RETURNED = 'สินค้าตีกลับ';
const ISSUE_DAMAGED = 'สินค้าเสียหาย';
const PACKER_UNASSIGNED = 'ยังไม่ระบุ';
const PACKERS = [PACKER_UNASSIGNED, 'กิต', 'มาย', 'ยุทธ', 'หล้า', 'มุก'];
const DEFAULT_THRESHOLD_MINUTES = 30;
const DEFAULT_LOOKBACK_HOURS = 48;
const AUTO_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MISSING_CHECK_CACHE_KEY = 'missing-order-check-cache';
const MISSING_CHECK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    clearTimeout(t);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `API error ${response.status}`);
    }
    return data;
  } catch (error) {
    clearTimeout(t);
    if (error.name === 'AbortError') throw new Error('เชื่อมต่อนานเกินไป กรุณาลองใหม่');
    throw error;
  }
}

async function acquireSheetWriteLock(resource) {
  const lockId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await apiJson('/api/sheet-lock', {
      method: 'POST',
      body: JSON.stringify({ action: 'acquire', resource, lockId }),
    });
    if (result.acquired) return async () => {
      await apiJson('/api/sheet-lock', {
        method: 'POST',
        body: JSON.stringify({ action: 'release', resource, lockId }),
      }).catch(() => {});
    };
    await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs ?? 250));
  }
  throw new Error('Google Sheet is busy; please retry');
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

function getMissingCheckCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(MISSING_CHECK_CACHE_KEY));
    if (cached && cached.time && Date.now() - cached.time < MISSING_CHECK_CACHE_TTL_MS) {
      return cached.data;
    }
  } catch {
    // ignore
  }
  return null;
}

function setMissingCheckCache(data) {
  try {
    localStorage.setItem(MISSING_CHECK_CACHE_KEY, JSON.stringify({ time: Date.now(), data }));
  } catch {
    // ignore
  }
}

function App() {
  const signingOutRef = useRef(false);
  const organizationSyncAtRef = useRef(0);
  const ORGANIZATION_SYNC_THROTTLE_MS = 5 * 60 * 1000;
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(EMPTY_USER);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [config, setConfig] = useState(() => loadGoogleConfig());
  const [selectedCourier, setSelectedCourier] = useState(COURIERS[0]);
  const [couriers, setCouriers] = useState(COURIERS);
  const [newCourierName, setNewCourierName] = useState('');
  const [addingCourier, setAddingCourier] = useState(false);
  const [courierSelectValue, setCourierSelectValue] = useState('');
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
  const [packerCounts, setPackerCounts] = useState(() =>
    PACKERS.filter((p) => p !== PACKER_UNASSIGNED).map((p) => ({ packer: p, count: 0 })),
  );
  const [scanFlash, setScanFlash] = useState(false);
  const [scanPopupOpen, setScanPopupOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light');
  const [scanMethod, setScanMethod] = useState('camera');
  const [allowAnyTrackingFormat, setAllowAnyTrackingFormat] = useState(false);
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
  const [activeTab, setActiveTab] = useState('packer');
  const [driveRecentRows, setDriveRecentRows] = useState([]);
  const [driveTotalCount, setDriveTotalCount] = useState(0);
  const [driveSyncBusy, setDriveSyncBusy] = useState(false);
  const [missingResults, setMissingResults] = useState(null);
  const [missingBusy, setMissingBusy] = useState(false);
  const [missingAlertBadge, setMissingAlertBadge] = useState(0);
  const [thresholdMinutes, setThresholdMinutes] = useState(DEFAULT_THRESHOLD_MINUTES);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [marketplaceUploadBusy, setMarketplaceUploadBusy] = useState(false);
  const [marketplaceUploadResult, setMarketplaceUploadResult] = useState(null);
  const [marketplaceFilterPlatform, setMarketplaceFilterPlatform] = useState('all');
  const marketplaceFileRef = useRef(null);
  const marketplaceBackfillStartedRef = useRef(false);
  const inputRef = useRef(null);
  const audioContextRef = useRef(null);
  const cameraRef = useRef(null);
  const scanModeRef = useRef(scanMode);
  const lastCameraScanRef = useRef({ code: '', time: 0 });
  const cameraSavingRef = useRef(false);
  const refreshTimerRef = useRef(null);
  const autoCheckTimerRef = useRef(null);
  const lastAutoCheckRef = useRef(0);
  const sheetRecoveryRunningRef = useRef(false);
  const sheetRecoveryNextAllowedAtRef = useRef(0);

  const isGoogleReady = isFirebaseConfigured || Boolean(GOOGLE_CLIENT_ID);
  const isSheetConnected = Boolean(token && config);
  const isSignedIn = Boolean(firebaseUser || isSheetConnected);
  const selectedCount = useMemo(
    () => summary.find((item) => item.courier === selectedCourier)?.count ?? 0,
    [selectedCourier, summary],
  );
  const displayedCourierCounts = useMemo(() => {
    if (activeTab !== 'drive') {
      return summary;
    }

    return couriers.map((courier) => ({
      courier,
      count: driveRecentRows.filter((row) => row.courier === courier).length,
    }));
  }, [activeTab, couriers, driveRecentRows, summary]);
  const totalTodayCount = useMemo(() => summary.reduce((sum, item) => sum + item.count, 0), [summary]);
  const displayedRecentRows = showAllRecentRows ? recentRows : recentRows.slice(0, 3);
  const sheetUrl = config?.master?.webViewLink;
  const requiresPacker = !getScanIssueMeta(scanRemark).isIssue && activeTab === 'packer';
  const isPackerReady = !requiresPacker || selectedPacker !== PACKER_UNASSIGNED;
  const isDriveReady = isSignedIn && scanMethod === 'manual' ? true : isSignedIn;

  async function uploadMarketplaceFiles(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length || !firebaseUser) return;
    setMarketplaceUploadBusy(true);
    setMarketplaceUploadResult(null);
    try {
      const parsedRows = [];
      for (const file of files) {
        let rows;
        if (file.name.toLowerCase().endsWith('.csv')) {
          rows = parseCsvText(await file.text());
        } else {
          rows = await parseXlsxArrayBuffer(await file.arrayBuffer());
        }
        parsedRows.push(...parseMarketplaceRows(rows));
      }
      const allGroups = groupMarketplaceRows(parsedRows);
      if (!allGroups.length) throw new Error('ไม่พบออเดอร์ที่มีเลขพัสดุในไฟล์');
      const groups = marketplaceFilterPlatform === 'all'
        ? allGroups
        : allGroups.filter((g) => g.platform.toLowerCase() === marketplaceFilterPlatform.toLowerCase());
      if (!groups.length) throw new Error(`ไม่พบออเดอร์จาก ${marketplaceFilterPlatform} ในไฟล์`);
      const result = await importMarketplaceOrders(groups);
      try {
        const sheetResult = await runWithGoogleRetry((accessToken, googleConfig) => (
          backfillMarketplaceOrdersGoogle({ token: accessToken, config: googleConfig, groups })
        ));
        const lateResult = await runWithGoogleRetry((accessToken, googleConfig) => (
          syncLateOrdersGoogle({ token: accessToken, config: googleConfig, orders: result.orderStates })
        ));
        setMarketplaceUploadResult({
          type: 'success',
          message: `เพิ่มใหม่ ${result.imported} ออเดอร์ ข้ามรายการซ้ำ ${result.duplicates} ออเดอร์ อัปเดตกำหนดส่ง ${result.metadataUpdated} ออเดอร์ อัปเดต Firebase ${result.updatedScans} รายการ, Google Sheet ${sheetResult.matchedRows} แถว และ Late Orders ${lateResult.rows} ออเดอร์ (ล่าช้า ${lateResult.counts.overdue ?? 0})`,
        });
      } catch (sheetError) {
        setMarketplaceUploadResult({
          type: 'warning',
          message: `Firebase เพิ่มใหม่ ${result.imported} ออเดอร์ ข้ามรายการซ้ำ ${result.duplicates} ออเดอร์ แต่ Google Sheet ยังไม่สำเร็จ: ${sheetError.message}`,
        });
      }
    } catch (error) {
      setMarketplaceUploadResult({ type: 'error', message: error.message });
    } finally {
      setMarketplaceUploadBusy(false);
    }
  }

  useEffect(() => {
    if (!firebaseUser || !token || !config?.master?.id || marketplaceBackfillStartedRef.current) return;
    const backfillKey = `scan-to-sheet:marketplace-backfill:${firebaseUser.uid}:${config.master.id}`;
    const lastSuccessfulBackfill = Number(localStorage.getItem(backfillKey) ?? 0);
    if (Date.now() - lastSuccessfulBackfill < MARKETPLACE_BACKFILL_COOLDOWN_MS) {
      marketplaceBackfillStartedRef.current = true;
      return;
    }
    marketplaceBackfillStartedRef.current = true;

    void (async () => {
      try {
        const groups = await getUploadedMarketplaceOrders();
        if (!groups.length) return;
        const knownExistingOrderIds = groups.map((group) => `${group.platform}__${group.orderId}`);
        const firebaseResult = await importMarketplaceOrders(groups, { knownExistingOrderIds });
        const sheetResult = await runWithGoogleRetry((accessToken, googleConfig) => (
          backfillMarketplaceOrdersGoogle({ token: accessToken, config: googleConfig, groups })
        ));
        const lateResult = await runWithGoogleRetry((accessToken, googleConfig) => (
          syncLateOrdersGoogle({ token: accessToken, config: googleConfig, orders: firebaseResult.orderStates })
        ));
        localStorage.setItem(backfillKey, String(Date.now()));
        setMarketplaceUploadResult({
          type: 'success',
          message: `เติมย้อนหลังอัตโนมัติแล้ว: อัปเดต Firebase ${firebaseResult.updatedScans} รายการ, Google Sheet ${sheetResult.matchedRows} แถว และ Late Orders ${lateResult.rows} ออเดอร์`,
        });
      } catch (error) {
        marketplaceBackfillStartedRef.current = false;
        setMarketplaceUploadResult({ type: 'warning', message: `เติมย้อนหลังยังไม่ครบ: ${error.message}` });
      }
    })();
  }, [firebaseUser, token, config]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute('content', theme === 'dark' ? '#000000' : '#f2f2f7');
    }
  }, [theme]);

  useEffect(() => {
    let unsubscribed = false;
    let unsubscribeAuth = null;

    if (firebaseAuth) {
      unsubscribeAuth = onAuthStateChanged(firebaseAuth, (authUser) => {
        if (unsubscribed) {
          return;
        }
        setFirebaseUser(authUser);
        if (authUser) {
          setUser((current) => (
            current.email === EMPTY_USER.email
              ? {
                  email: authUser.email ?? 'firebase-user',
                  name: authUser.displayName ?? 'Firebase User',
                }
              : current
          ));
          void upsertFirebaseUser(authUser).catch(() => {});
        }
      });
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    if (!code && !error) {
      handleFirebaseRedirectOrRestore();
      return () => {
        unsubscribed = true;
        unsubscribeAuth?.();
      };
    }

    window.history.replaceState(null, '', window.location.pathname);

    if (error) {
      setStatus({
        type: 'error',
        title: 'เข้าสู่ระบบไม่สำเร็จ',
        message: errorDescription || error,
      });
      setBusy(false);
    } else {
      completeGoogleSignIn(code);
    }

    return () => {
      unsubscribed = true;
      unsubscribeAuth?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday(getBangkokParts());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!firebaseUser) {
      setCouriers(COURIERS);
      return () => {};
    }
    return subscribeCouriers({
      defaultCouriers: COURIERS,
      onChange: (nextCouriers) => {
        setCouriers(nextCouriers);
        setSelectedCourier((current) => (nextCouriers.includes(current) ? current : nextCouriers[0] ?? COURIERS[0]));
        setSummary((current) => nextCouriers.map((courier) => (
          current.find((item) => item.courier === courier) ?? { courier, count: 0 }
        )));
        scheduleCountRefresh();
      },
      onError: (error) => console.warn('Courier list sync failed:', error),
    });
  }, [firebaseUser]);

  useEffect(() => {
    if (isSignedIn) {
      inputRef.current?.focus();
    }
  }, [isSignedIn, selectedCourier, busy, activeTab]);

  useEffect(() => {
    if (!isSignedIn || scanMethod !== 'camera') {
      void stopCamera();
    }
  }, [isSignedIn, scanMethod]);

  useEffect(() => {
    scanModeRef.current = scanMode;
  }, [scanMode]);

  useEffect(() => {
    return () => {
      void stopCamera();
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      setRecentRows([]);
      setDriveRecentRows([]);
      return;
    }

    if (activeTab === 'packer') {
      refreshSelectedCourierRows();
    } else {
      refreshDriveRows();
    }
  }, [selectedCourier, today.date, isSignedIn, activeTab]);

  useEffect(() => {
    if (!firebaseUser || !token || !config?.master?.id || sheetRecoveryRunningRef.current) return;
    void recoverPendingSheetSyncs();
  }, [firebaseUser, token, config]);

  useEffect(() => {
    setShowAllRecentRows(false);
  }, [selectedCourier, today.date, activeTab]);

  useEffect(() => {
    if (isSignedIn) {
      generateReport();
    }
  }, [isSignedIn]);

  // Auto-retry sheet sync every 5 minutes (reduces Firestore reads)
  useEffect(() => {
    if (!firebaseUser || !token || !config?.master?.id) return;
    const interval = setInterval(() => {
      void recoverPendingSheetSyncs();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [firebaseUser, token, config]);

  // Auto-check for missing orders
  useEffect(() => {
    if (!isSignedIn) {
      setMissingAlertBadge(0);
      return;
    }

    // Run immediate check on mount when in drive tab
    if (activeTab === 'drive') {
      runAutoCheck();
    }

    autoCheckTimerRef.current = setInterval(() => {
      runAutoCheck(false);
    }, AUTO_CHECK_INTERVAL_MS);

    return () => {
      if (autoCheckTimerRef.current) {
        clearInterval(autoCheckTimerRef.current);
      }
    };
  }, [isSignedIn, activeTab]);

  // Run auto-check when tab switches to drive
  useEffect(() => {
    if (isSignedIn && activeTab === 'drive') {
      runAutoCheck();
    }
  }, [activeTab]);

  async function runAutoCheck(showStatus = false) {
    if (!isSignedIn) return;

    // Don't run more than once per 5 minutes
    const now = Date.now();
    if (now - lastAutoCheckRef.current < MISSING_CHECK_CACHE_TTL_MS) {
      return;
    }
    lastAutoCheckRef.current = now;

    // Check cache first
    const cached = getMissingCheckCache();
    if (cached) {
      setMissingAlertBadge(cached.pending?.length ?? 0);
      return;
    }

    try {
      const results = canUseFirestorePrimary()
        ? await checkMissingOrdersFirestore({
            courier: null,
            hoursLookback: DEFAULT_LOOKBACK_HOURS,
            thresholdMinutes,
          })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
            checkMissingOrders({
              token: accessToken,
              config: googleConfig,
              courier: null,
              hoursLookback: DEFAULT_LOOKBACK_HOURS,
              thresholdMinutes,
            }),
          );

      setMissingCheckCache(results);
      const pendingCount = results.pending?.length ?? 0;
      setMissingAlertBadge(pendingCount);

      if (showStatus && pendingCount > 0) {
        setStatus({
          type: 'warning',
          title: 'พบออเดอร์ตกหล่น',
          message: `มี ${pendingCount} รายการที่ยังไม่ได้แสกนส่ง`,
        });
      }
    } catch {
      // Silent fail for auto-check
    }
  }

  async function playTone(type) {
    if (!soundEnabled) {
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }

    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    if (context.state === 'suspended') {
      await context.resume();
    }
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
      alert: [
        { frequency: 880, duration: 0.25, offset: 0, peak: 0.9, wave: 'square' },
        { frequency: 660, duration: 0.25, offset: 0.3, peak: 0.9, wave: 'square' },
        { frequency: 880, duration: 0.25, offset: 0.6, peak: 0.9, wave: 'square' },
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

  const isFirebaseHosting = typeof window !== 'undefined' && (
    window.location.hostname.endsWith('.firebaseapp.com') ||
    window.location.hostname.endsWith('.web.app')
  );

  async function signInWithGoogle() {
    // Only use Firebase signInWithRedirect on Firebase Hosting
    if (firebaseAuth && isFirebaseHosting) {
      const provider = createGoogleProvider(GOOGLE_SCOPES);
      localStorage.removeItem(LOGGED_OUT_FLAG);
      setBusy(true);
      await signInWithRedirect(firebaseAuth, provider);
      return;
    }

    // Server-side OAuth flow (works on Vercel and any custom domain)
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
      access_type: 'offline',
      prompt: 'consent',
    });

    localStorage.removeItem(LOGGED_OUT_FLAG);
    setBusy(true);
    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  async function handleFirebaseRedirectOrRestore() {
    if (!firebaseAuth) {
      await restoreGoogleSession();
      return;
    }

    try {
      setBusy(true);
      const result = await getRedirectResult(firebaseAuth);
      const credential = result ? GoogleAuthProvider.credentialFromResult(result) : null;
      const accessToken = credential?.accessToken;

      if (result?.user && accessToken) {
        await activateGoogleSession({
          accessToken,
          profile: {
            email: result.user.email,
            name: result.user.displayName,
          },
          expiresIn: 3600,
          config: null,
          firebaseUser: result.user,
        });
        setStatus({
          type: 'success',
          title: 'Firebase Login พร้อมใช้งาน',
          message: 'Firebase Auth เป็น login หลัก และ Google Sheet ยังบันทึกได้ตาม flow เดิม',
        });
        return;
      }
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'Firebase Login ไม่สำเร็จ',
        message: error.message,
      });
      setBusy(false);
      return;
    }

    await restoreGoogleSession();
  }

  async function completeGoogleSignIn(code) {
    try {
      setBusy(true);
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const data = await apiJson('/api/google-auth', {
        method: 'POST',
        body: JSON.stringify({ code, redirectUri, clientId: GOOGLE_CLIENT_ID }),
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
    if (localStorage.getItem(LOGGED_OUT_FLAG) === '1') {
      localStorage.removeItem(LOGGED_OUT_FLAG);
      return;
    }

    const stored = loadStoredGoogleSession();
    if (stored?.accessToken && stored.expiresAt > Date.now() + 60_000) {
      try {
        setBusy(true);
        await activateGoogleSession({
          accessToken: stored.accessToken,
          profile: stored.user ?? EMPTY_USER,
          expiresIn: Math.floor((stored.expiresAt - Date.now()) / 1000),
          config: stored.config ?? null,
        });
        setStatus({
          type: 'success',
          title: 'กลับมาใช้งานต่อได้',
          message: 'ใช้ session เดิมจาก browser',
        });
        return;
      } catch {
        clearStoredGoogleSession();
        setToken(null);
        setUser(EMPTY_USER);
        setConfig(null);
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
      if (!silent) {
        clearStoredGoogleSession();
        setToken(null);
        setUser(EMPTY_USER);
        setConfig(null);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function activateGoogleSession(data) {
    signingOutRef.current = false;
    const accessToken = data.accessToken;
    const idToken = data.idToken;
    const profile = data.profile ?? (await fetchGoogleProfile(accessToken));
    const serverConfig = data.config ?? (await loadServerGoogleConfig().catch(() => null));
    const prepared = serverConfig ?? (await prepareGoogleSheets(accessToken));
    const nextUser = {
      email: profile.email ?? 'google-user',
      name: profile.name ?? 'Google User',
    };
    saveStoredGoogleSession({
      accessToken,
      expiresAt: Date.now() + Math.max((data.expiresIn ?? 3600) - 60, 60) * 1000,
      user: nextUser,
      config: prepared,
    });
    await saveServerGoogleConfig(prepared).catch(() => {});

    setToken(accessToken);
    setUser(nextUser);
    await ensureGoogleSheetOrganization({ token: accessToken, config: prepared }).catch((error) => {
      console.warn('Google Sheet organization failed:', error);
    });
    organizationSyncAtRef.current = Date.now();
    // Historical colors are already backfilled; avoid reading every old sheet on login.

    if (firebaseAuth && idToken) {
      try {
        const credential = GoogleAuthProvider.credential(idToken, accessToken);
        const result = await signInWithCredential(firebaseAuth, credential);
        setFirebaseUser(result.user);
        await upsertFirebaseUser(result.user).catch(() => {});
      } catch (error) {
        console.warn('Firebase Auth sign-in failed after Google OAuth:', error);
      }
    } else if (data.firebaseUser) {
      setFirebaseUser(data.firebaseUser);
      await upsertFirebaseUser(data.firebaseUser).catch(() => {});
    }

    await refreshAllCounts(accessToken, prepared);
    setConfig(prepared);
    return { accessToken, config: prepared, user: nextUser };
  }

  async function runWithGoogleRetry(action, { sheetWrite = false } = {}) {
    if (signingOutRef.current) {
      throw new Error('Google session is signing out');
    }
    let releaseLock = null;
    try {
      if (sheetWrite) {
        releaseLock = await acquireSheetWriteLock(config?.master?.id || 'master');
      }
      return await action(token, config);
    } catch (error) {
      if (signingOutRef.current || !isGoogleAuthError(error)) {
        throw error;
      }

      const session = await refreshGoogleSessionFromServer({ silent: true });
      if (!session?.accessToken || !session?.config) {
        throw error;
      }

      return action(session.accessToken, session.config);
    } finally {
      await releaseLock?.();
    }
  }

  function isGoogleAuthError(error) {
    const message = String(error?.message ?? '').toLowerCase();
    return (
      message.includes('401') ||
      message.includes('invalid authentication') ||
      message.includes('invalid credentials') ||
      message.includes('unauthorized') ||
      (message.includes('google api error 403') && message.includes('permission_denied'))
    );
  }

  async function signOut() {
    signingOutRef.current = true;
    localStorage.setItem(LOGGED_OUT_FLAG, '1');

    if (firebaseAuth) {
      await signOutFirebase(firebaseAuth).catch(() => {});
    }

    try {
      await fetch('/api/google-logout', { method: 'POST' });
    } catch {
    }
    clearStoredGoogleSession();
    setToken(null);
    setUser(EMPTY_USER);
    setFirebaseUser(null);
    setSummary(couriers.map((courier) => ({ courier, count: 0 })));
    setPackerCounts(PACKERS.filter((p) => p !== PACKER_UNASSIGNED).map((p) => ({ packer: p, count: 0 })));
    setRecentRows([]);
    setDriveRecentRows([]);
    setReportData(null);
    setSearchResults(null);
    setMissingResults(null);
    setMissingAlertBadge(0);
    setDriveTotalCount(0);
    setStatus({
      type: 'idle',
      title: 'ออกจากระบบแล้ว',
      message: 'เข้าสู่ระบบด้วย Google อีกครั้งเมื่อต้องการสแกน',
    });
  }

  async function refreshAllCounts(accessToken = token, googleConfig = config) {
    if (signingOutRef.current) {
      return;
    }
    if (accessToken && googleConfig && Date.now() - organizationSyncAtRef.current >= ORGANIZATION_SYNC_THROTTLE_MS) {
      await ensureGoogleSheetOrganization({ token: accessToken, config: googleConfig }).catch((error) => {
        console.warn('Google Sheet organization refresh failed:', error);
      });
      organizationSyncAtRef.current = Date.now();
    }
    if (!isSignedIn) {
      return;
    }

    const data = canUseFirestorePrimary()
      ? await fetchTodaySummaryFirestore({ couriers, date: getBangkokParts().date })
      : await runWithGoogleRetry((t, c) => fetchTodaySummary({ token: t, config: c, couriers }));
    if (data) {
      setSummary(data.courierCounts);
      setPackerCounts(data.packerCounts);
    }

    if (activeTab === 'packer') {
      const courierRows = canUseFirestorePrimary()
        ? await getTodayRowsFirestore({ courier: selectedCourier, date: getBangkokParts().date }).catch(() => [])
        : await runWithGoogleRetry((t, c) =>
            getTodayRowsGoogle({ token: t, config: c, courier: selectedCourier, date: getBangkokParts().date }),
          ).catch(() => []);
      setRecentRows(courierRows);
    } else {
      const driveRows = canUseFirestorePrimary()
        ? await getDriveRowsFirestore({ date: getBangkokParts().date }).catch(() => [])
        : await runWithGoogleRetry((t, c) =>
            getDriveRowsGoogle({ token: t, config: c, date: getBangkokParts().date }),
          ).catch(() => []);
      setDriveRecentRows(driveRows);
      setDriveTotalCount(driveRows.length);
    }
  }

  function scheduleCountRefresh() {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (isSignedIn) {
        const summaryPromise = canUseFirestorePrimary()
          ? fetchTodaySummaryFirestore({ couriers, date: getBangkokParts().date })
          : fetchTodaySummary({ token, config, couriers });
        summaryPromise.then((data) => {
          if (data) {
            setSummary(data.courierCounts);
            setPackerCounts(data.packerCounts);
          }
        }).catch(() => {});
      }
    }, COUNT_REFRESH_DELAY_MS);
  }

  function runAfterScanCommit(task) {
    window.setTimeout(() => {
      Promise.resolve()
        .then(task)
        .catch((error) => console.warn('Background scan sync failed:', error));
    }, 0);
  }

  async function refreshSelectedCourierRows() {
    if (!isSignedIn) {
      return;
    }

    try {
      const rows = canUseFirestorePrimary()
        ? await getTodayRowsFirestore({ courier: selectedCourier, date: today.date })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
            getTodayRowsGoogle({
              token: accessToken,
              config: googleConfig,
              courier: selectedCourier,
              date: today.date,
            }),
          );
      setRecentRows(rows);
      scheduleCountRefresh();
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'โหลดรายการไม่สำเร็จ',
        message: error.message,
      });
    }
  }

  async function refreshDriveRows() {
    if (!isSignedIn) {
      return;
    }

    try {
      const rows = canUseFirestorePrimary()
        ? await getDriveRowsFirestore({ date: today.date })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
            getDriveRowsGoogle({
              token: accessToken,
              config: googleConfig,
              date: today.date,
            }),
          );
      setDriveRecentRows(rows);
      setDriveTotalCount(rows.length);
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'โหลดรายการลง Drive ไม่สำเร็จ',
        message: error.message,
      });
    }
  }

  async function recoverPendingSheetSyncs({ showStatus = false } = {}) {
    if (sheetRecoveryRunningRef.current) {
      if (showStatus) {
        setStatus({ type: 'warning', title: 'กำลังอัปเดตอยู่', message: 'ระบบกำลังซิงก์ออเดอร์ค้างชุดก่อนหน้า' });
      }
      return { busy: true, claimed: 0, synced: 0, failed: 0 };
    }
    if (!firebaseUser || !token || !config?.master?.id) {
      if (showStatus) {
        setStatus({ type: 'warning', title: 'ยังอัปเดต Sheet ไม่ได้', message: 'กรุณาเข้าสู่ระบบ Google และเชื่อม Master Sheet ก่อน' });
      }
      return { busy: false, claimed: 0, synced: 0, failed: 0 };
    }
    const waitMs = sheetRecoveryNextAllowedAtRef.current - Date.now();
    if (showStatus && waitMs > 0) {
      setStatus({
        type: 'warning',
        title: 'รอ Google Sheets quota',
        message: `กรุณารออีกประมาณ ${Math.ceil(waitMs / 1000)} วินาทีก่อนอัปเดตรอบถัดไป`,
      });
      return { busy: false, claimed: 0, synced: 0, failed: 0 };
    }
    sheetRecoveryRunningRef.current = true;
    if (showStatus) setDriveSyncBusy(true);
    let synced = 0;
    let failed = 0;
    try {
      const orders = await claimRecoverableSheetSyncs({ maxRows: SHEET_RECOVERY_BATCH_SIZE });
      if (orders.length) {
        sheetRecoveryNextAllowedAtRef.current = Date.now() + SHEET_RECOVERY_COOLDOWN_MS;
      }
      if (orders.length === 0) {
        if (showStatus) {
          setStatus({ type: 'success', title: 'อัปเดต Sheet แล้ว', message: 'ไม่พบออเดอร์ค้างที่ต้องอัปเดต' });
        }
        return { busy: false, claimed: 0, synced: 0, failed: 0 };
      }

      // Build batch order list
      const batchOrders = orders.map((order) => {
        const isPacker = Boolean(order.packerScan?.scannedAt);
        const timing = getAdminScanTiming(order, {
          fallbackDate: getBangkokParts().date,
          fallbackTime: getBangkokParts().time,
        });
        const hasAdmin = Boolean(order.admin?.scannedAt);
        return {
          id: order.id,
          code: order.code || order.normalizedCode,
          courier: order.courier,
          date: timing.sheetDate,
          time: timing.sheetTime,
          email: order.packerScan?.scannedBy?.email || order.admin?.scannedBy?.email || order.user?.email || user.email,
          packer: order.packerScan?.packer ?? order.packer ?? '',
          note: order.packerScan?.note ?? order.note ?? '',
          isPacker,
          adminDate: hasAdmin ? timing.adminDate : '',
          adminTime: hasAdmin ? timing.adminTime : '',
          adminCode: hasAdmin ? (order.code || order.normalizedCode) : '',
          marketplaceOrder: null, // Will be overridden below if found
        };
      });

      // Pre-fetch marketplace metadata if possible (best effort, non-blocking)
      const marketplaceResults = await Promise.all(
        batchOrders.map((bo) => findMarketplaceOrderByTracking({ trackingNo: bo.code }).catch(() => null)),
      );
      batchOrders.forEach((bo, i) => {
        if (marketplaceResults[i]) bo.marketplaceOrder = marketplaceResults[i];
      });

      // Execute one batch call
      const results = await runWithGoogleRetry((accessToken, googleConfig) =>
        batchAppendScanGoogle({ token: accessToken, config: googleConfig, orders: batchOrders }),
        { sheetWrite: true },
      );

      // Mark individual results
      for (let i = 0; i < results.length; i++) {
        const { order: batchOrder, result, error } = results[i];
        const firestoreOrder = orders.find((order) => order.id === batchOrder?.id) ?? orders[i];
        if (result) {
          await markSheetSyncResult({
            orderId: firestoreOrder.id,
            attemptId: firestoreOrder.sheetSyncAttemptId,
            ok: true,
            result,
          }).catch(() => {});
          synced += 1;
        } else {
          failed += 1;
          await markSheetSyncResult({
            orderId: firestoreOrder.id,
            attemptId: firestoreOrder.sheetSyncAttemptId,
            ok: false,
            error: error || new Error('Batch sync returned no result'),
          }).catch(() => {});
        }
      }

      scheduleCountRefresh();
      if (showStatus) {
        await refreshDriveRows().catch(() => {});
        setStatus(
          failed > 0
            ? { type: 'warning', title: 'อัปเดต Sheet ยังไม่ครบ', message: `ซิงก์สำเร็จ ${synced} รายการ, ยังไม่สำเร็จ ${failed} รายการ` }
            : {
                type: 'success',
                title: 'อัปเดต Sheet แล้ว',
                message: `ซิงก์ออเดอร์ค้างสำเร็จ ${synced} รายการ${orders.length === SHEET_RECOVERY_BATCH_SIZE ? ' หากยังมีรายการค้าง ให้กดอีกครั้ง' : ''}`,
              },
        );
      }
      return { busy: false, claimed: orders.length, synced, failed };
    } catch (error) {
      if (showStatus) {
        setStatus({ type: 'error', title: 'อัปเดต Sheet ไม่สำเร็จ', message: error.message });
      }
      return { busy: false, claimed: 0, synced, failed: orders?.length ?? 0 };
    } finally {
      sheetRecoveryRunningRef.current = false;
      if (showStatus) setDriveSyncBusy(false);
    }
  }

  async function handleAddCourier() {
    if (!firebaseUser) {
      setStatus({ type: 'warning', title: 'ต้องเข้าสู่ระบบก่อน', message: 'เข้าสู่ระบบ Firebase ก่อนเพิ่มขนส่งใหม่' });
      return;
    }
    setAddingCourier(true);
    try {
      const courier = await addCourier({ name: newCourierName, user: firebaseUser });
      setSelectedCourier(courier);
      setNewCourierName('');
      setStatus({ type: 'success', title: 'เพิ่มขนส่งแล้ว', message: `${courier} ใช้ได้ทั้งหน้าแพ็กและรับเข้า Drive` });
    } catch (error) {
      setStatus({ type: 'error', title: 'เพิ่มขนส่งไม่สำเร็จ', message: error.message });
    } finally {
      setAddingCourier(false);
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

    if (!getScanIssueMeta(scanRemark).isIssue && selectedPacker === PACKER_UNASSIGNED) {
      setStatus({
        type: 'warning',
        title: 'เลือก Packer ก่อนสแกน',
        message: 'ต้องเลือกชื่อผู้แพ็คก่อนบันทึกออเดอร์ปกติ',
      });
      showCameraMessage('เลือก Packer ก่อนสแกน', 'error');
      playTone('error');
      return { status: 'error' };
    }

    const validation = validateScanCode(selectedCourier, rawCode, {
      allowAnyFormat: source === 'manual' && allowAnyTrackingFormat,
    });
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

    if (source === 'manual') {
      setScanValue('');
    }

    // Prevent only a true duplicate Packer scan. An Admin-only row must still
    // reach the backend so the Packer fields can be merged into that row.
    if (!getScanIssueMeta(scanRemark).isIssue) {
      const alreadyInPacker = shouldBlockPackerScan(recentRows, validation.code, selectedCourier);
      if (alreadyInPacker) {
        setStatus({
          type: 'duplicate',
          title: 'เลขซ้ำ — ลงแล้ว',
          message: `${validation.code} ${alreadyInDrive ? 'เคยลง Drive แล้ว' : 'Packer สแกนแล้ว'} กรุณาตรวจสอบ`,
        });
        showCameraMessage(`ลงแล้ว: ${validation.code}`, 'duplicate');
        playTone('duplicate');
        return { status: 'duplicate', code: validation.code };
      }
    }

    setBusy(true);
    try {
      const nowParts = getBangkokParts();
      const firestorePrimary = canUseFirestorePrimary()
        ? await recordPackerScanPrimary({
            code: validation.code,
            courier: selectedCourier,
            date: nowParts.date,
            time: nowParts.time,
            user: firebaseUser ?? user,
            packer: selectedPacker === PACKER_UNASSIGNED ? '' : selectedPacker,
            note: scanRemark,
          })
        : null;

      if (firestorePrimary?.status === 'duplicate') {
        const syncPending = firestorePrimary.sheetSyncStatus === 'pending';
        const duplicateResult = {
          status: 'duplicate',
          courier: selectedCourier,
          date: nowParts.date,
          time: nowParts.time,
          code: validation.code,
          count: selectedCount,
          rows: recentRows,
          sheetUrl,
        };
        setStatus({
          type: 'duplicate',
          title: syncPending ? 'กำลังซิงก์ Google Sheet' : 'เลขซ้ำ',
          message: syncPending
            ? `${validation.code} บันทึกใน Firebase แล้ว และกำลังซิงก์ Google Sheet อยู่`
            : `${validation.code} มีอยู่แล้วใน Firebase สำหรับ ${selectedCourier}`,
        });
        showCameraMessage(syncPending ? `${validation.code} กำลังซิงก์ Sheet` : `เลขซ้ำ: ${validation.code}`, 'duplicate');
        playTone('duplicate');
        setScanRemark('');
        return duplicateResult;
      }

      const packerName = selectedPacker === PACKER_UNASSIGNED ? '' : selectedPacker;
      const scanNote = scanRemark;
      const scanCourier = selectedCourier;
      const scanUser = firebaseUser ?? user;
      const scanEmail = user.email;
      const marketplaceOrderPromise = findMarketplaceOrderByTracking({ trackingNo: validation.code }).catch(() => null);
      let result;

      if (firestorePrimary?.id) {
        const issueMeta = getScanIssueMeta(scanNote);
        const rowStatus = issueMeta.isIssue
          ? issueMeta.sheetStatus
          : scanNote === ISSUE_DAMAGED
            ? 'Damaged'
            : 'Success';
        const optimisticRow = {
          no: firestorePrimary.id,
          courierNo: '',
          date: nowParts.date,
          time: nowParts.time,
          courier: scanCourier,
          code: validation.code,
          email: scanEmail,
          packer: packerName,
          status: rowStatus,
          note: scanNote,
          sheetSyncStatus: 'pending',
        };
        result = {
          status: issueMeta.resultStatus,
          courier: scanCourier,
          date: nowParts.date,
          time: nowParts.time,
          code: validation.code,
          count: selectedCount + 1,
          rows: [optimisticRow, ...recentRows].slice(0, 50),
          sheetUrl,
          sheetSyncStatus: 'pending',
        };

        runAfterScanCommit(async () => {
          let backgroundResult = result;
          try {
            const marketplaceOrder = await marketplaceOrderPromise;
            // If admin scanned first, include admin K-M data so Sheet row gets admin columns
            const adminData = firestorePrimary?.admin?.scannedAt
              ? {
                  adminDate: firestorePrimary.adminDate || firestorePrimary.admin.scannedAt?.split('T')?.[0] || nowParts.date,
                  adminTime: firestorePrimary.adminTime || firestorePrimary.admin.scannedAt?.split('T')?.[1]?.substring?.(0, 8) || nowParts.time,
                  adminCode: firestorePrimary.adminCode || firestorePrimary.code || validation.code,
                }
              : {};
            const sheetResult = await runWithGoogleRetry((accessToken, googleConfig) =>
              appendScanGoogle({
                token: accessToken,
                config: googleConfig,
                courier: scanCourier,
                code: validation.code,
                email: scanEmail,
                packer: packerName,
                note: scanNote,
                marketplaceOrder,
                ...adminData,
              }),
            { sheetWrite: true });
            await markSheetSyncResult({ orderId: firestorePrimary.id, attemptId: firestorePrimary.sheetSyncAttemptId, ok: true, result: sheetResult }).catch(() => {});
            backgroundResult = { ...result, ...sheetResult, sheetSyncStatus: 'synced' };
          } catch (sheetError) {
            await markSheetSyncResult({ orderId: firestorePrimary.id, attemptId: firestorePrimary.sheetSyncAttemptId, ok: false, error: sheetError }).catch(() => {});
            setStatus({
              type: 'warning',
              title: 'บันทึก Firestore แล้ว แต่ Sheet ยังไม่สำเร็จ',
              message: `${validation.code} ถูกเก็บไว้ในคิวกู้คืนอัตโนมัติ: ${sheetError.message}`,
            });
            showCameraMessage(`${validation.code} รอซิงก์ Sheet`, 'warning');
            backgroundResult = {
              ...result,
              sheetSyncStatus: 'failed',
              sheetSyncError: sheetError.message,
            };
          }

          await mirrorScanToFirestore({
            type: 'packer',
            result: backgroundResult,
            courier: scanCourier,
            user: scanUser,
            packer: packerName,
            note: scanNote,
          }).catch(() => {});
          scheduleCountRefresh();
        });
      } else {
        try {
          const marketplaceOrder = await marketplaceOrderPromise;
          result = await commitFallbackScan({
            appendToSheet: () => runWithGoogleRetry((accessToken, googleConfig) =>
              appendScanGoogle({
                token: accessToken,
                config: googleConfig,
                courier: scanCourier,
                code: validation.code,
                email: scanEmail,
                packer: packerName,
                note: scanNote,
                marketplaceOrder,
              }),
            { sheetWrite: true }),
            mirrorToFirestore: (sheetResult) => mirrorScanToFirestore({
              type: 'packer',
              result: sheetResult,
              courier: scanCourier,
              user: scanUser,
              packer: packerName,
              note: scanNote,
            }),
          });
        } catch (sheetError) {
          throw sheetError;
        }
      }

      if (source !== 'manual') {
        setScanValue(result.code);
      }
      setToday({ date: result.date, time: result.time });
      setRecentRows(result.rows ?? []);

      if (result.status === 'success' && isSignedIn) {
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 600);
        setSummary((current) =>
          current.map((item) =>
            item.courier === scanCourier ? { ...item, count: item.count + 1 } : item,
          ),
        );
        if (packerName) {
          setPackerCounts((current) => {
            const existing = current.find((item) => item.packer === packerName);
            return existing
              ? current.map((item) => (item.packer === packerName ? { ...item, count: item.count + 1 } : item))
              : [...current, { packer: packerName, count: 1 }];
          });
        }
        scheduleCountRefresh();
      }

      if (result.status === 'firestore_unconfirmed') {
        setStatus({
          type: 'error',
          title: 'ยังยืนยัน Firestore ไม่สำเร็จ',
          message: result.message,
        });
        showCameraMessage(result.message, 'error');
        playTone('error');
      } else if (result.status === 'cancelled') {
        setStatus({
          type: 'success',
          title: 'บันทึกยกเลิกแล้ว',
          message: `${result.code} ถูกทำเครื่องหมาย ${ISSUE_CUSTOMER_CANCELLED} ใน ${selectedCourier}`,
        });
        showCameraMessage(`${result.code} ยกเลิกแล้ว`, 'success');
        playTone('success');
        setScanRemark('');
      } else if (result.status === 'returned') {
        setStatus({
          type: 'success',
          title: 'บันทึกสินค้าตีกลับแล้ว',
          message: `${result.code} ถูกทำเครื่องหมาย ${ISSUE_RETURNED} ใน ${selectedCourier}`,
        });
        showCameraMessage(`${result.code} ตีกลับแล้ว`, 'success');
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
        setScanRemark('');
      } else {
        const mergedNote = result.merged ? ' (จับคู่กับ Admin ที่ลง Drive ไว้)' : '';
        setStatus({
          type: 'success',
          title: 'สแกนสำเร็จ' + mergedNote,
          message: `${result.code} ถูกบันทึกเข้า ${selectedCourier} โดย ${selectedPacker} วันที่ ${result.date}${scanRemark ? ` (${scanRemark})` : ''}`,
        });
        showCameraMessage(`${result.code} บันทึกสำเร็จ`, 'success');
        playTone('success');
        setScanRemark('');
      }
      if (!firestorePrimary?.id) {
        await refreshSelectedCourierRows().catch(() => {});
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

  async function saveAdminScannedCode(rawCode, source = 'manual') {
    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'กด Login with Google เพื่อบันทึกเข้า Google Sheet จริง',
      });
      playTone('error');
      return { status: 'error' };
    }

    const validation = validateScanCode(selectedCourier, rawCode, {
      allowAnyFormat: source === 'manual' && allowAnyTrackingFormat,
    });
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

    if (source === 'manual') {
      setScanValue('');
    }

    setBusy(true);
    try {
      const nowParts = getBangkokParts();
      const firestorePrimary = canUseFirestorePrimary()
        ? await recordAdminScanPrimary({
            code: validation.code,
            courier: selectedCourier,
            date: nowParts.date,
            time: nowParts.time,
            user: firebaseUser ?? user,
          })
        : null;

      if (firestorePrimary?.status === 'duplicate') {
        const order = firestorePrimary;
        
        // If already synced to Sheet → genuine duplicate
        if (order.sheetSyncStatus === 'synced') {
          setStatus({
            type: 'duplicate',
            title: 'เลขซ้ำใน Firebase',
            message: `${validation.code} เคยลง Drive สำหรับ ${selectedCourier} แล้ว`,
          });
          showCameraMessage(`ลงแล้ว: ${validation.code}`, 'duplicate');
          playTone('duplicate');
          return {
            status: 'duplicate',
            courier: selectedCourier,
            date: nowParts.date,
            time: nowParts.time,
            code: validation.code,
            rows: driveRecentRows,
            sheetUrl,
          };
        }
        
        // Still syncing → prevent double-scan
        if (order.sheetSyncStatus === 'pending') {
          setStatus({
            type: 'duplicate',
            title: 'กำลังซิงก์ Google Sheet',
            message: `${validation.code} บันทึกใน Firebase แล้ว และกำลังซิงก์ Google Sheet อยู่`,
          });
          showCameraMessage(`${validation.code} กำลังซิงก์ Sheet`, 'duplicate');
          playTone('duplicate');
          return {
            status: 'duplicate',
            courier: selectedCourier,
            date: nowParts.date,
            time: nowParts.time,
            code: validation.code,
            rows: driveRecentRows,
            sheetUrl,
          };
        }
        
        // Failed → reclaim: write to Sheet with admin data from Firestore
        const adminReclaim = {
          adminDate: order.admin?.date || order.date || nowParts.date,
          adminTime: order.admin?.time || nowParts.time,
          adminCode: order.adminCode || order.code || validation.code,
        };
        
        // Build rows and continue below (fall through to normal admin scan flow)
        const reclaimRow = {
          no: order.id,
          date: nowParts.date,
          time: nowParts.time,
          courier: selectedCourier,
          code: '',
          adminCode: adminReclaim.adminCode,
          adminDate: adminReclaim.adminDate,
          adminTime: adminReclaim.adminTime,
          email: user.email,
          status: order.status === 'matched' ? 'Success' : 'Pending',
          sheetSyncStatus: 'pending',
        };
        
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 600);
        setStatus({
          type: 'success',
          title: 'ลง Drive สำเร็จ (กู้คืน)',
          message: `${validation.code} เคยลง Drive แล้ว แต่ Sheet ยังไม่สมบูรณ์ กำลังเขียน Sheet ใหม่`,
        });
        showCameraMessage(`${validation.code} ลง Drive สำเร็จ`, 'success');
        playTone('success');
        setDriveRecentRows([reclaimRow, ...driveRecentRows].slice(0, 50));
        setDriveTotalCount((prev) => prev + 1);
        setToday({ date: nowParts.date, time: nowParts.time });
        if (source !== 'manual') setScanValue(validation.code);
        
        // Background: re-sync to Sheet via appendAdminScanGoogle
        runAfterScanCommit(async () => {
          try {
            const marketplaceOrder = await findMarketplaceOrderByTracking({ trackingNo: validation.code }).catch(() => null);
            const sheetResult = await runWithGoogleRetry((accessToken, googleConfig) =>
              appendAdminScanGoogle({
                token: accessToken,
                config: googleConfig,
                courier: selectedCourier,
                code: adminReclaim.adminCode,
                email: user.email,
                marketplaceOrder,
              }),
            { sheetWrite: true });
            await markSheetSyncResult({
              orderId: order.id,
              attemptId: order.sheetSyncAttemptId || `reclaim_${Date.now()}`,
              ok: true,
              result: sheetResult,
            }).catch(() => {});
          } catch (sheetError) {
            await markSheetSyncResult({
              orderId: order.id,
              attemptId: order.sheetSyncAttemptId || `reclaim_${Date.now()}`,
              ok: false,
              error: sheetError,
            }).catch(() => {});
            setStatus({
              type: 'warning',
              title: 'บันทึก Firestore แล้ว แต่ Sheet ยังไม่สำเร็จ',
              message: `${validation.code} ถูกเก็บไว้ในคิวกู้คืนอัตโนมัติ: ${sheetError.message}`,
            });
            showCameraMessage(`${validation.code} รอซิงก์ Sheet`, 'warning');
          }
          scheduleCountRefresh();
        });
        
        return {
          status: 'admin_scan',
          courier: selectedCourier,
          date: nowParts.date,
          time: nowParts.time,
          code: validation.code,
          rows: [reclaimRow, ...driveRecentRows].slice(0, 50),
          sheetUrl,
        };
      }

      const scanCourier = selectedCourier;
      const scanUser = firebaseUser ?? user;
      const scanEmail = user.email;
      const marketplaceOrderPromise = findMarketplaceOrderByTracking({ trackingNo: validation.code }).catch(() => null);
      let result;

      if (firestorePrimary?.id) {
        const optimisticRow = {
          no: firestorePrimary.id,
          date: nowParts.date,
          time: nowParts.time,
          courier: scanCourier,
          code: '',
          adminCode: validation.code,
          adminDate: nowParts.date,
          adminTime: nowParts.time,
          email: scanEmail,
          status: firestorePrimary.status === 'matched' ? 'Success' : 'Pending',
          sheetSyncStatus: 'pending',
        };
        result = {
          status: firestorePrimary.status === 'matched' ? 'admin_matched' : 'admin_scan',
          courier: scanCourier,
          date: nowParts.date,
          time: nowParts.time,
          code: validation.code,
          rows: [optimisticRow, ...driveRecentRows].slice(0, 50),
          sheetUrl,
          sheetSyncStatus: 'pending',
        };

        runAfterScanCommit(async () => {
          let backgroundResult = result;
          try {
            const marketplaceOrder = await marketplaceOrderPromise;
            const adminScanTiming = getAdminScanTiming(
              firestorePrimary?.existing ?? firestorePrimary,
              { fallbackDate: nowParts.date, fallbackTime: nowParts.time },
            );
            const existingPackerScan = firestorePrimary?.existing?.packerScan;
            const hasPackerScan = Boolean(existingPackerScan?.scannedAt);
            const sheetResult = await runWithGoogleRetry((accessToken, googleConfig) =>
              hasPackerScan
                ? appendScanGoogle({
                    token: accessToken,
                    config: googleConfig,
                    courier: scanCourier,
                    code: validation.code,
                    email: existingPackerScan.scannedBy?.email || scanEmail,
                    packer: existingPackerScan.packer || firestorePrimary?.existing?.packer || '',
                    note: existingPackerScan.note || firestorePrimary?.existing?.note || '',
                    marketplaceOrder,
                    scanDate: adminScanTiming.sheetDate,
                    scanTime: adminScanTiming.sheetTime,
                    adminDate: adminScanTiming.adminDate,
                    adminTime: adminScanTiming.adminTime,
                    adminCode: firestorePrimary?.existing?.code || validation.code,
                  })
                : appendAdminScanGoogle({
                    token: accessToken,
                    config: googleConfig,
                    courier: scanCourier,
                    code: validation.code,
                    email: scanEmail,
                    marketplaceOrder,
                    scanDate: adminScanTiming.sheetDate,
                    scanTime: adminScanTiming.sheetTime,
                    adminDate: adminScanTiming.adminDate,
                    adminTime: adminScanTiming.adminTime,
                    adminCode: firestorePrimary?.existing?.code || validation.code,
                  }),
            { sheetWrite: true });
            await markSheetSyncResult({ orderId: firestorePrimary.id, attemptId: firestorePrimary.sheetSyncAttemptId, ok: true, result: sheetResult }).catch(() => {});
            backgroundResult = { ...result, ...sheetResult, sheetSyncStatus: 'synced' };
          } catch (sheetError) {
            await markSheetSyncResult({ orderId: firestorePrimary.id, attemptId: firestorePrimary.sheetSyncAttemptId, ok: false, error: sheetError }).catch(() => {});
            backgroundResult = {
              ...result,
              sheetSyncStatus: 'failed',
              sheetSyncError: sheetError.message,
            };
          }

          await mirrorScanToFirestore({
            type: 'admin',
            result: backgroundResult,
            courier: scanCourier,
            user: scanUser,
          }).catch(() => {});
          scheduleCountRefresh();
        });
      } else {
        try {
          const marketplaceOrder = await marketplaceOrderPromise;
          result = await commitFallbackScan({
            appendToSheet: () => runWithGoogleRetry((accessToken, googleConfig) =>
              appendAdminScanGoogle({
                token: accessToken,
                config: googleConfig,
                courier: scanCourier,
                code: validation.code,
                email: scanEmail,
                marketplaceOrder,
              }),
            { sheetWrite: true }),
            mirrorToFirestore: (sheetResult) => mirrorScanToFirestore({
              type: 'admin',
              result: sheetResult,
              courier: scanCourier,
              user: scanUser,
            }),
          });
        } catch (sheetError) {
          throw sheetError;
        }
      }

      if (source !== 'manual') {
        setScanValue(result.code);
      }
      setToday({ date: result.date, time: result.time });
      setDriveRecentRows(result.rows ?? []);
      setDriveTotalCount(result.rows?.length ?? 0);

      if (result.status === 'firestore_unconfirmed') {
        setStatus({
          type: 'error',
          title: 'ยังยืนยัน Firestore ไม่สำเร็จ',
          message: result.message,
        });
        showCameraMessage(result.message, 'error');
        playTone('error');
      } else if (result.status === 'admin_scan' && result.sheetSyncStatus === 'pending') {
        setStatus({
          type: 'warning',
          title: 'บันทึก Firebase แล้ว กำลังลง Sheet',
          message: `${result.code} บันทึกแล้ว กรุณารอการซิงก์ Google Sheet`,
        });
        showCameraMessage(`${result.code} กำลังลง Sheet`, 'warning');
        playTone('success');
      } else if (result.status === 'admin_scan') {
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 600);
        setStatus({
          type: 'success',
          title: 'ลง Drive สำเร็จ',
          message: `${result.code} ลง Drive ใน ${selectedCourier} วันที่ ${result.date} รอ Packer สแกนส่ง`,
        });
        showCameraMessage(`${result.code} ลง Drive สำเร็จ`, 'success');
        playTone('success');
      } else if (result.status === 'admin_matched') {
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 600);
        setStatus({
          type: 'success',
          title: 'ลง Drive สำเร็จ (Packer สแกนแล้ว)',
          message: `${result.code} ถูกลง Drive และมี Packer สแกนส่งแล้ว`,
        });
        showCameraMessage(`${result.code} Packer สแกนแล้ว`, 'success');
        playTone('success');
      } else if (result.status === 'duplicate') {
        setStatus({
          type: 'duplicate',
          title: 'เลขซ้ำใน Drive',
          message: `${result.code} เคยลง Drive สำหรับ ${selectedCourier} วันที่ ${result.date} แล้ว`,
        });
        showCameraMessage(`ลงแล้ว: ${result.code}`, 'duplicate');
        playTone('duplicate');
      }

      // Trigger auto-check after admin scan
      setTimeout(() => runAutoCheck(), 2000);

      if (!firestorePrimary?.id) {
        await refreshDriveRows().catch(() => {});
      }

      return { ...result, status: result.status };
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'ลง Drive ไม่สำเร็จ',
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
    if (activeTab === 'drive') {
      await saveAdminScannedCode(scanValue, 'manual');
    } else {
      await saveScannedCode(scanValue, 'manual');
    }
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

    const result = activeTab === 'drive'
      ? await saveAdminScannedCode(code, 'camera')
      : await saveScannedCode(code, 'camera');

    if (scanModeRef.current === 'single') {
      await stopCamera();
      if (result.status === 'success' || result.status === 'cancelled' || result.status === 'returned' || result.status === 'admin_scan' || result.status === 'admin_matched') {
        showCameraMessage('หยุดแล้ว: สแกนทีละรายการเสร็จ', 'success');
      }
    }
  }

  function startCameraPopup() {
    return startCamera(CAMERA_POPUP_ID);
  }

  async function startCamera(regionId = CAMERA_REGION_ID) {
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
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await loadHtml5Qrcode();
      const scanner = new Html5Qrcode(regionId, {
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
    }
  }

  async function handleCheckMissingOrders() {
    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'Login with Google ก่อนตรวจสอบออเดอร์ตกหล่น',
      });
      return;
    }

    setMissingBusy(true);
    try {
      const results = canUseFirestorePrimary()
        ? await checkMissingOrdersFirestore({
            courier: null,
            hoursLookback: DEFAULT_LOOKBACK_HOURS,
            thresholdMinutes,
          })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
            checkMissingOrders({
              token: accessToken,
              config: googleConfig,
              courier: null,
              hoursLookback: DEFAULT_LOOKBACK_HOURS,
              thresholdMinutes,
            }),
          );

      setMissingResults(results);
      setMissingAlertBadge(results.pending?.length ?? 0);
      setMissingCheckCache(results);

      const pendingCount = results.pending?.length ?? 0;
      if (pendingCount > 0) {
        setStatus({
          type: 'warning',
          title: 'ตรวจสอบเสร็จสิ้น',
          message: `พบ ${pendingCount} ออเดอร์เสี่ยงตกหล่น จากทั้งหมด ${results.totalAdminScans} รายการที่ลง Drive`,
        });
        playTone('alert');
      } else {
        setStatus({
          type: 'success',
          title: 'ตรวจสอบเสร็จสิ้น',
          message: `ไม่พบออเดอร์ตกหล่น จากทั้งหมด ${results.totalAdminScans} รายการที่ลง Drive`,
        });
      }
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'ตรวจสอบไม่สำเร็จ',
        message: error.message,
      });
    } finally {
      setMissingBusy(false);
    }
  }

  async function copyMissingReport() {
    if (!missingResults) {
      return;
    }

    const text = buildMissingAlertMessage(missingResults);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        setStatus({
          type: 'error',
          title: 'คัดลอกไม่สำเร็จ',
          message: 'เบราว์เซอร์ไม่อนุญาตให้เข้าถึง Clipboard ลองกดคัดลอกใหม่อีกครั้ง',
        });
        playTone('error');
        return;
      }
    }
    setStatus({
      type: 'success',
      title: 'คัดลอกรายงานแล้ว',
      message: 'นำไปวางใน Gmail, LINE หรือช่องทางที่ต้องการได้เลย',
    });
    playTone('success');
  }

  async function copyCompactSummary() {
    if (!missingResults) {
      return;
    }

    const text = buildCompactSummary(missingResults);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        return;
      }
    }
    setStatus({
      type: 'success',
      title: 'คัดลอกสรุปแล้ว',
      message: 'นำไปวางใน Gmail, LINE หรือช่องทางที่ต้องการได้เลย',
    });
    playTone('success');
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
      const results = canUseFirestorePrimary()
        ? await searchScansFirestore({
            query,
            couriers: searchScope === 'all' ? couriers : [selectedCourier],
            dates: searchMode === 'all' ? null : dates,
          })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
            searchScansGoogle({
              token: accessToken,
              config: googleConfig,
              query,
              couriers: searchScope === 'all' ? couriers : [selectedCourier],
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

    if (!window.confirm(`ยืนยันทำเครื่องหมาย "สินค้าเสียหาย" สำหรับ ${row.code}?`)) {
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
        { sheetWrite: true },
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
      const data = canUseFirestorePrimary()
        ? await getScanReportFirestore({ couriers, dates })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
          getScanReportGoogle({ token: accessToken, config: googleConfig, dates, couriers }),
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

  async function backfillSelectedReportRange() {
    if (!isSignedIn || !token || !config) {
      setStatus({
        type: 'warning',
        title: 'ต้อง Login ก่อน',
        message: 'Login ให้ระบบเชื่อม Google Sheet ก่อนดึงข้อมูลย้อนหลังเข้า Firestore',
      });
      return;
    }

    const dates = getReportDates();
    if (dates.length === 0) {
      setStatus({
        type: 'warning',
        title: 'ช่วงวันที่ไม่ถูกต้อง',
        message: 'เลือกวันที่/เดือนที่ต้องการดึงข้อมูลย้อนหลังก่อน',
      });
      return;
    }

    setBackfillBusy(true);
    try {
      const rows = await runWithGoogleRetry((accessToken, googleConfig) =>
        getRowsForFirestoreBackfillGoogle({ token: accessToken, config: googleConfig, dates }),
      );
      const result = await backfillOrdersFromSheetRows({ rows, user: firebaseUser ?? user });
      await refreshAllCounts();
      if (activeTab === 'packer') {
        await refreshSelectedCourierRows();
      } else {
        await refreshDriveRows();
      }
      await generateReport();
      setStatus({
        type: result.failed > 0 ? 'warning' : 'success',
        title: 'ดึงข้อมูลย้อนหลังเข้า Firestore แล้ว',
        message: `นำเข้า ${result.imported} รายการ, ข้าม ${result.skipped}, ไม่สำเร็จ ${result.failed}`,
      });
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'ดึงข้อมูลย้อนหลังไม่สำเร็จ',
        message: error.message,
      });
    } finally {
      setBackfillBusy(false);
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
      ...couriers.map((courier) => {
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
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        setStatus({
          type: 'error',
          title: 'คัดลอกไม่สำเร็จ',
          message: 'เบราว์เซอร์ไม่อนุญาตให้เข้าถึง Clipboard ลองกดคัดลอกใหม่อีกครั้ง',
        });
        playTone('error');
        return;
      }
    }
    setStatus({
      type: 'success',
      title: 'คัดลอกรายงานแล้ว',
      message: 'นำไปวางใน Gmail, LINE หรือช่องทางที่ต้องการได้เลย',
    });
    playTone('success');
  }

  // --- Missing order check results UI ---
  const missingUISections = missingResults ? formatMissingResultsForUI(missingResults) : [];
  const dashboardSummary = missingResults ? buildDashboardSummary(missingResults) : null;

  return (
    <main className="app-shell">
      <section className="topbar">
        <div className="app-title">
          <span className="title-badge">
            <ScanLine size={22} />
            Scan to Sheet
          </span>
          <h1>สแกนใบปะหน้าเข้า Google Sheet</h1>
          <span className="title-accent" />
        </div>
        <div className="account-strip">
          <div className="account-pill">
            <Mail size={16} />
            <span>{user.email}</span>
          </div>
          <div className="top-connect-box">
            <div className="connect-title">
              <FileSpreadsheet size={18} />
              <span>{isSignedIn ? 'Firestore พร้อมใช้งาน' : 'Firebase ยังไม่เชื่อม'}</span>
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

      {/* Tab Bar */}
      <nav className="tab-bar" aria-label="เลือกโหมดการทำงาน">
        <button
          data-testid="packer-tab"
          className={`tab-button ${activeTab === 'packer' ? 'active' : ''}`}
          type="button"
          onClick={() => { setActiveTab('packer'); setScanPopupOpen(false); void stopCamera(); }}
        >
          <PackageCheck size={18} />
          <span>📦 แพ็กสินค้า (Packer)</span>
        </button>
        <button
          data-testid="drive-tab"
          className={`tab-button ${activeTab === 'drive' ? 'active' : ''}`}
          type="button"
          onClick={() => { setActiveTab('drive'); setScanPopupOpen(false); void stopCamera(); }}
        >
          <Upload size={18} />
          <span>📥 รับเข้า Drive (Admin)</span>
          {missingAlertBadge > 0 && (
            <span className="tab-badge">{missingAlertBadge}</span>
          )}
        </button>
      </nav>

      <section className={`workflow-guide ${activeTab === 'drive' ? 'drive-workflow-guide' : 'packer-workflow-guide'}`}>
        {activeTab === 'drive' ? <Upload size={24} /> : <PackageCheck size={24} />}
        <div>
          <strong>{activeTab === 'drive' ? 'รับเข้า Drive' : 'แพ็กสินค้า'}</strong>
          <p>{activeTab === 'drive' ? 'สแกนรับพัสดุเข้าระบบก่อนส่งให้ Packer แพ็กสินค้า' : 'สแกนพัสดุหลังแพ็กเสร็จ เพื่อบันทึกผู้แพ็กและสถานะ'}</p>
        </div>
      </section>

      <section className="marketplace-upload-panel" aria-labelledby="marketplace-upload-title">
        <div>
          <div className="panel-heading" id="marketplace-upload-title">
            <FileSpreadsheet size={18} />
            <span>อัปโหลดออเดอร์ Seller Center</span>
          </div>
          <p>เลือกไฟล์ .xlsx หรือ .csv จาก Shopee, Lazada และ TikTok ได้หลายไฟล์พร้อมกัน</p>
        </div>
        <div className="marketplace-upload-controls">
          <label className="field-control marketplace-filter">
            <span>กรองแพลตฟอร์ม</span>
            <select
              value={marketplaceFilterPlatform}
              onChange={(e) => setMarketplaceFilterPlatform(e.target.value)}
              disabled={!firebaseUser || marketplaceUploadBusy}
            >
              <option value="all">ทุกแพลตฟอร์ม</option>
              <option value="shopee">Shopee</option>
              <option value="lazada">Lazada</option>
              <option value="tiktok">TikTok</option>
            </select>
          </label>
          <input
            ref={marketplaceFileRef}
            className="visually-hidden"
            type="file"
            accept=".xlsx,.csv"
            multiple
            onChange={uploadMarketplaceFiles}
            aria-label="เลือกไฟล์ออเดอร์ Seller Center"
          />
          <button
            className="secondary-button"
            type="button"
            onClick={() => marketplaceFileRef.current?.click()}
            disabled={!firebaseUser || marketplaceUploadBusy}
          >
            {marketplaceUploadBusy ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}
            <span>{marketplaceUploadBusy ? 'กำลังอัปโหลด...' : 'เลือกไฟล์ออเดอร์'}</span>
          </button>
        </div>
        {marketplaceUploadResult && (
          <div className={`marketplace-upload-result ${marketplaceUploadResult.type}`} role="status">
            {marketplaceUploadResult.message}
          </div>
        )}
      </section>

      <section className="workspace-grid">
        <aside className={`side-panel workflow-${activeTab}`}>
          <div className="panel-heading">
            <Truck size={18} />
            <span>เลือกขนส่ง</span>
          </div>

          <div className="courier-list">
            {couriers.map((courier) => (
              <button
                className={`courier-button ${courier === selectedCourier ? 'active' : ''}`}
                key={courier}
                type="button"
                onClick={() => {
                  setSelectedCourier(courier);
                  setScanPopupOpen(true);
                  setScanRemark('');
                }}
                disabled={!isSignedIn || cameraActive}
              >
                <span>{courier}</span>
                <strong>{displayedCourierCounts.find((item) => item.courier === courier)?.count ?? 0}</strong>
              </button>
            ))}
          </div>

          <form className="courier-add-form" onSubmit={(event) => { event.preventDefault(); void handleAddCourier(); }}>
            <label htmlFor="courier-select">เพิ่มขนส่งเอง</label>
            <div className="courier-add-row">
              <select
                id="courier-select"
                value={courierSelectValue}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value) {
                    setSelectedCourier(value);
                    setAllowAnyTrackingFormat(true);
                    setScanPopupOpen(true);
                    setScanRemark('');
                    setCourierSelectValue('');
                  }
                }}
                disabled={!firebaseUser || addingCourier}
              >
                <option value="">เลือกจากขนส่งที่มี...</option>
                {couriers.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="courier-add-divider">
              <span>หรือพิมพ์ชื่อขนส่งใหม่</span>
            </div>
            <div>
              <input
                id="new-courier-name"
                value={newCourierName}
                onChange={(event) => setNewCourierName(event.target.value)}
                placeholder="เช่น DHL"
                maxLength={80}
                disabled={!firebaseUser || addingCourier}
              />
              <button type="submit" disabled={!firebaseUser || addingCourier || !newCourierName.trim()} title="เพิ่มขนส่ง">
                <Plus size={16} />
              </button>
            </div>
            <small>ผู้ใช้ที่ลงชื่อเข้าใช้เพิ่มได้ และจะแสดงทั้งหน้าแพ็ก/Drive</small>
          </form>

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
            {scanMethod === 'manual' && (
              <label className="manual-format-option">
                <input
                  type="checkbox"
                  checked={allowAnyTrackingFormat}
                  onChange={(event) => setAllowAnyTrackingFormat(event.target.checked)}
                  disabled={!isSignedIn || busy}
                />
                <span>เลขพิเศษ: ไม่ตรวจรูปแบบ Tracking</span>
              </label>
            )}
          </div>
        </aside>

        <section className={`scan-panel workflow-${activeTab}`}>
          <div className="scan-header">
            <div>
              <p className="eyebrow">{activeTab === 'drive' ? 'รับเข้า Drive →' : 'ขนส่งที่เลือก'}</p>
              <h2>{selectedCourier}</h2>
              {activeTab === 'drive' && (
                <span className="drive-mode-label">📥 รับเข้า Drive ก่อนส่งให้ Packer สแกนแพ็ก</span>
              )}
            </div>
            <div className="date-box">
              <Clock3 size={18} />
              <span>{today.date}</span>
              <strong>{today.time}</strong>
            </div>
          </div>

          {/* Packer-only controls */}
          {activeTab === 'packer' && (
            <>
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
                  {scanRemark === ISSUE_CUSTOMER_CANCELLED ? `✓ ${ISSUE_CUSTOMER_CANCELLED}` : ISSUE_CUSTOMER_CANCELLED}
                </button>
                <button
                  className={scanRemark === ISSUE_RETURNED ? 'active' : ''}
                  type="button"
                  onClick={() => setScanRemark((value) => (value === ISSUE_RETURNED ? '' : ISSUE_RETURNED))}
                  disabled={!isSignedIn || busy}
                >
                  {scanRemark === ISSUE_RETURNED ? `✓ ${ISSUE_RETURNED}` : ISSUE_RETURNED}
                </button>
                <span>
                  {scanRemark
                    ? `รายการถัดไป: ${selectedPacker} / ${scanRemark}`
                    : selectedPacker === PACKER_UNASSIGNED
                      ? 'ต้องเลือก Packer ก่อนสแกน'
                      : `รายการถัดไปบันทึก Packer: ${selectedPacker}`}
                </span>
              </div>
            </>
          )}

          {/* Drive-only controls */}
          {activeTab === 'drive' && (
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
          )}

          {allowAnyTrackingFormat && (
            <div className="any-format-warning">
              <AlertTriangle size={16} />
              <span>⚠️ ข้ามการตรวจรูปแบบ Tracking: เลขอะไรก็สแกนผ่าน</span>
            </div>
          )}

          <div className={`current-courier-badge workflow-${activeTab}`}>
            <Truck size={18} />
            <span>{activeTab === 'drive' ? 'กำลังรับเข้า Drive' : 'กำลังสแกนแพ็ก'}</span>
            <strong>{selectedCourier}</strong>
          </div>

          {scanMethod === 'camera' ? (
            <div className={`camera-panel workflow-${activeTab}`}>
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
                    <button className="secondary-button" type="button" onClick={startCamera} disabled={busy || !isSignedIn}>
                      <Camera size={16} />
                      <span>เปิดกล้อง</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <form className={`scan-form workflow-${activeTab}`} onSubmit={handleScanSubmit}>
              <label htmlFor="scan-input">
                {activeTab === 'drive' ? 'Tracking / Barcode (รับเข้า Drive)' : 'Tracking / Barcode (แพ็กสินค้า)'}
              </label>
              <div className={`scan-input-row ${scanFlash ? 'flash' : ''}`}>
                <ScanLine size={24} />
                <input
                  id="scan-input"
                  ref={inputRef}
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value)}
                  placeholder={
                    isSignedIn
                      ? activeTab === 'drive'
                        ? 'ยิงบาร์โค้ดหรือ QR แล้วกด Enter เพื่อรับเข้า Drive'
                        : isPackerReady
                          ? 'ยิงบาร์โค้ดหรือ QR แล้วกด Enter'
                          : 'เลือก Packer ก่อนเริ่มสแกน'
                      : 'Login with Google ก่อนเริ่มสแกน'
                  }
                  autoComplete="off"
                  disabled={busy || !isSignedIn || (activeTab === 'packer' && !isPackerReady)}
                />
                <button type="submit" disabled={busy || !isSignedIn || (activeTab === 'packer' && !isPackerReady)}>
                  {busy ? <RefreshCw size={18} className="spin" /> : <Play size={18} />}
                  <span>{activeTab === 'drive' ? 'รับเข้า Drive' : 'บันทึกแพ็ก'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Packer-only: Search, Status, Metrics, Recent, Reports */}
          {activeTab === 'packer' && (
            <>
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
                                <td><span className={`status-badge ${(row.status || '').toLowerCase()}`}>{row.status}</span></td>
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
                  <strong>{isSignedIn ? (isSheetConnected ? 'Firestore + Sheet Sync' : 'Firestore') : 'รอ Login'}</strong>
                </div>
              </div>

              {isSignedIn && totalTodayCount > 0 && (
                <div className="packer-section">
                  <div className="packer-header">
                    <span className="eyebrow">Packer วันนี้</span>
                    <button
                      className="text-button refresh-button"
                      type="button"
                      onClick={() => refreshAllCounts()}
                      title="รีเฟรชข้อมูลจาก Sheet"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  <div className="packer-row">
                    {packerCounts.map(({ packer, count }) => (
                      <div key={packer}>
                        <span>{packer}</span>
                        <strong>{count}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                          {isSignedIn ? 'ยังไม่มีรายการของวันนี้ใน Firestore' : 'เข้าสู่ระบบเพื่อโหลดรายการ'}
                        </td>
                      </tr>
                    ) : (
                      displayedRecentRows.map((row) => (
                        <tr key={`${row.no}-${row.courierNo}-${row.code}-${row.time}`}>
                          <td>{row.courierNo}</td>
                          <td>{row.time}</td>
                          <td className="code-cell">{row.code}</td>
                          <td>{row.email}</td>
                          <td>
                            <span className={`status-badge ${(row.status || '').toLowerCase()}`}>{row.status}</span>
                            {row.date && row.adminDate && row.date !== row.adminDate && <span className="status-badge cross-day">ข้ามวัน</span>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Drive-only: Dashboard + Missing Order Check */}
          {activeTab === 'drive' && (
            <>
              <StatusBanner status={status} />

              {/* Drive Dashboard */}
              <div className="drive-dashboard">
                <div className="drive-card total">
                  <ArrowRightLeft size={18} />
                  <span>ลง Drive วันนี้</span>
                  <strong>{driveTotalCount}</strong>
                </div>
                {dashboardSummary && (
                  <>
                    <div className="drive-card matched">
                      <CheckCircle2 size={18} />
                      <span>จับคู่แล้ว</span>
                      <strong>{dashboardSummary.matchedCount}</strong>
                    </div>
                    <div className={`drive-card ${dashboardSummary.pendingCount > 0 ? 'danger' : ''}`}>
                      <ShieldAlert size={18} />
                      <span>ตกหล่น</span>
                      <strong>{dashboardSummary.pendingCount}</strong>
                    </div>
                    <div className={`drive-card ${dashboardSummary.pendingOverOneDayCount > 0 ? 'danger' : 'muted'}`}>
                      <ShieldAlert size={18} />
                      <span>รอแพ็คเกิน 1 วัน</span>
                      <strong>{dashboardSummary.pendingOverOneDayCount}</strong>
                    </div>
                    <div className="drive-card muted">
                      <Clock3 size={18} />
                      <span>รอแพ็ค</span>
                      <strong>{dashboardSummary.tooSoonCount}</strong>
                    </div>
                  </>
                )}
              </div>

              {/* Missing Order Check */}
              <section className="missing-check-panel" aria-label="ตรวจสอบออเดอร์ตกหล่น">
                <div className="missing-check-header">
                  <div>
                    <p className="eyebrow">ตรวจสอบออเดอร์</p>
                    <h3>จับคู่ Admin ↔ Packer</h3>
                  </div>
                </div>

                <div className="missing-check-controls">
                  <label className="field-control">
                    <span>เกณฑ์เวลาแจ้งเตือน (นาที)</span>
                    <select
                      value={thresholdMinutes}
                      onChange={(e) => setThresholdMinutes(Number(e.target.value))}
                    >
                      <option value="15">15 นาที</option>
                      <option value="30">30 นาที</option>
                      <option value="60">1 ชั่วโมง</option>
                      <option value="120">2 ชั่วโมง</option>
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleCheckMissingOrders}
                    disabled={missingBusy || !isSignedIn}
                  >
                    {missingBusy ? <RefreshCw size={16} className="spin" /> : <MonitorCheck size={16} />}
                    <span>ตรวจสอบออเดอร์ตกหล่น</span>
                  </button>
                </div>

                {missingResults && (
                  <div className="missing-results">
                    <div className="missing-results-actions">
                      <button className="ghost-button" type="button" onClick={copyMissingReport}>
                        <ClipboardCopy size={14} />
                        <span>คัดลอกรายงาน</span>
                      </button>
                      <button className="ghost-button" type="button" onClick={copyCompactSummary}>
                        <ClipboardCopy size={14} />
                        <span>คัดลอกสรุป</span>
                      </button>
                    </div>

                    <div className="missing-summary">
                      ตรวจย้อนหลัง {DEFAULT_LOOKBACK_HOURS} ชม. | เกณฑ์ {thresholdMinutes} นาที
                    </div>

                    {missingUISections.map((section) => (
                      <div key={section.type} className={`missing-result-card ${section.color}`}>
                        <div className="missing-result-card-header">
                          <span>{section.label}</span>
                          <strong>{section.count} รายการ</strong>
                        </div>
                        {section.rows.length > 0 && section.rows.length <= 20 && (
                          <div className="missing-result-list">
                            {section.rows.slice(0, 10).map((row, idx) => (
                              <div key={idx} className="missing-result-item">
                                <span className="code-cell">{row.adminCode}</span>
                                <span className="missing-courier">{row.courier}</span>
                                <span className="missing-time">{row.adminTime || row.time || '--:--'}</span>
                              </div>
                            ))}
                            {section.rows.length > 10 && (
                              <div className="missing-result-more">
                                ...และอีก {section.rows.length - 10} รายการ
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {missingUISections.length === 0 && (
                      <div className="empty-search">กดตรวจสอบเพื่อเริ่มต้น</div>
                    )}
                  </div>
                )}
              </section>

              {/* Drive Recent Rows */}
              <div className="recent-header">
                <h3>รายการที่ลง Drive</h3>
                <div className="recent-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => { void recoverPendingSheetSyncs({ showStatus: true }); }}
                    disabled={driveSyncBusy || !firebaseUser || !token || !config?.master?.id}
                    title="ซิงก์รายการที่บันทึกใน Firestore แต่ยังค้าง Google Sheet"
                  >
                    {driveSyncBusy ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
                    <span>{driveSyncBusy ? 'กำลังอัปเดต...' : 'อัปเดตออเดอร์ค้างใน Sheet'}</span>
                  </button>
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
                      <th>เวลา</th>
                      <th>Admin Tracking</th>
                      <th>Packer Tracking</th>
                      <th>Status</th>
                      <th>Courier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driveRecentRows.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="empty-cell">
                          {isSignedIn ? 'ยังไม่มีรายการลง Drive ของวันนี้' : 'เข้าสู่ระบบเพื่อโหลดรายการ'}
                        </td>
                      </tr>
                    ) : (
                      driveRecentRows.slice(0, 10).map((row) => (
                        <tr key={`${row.no}-${row.adminCode}-${row.adminTime}`}>
                          <td>{row.adminTime || row.time}</td>
                          <td className="code-cell">{row.adminCode || '-'}</td>
                          <td className="code-cell">{row.code || 'รอแพ็ค'}</td>
                          <td>
                            <span className={`status-badge ${(row.status || '').toLowerCase()}`}>{row.status || 'รอแพ็ค'}</span>
                            {row.date && row.adminDate && row.date !== row.adminDate && <span className="status-badge cross-day">ข้ามวัน</span>}
                          </td>
                          <td>{row.courier}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </section>

      {/* Reports — only in packer tab */}
      {activeTab === 'packer' && (
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

            <button className="secondary-button report-button" type="button" onClick={backfillSelectedReportRange} disabled={!isSignedIn || backfillBusy}>
              {backfillBusy ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}
              <span>Import Sheet to Firestore</span>
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
            {couriers.map((courier) => {
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
                  {couriers.map((courier) => (
                    <th key={courier}>{courier}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!reportData ? (
                  <tr>
                    <td colSpan={couriers.length + 4} className="empty-cell">
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
                      {couriers.map((courier) => (
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
      )}

      {scanPopupOpen && (
        <div className="scan-popup-overlay" onClick={() => { setScanPopupOpen(false); void stopCamera(); }}>
          <div className={`scan-popup-sheet workflow-${activeTab}`} onClick={(e) => e.stopPropagation()}>
            <div className="scan-popup-handle" />

            <div className={`current-courier-badge workflow-${activeTab}`}>
              <Truck size={18} />
              <span>{activeTab === 'drive' ? 'กำลังรับเข้า Drive' : 'กำลังสแกนแพ็ก'}</span>
              <strong>{selectedCourier}</strong>
            </div>

            {activeTab === 'packer' && (
              <>
              <button
                className={`popup-cancel-btn ${scanRemark === ISSUE_CUSTOMER_CANCELLED ? 'active' : ''}`}
                type="button"
                onClick={() => setScanRemark((v) => (v === ISSUE_CUSTOMER_CANCELLED ? '' : ISSUE_CUSTOMER_CANCELLED))}
                disabled={!isSignedIn || busy}
              >
                {scanRemark === ISSUE_CUSTOMER_CANCELLED ? '✓ ลูกค้ายกเลิก' : 'ลูกค้ายกเลิก'}
              </button>
              <button
                className={`popup-cancel-btn ${scanRemark === ISSUE_RETURNED ? 'active' : ''}`}
                type="button"
                onClick={() => setScanRemark((v) => (v === ISSUE_RETURNED ? '' : ISSUE_RETURNED))}
                disabled={!isSignedIn || busy}
              >
                {scanRemark === ISSUE_RETURNED ? `✓ ${ISSUE_RETURNED}` : ISSUE_RETURNED}
              </button>
              </>
            )}

            <div className="scan-controls">
              <div className="segmented-control">
                <button className={scanMethod === 'manual' ? 'active' : ''} type="button" onClick={() => setScanMethod('manual')}>
                  <ScanLine size={15} />
                  <span>เครื่องยิง</span>
                </button>
                <button className={scanMethod === 'camera' ? 'active' : ''} type="button" onClick={() => setScanMethod('camera')}>
                  <Camera size={15} />
                  <span>กล้อง</span>
                </button>
              </div>
              <div className="segmented-control">
                <button className={scanMode === 'single' ? 'active' : ''} type="button" onClick={() => setScanMode('single')}>
                  <Square size={14} />
                  <span>ทีละชิ้น</span>
                </button>
                <button className={scanMode === 'continuous' ? 'active' : ''} type="button" onClick={() => setScanMode('continuous')}>
                  <Repeat size={14} />
                  <span>ต่อเนื่อง</span>
                </button>
              </div>
            </div>

            {activeTab === 'packer' && (
              <label className="packer-control popup-packer">
                <span>Packer — เลือกคนแพ็คก่อนสแกน</span>
                <select value={selectedPacker} onChange={(e) => setSelectedPacker(e.target.value)} disabled={!isSignedIn || busy}>
                  {PACKERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            )}

            {scanMethod === 'camera' ? (
              <div className={`camera-panel workflow-${activeTab}`}>
                <div className={`camera-stage ${cameraActive ? 'active' : ''}`}>
                  <div id={CAMERA_POPUP_ID} className="camera-reader" />
                  <div className="scan-frame" aria-hidden="true"><span /></div>
                </div>
                <div className="camera-footer">
                  <p className={`camera-message ${cameraMessageType}`}>{cameraMessage}</p>
                  <div className="camera-actions">
                    {cameraActive ? (
                      <button className="ghost-button" type="button" onClick={stopCamera}>
                        <Square size={16} /><span>หยุดกล้อง</span>
                      </button>
                    ) : (
                      <button className="secondary-button" type="button" onClick={startCameraPopup} disabled={busy || !isSignedIn}>
                        <Camera size={16} /><span>เปิดกล้อง</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <form className={`scan-form workflow-${activeTab}`} onSubmit={handleScanSubmit}>
                <div className={`scan-input-row ${scanFlash ? 'flash' : ''}`}>
                  <ScanLine size={24} />
                  <input
                    id="popup-scan-input"
                    ref={inputRef}
                    value={scanValue}
                    onChange={(e) => setScanValue(e.target.value)}
                    placeholder={
                      activeTab === 'drive'
                        ? 'ยิงบาร์โค้ด แล้วกด Enter เพื่อรับเข้า Drive'
                        : isPackerReady
                          ? 'ยิงบาร์โค้ด แล้วกด Enter'
                          : 'เลือก Packer ก่อน'
                    }
                    autoComplete="off"
                    disabled={busy || !isSignedIn || (activeTab === 'packer' && !isPackerReady)}
                  />
                  <button type="submit" disabled={busy || !isSignedIn || (activeTab === 'packer' && !isPackerReady)}>
                    {busy ? <RefreshCw size={18} className="spin" /> : <Play size={18} />}
                    <span>{activeTab === 'drive' ? 'รับเข้า Drive' : 'บันทึกแพ็ก'}</span>
                  </button>
                </div>
              </form>
            )}

            <button className="scan-popup-close" type="button" onClick={() => { setScanPopupOpen(false); void stopCamera(); }}>
              ปิด
            </button>
          </div>
        </div>
      )}
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

export default App;
