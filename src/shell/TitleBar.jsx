import React, { useEffect, useRef } from 'react';
import { FileSpreadsheet, LogIn, LogOut, Moon, MoreHorizontal, RefreshCw, ScanLine, ScanSearch, Sun, Volume2, VolumeX } from 'lucide-react';

// Global commands remain reachable from every workspace without a second menu bar.
function TitleBar({
  user,
  isSignedIn,
  isGoogleReady,
  busy,
  signInWithGoogle,
  signOut,
  sheetUrl,
  theme,
  setTheme,
  soundEnabled,
  setSoundEnabled,
  refreshAllCounts,
  checkMissingOrders,
  missingBusy,
}) {
  const toolsRef = useRef(null);
  useEffect(() => {
    const closeOutside = event => {
      if (toolsRef.current && !toolsRef.current.contains(event.target)) toolsRef.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  const closeTools = () => { if (toolsRef.current) toolsRef.current.open = false; };

  return (
    <header className="win-titlebar">
      <span className="win-app-mark" aria-hidden="true"><ScanLine size={14} /></span>
      <h1 className="win-app-name">HILLKOFF WMS</h1>

      <div className="win-titlebar-right">
        <span className={`win-conn ${isSignedIn ? 'online' : 'offline'}`}>
          <span className="win-conn-dot" aria-hidden="true" />
          {isSignedIn ? (user.email || 'เชื่อมต่อแล้ว') : 'ยังไม่ได้เข้าสู่ระบบ'}
        </span>

        {sheetUrl && (
          <a className="win-titlebar-btn" href={sheetUrl} target="_blank" rel="noreferrer">
            <FileSpreadsheet size={14} />
            <span>Master Sheet</span>
          </a>
        )}

        <button
          className="win-titlebar-btn"
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
        >
          {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
          <span>{theme === 'dark' ? 'โหมดมืด' : 'โหมดสว่าง'}</span>
        </button>

        <button
          className="win-titlebar-btn icon-only"
          type="button"
          onClick={() => setSoundEnabled((value) => !value)}
          title={soundEnabled ? 'ปิดเสียง' : 'เปิดเสียง'}
          aria-label={soundEnabled ? 'ปิดเสียง' : 'เปิดเสียง'}
        >
          {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>

        <details
          className="app-tools-menu"
          ref={toolsRef}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeTools(); }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              closeTools();
              toolsRef.current?.querySelector('summary')?.focus();
            }
          }}
        >
          <summary className="win-titlebar-btn icon-only" aria-label="เครื่องมือเพิ่มเติม" title="เครื่องมือเพิ่มเติม">
            <MoreHorizontal size={18} aria-hidden="true" />
          </summary>
          <div className="app-tools-popover">
            <button type="button" disabled={!isSignedIn} onClick={() => { closeTools(); void refreshAllCounts(); }}>
              <RefreshCw size={16} /> รีเฟรชข้อมูลวันนี้
            </button>
            <button type="button" disabled={!isSignedIn || missingBusy} onClick={() => { closeTools(); checkMissingOrders(); }}>
              <ScanSearch size={16} /> ตรวจออเดอร์ที่หาย
            </button>
          </div>
        </details>

        {isSignedIn ? (
          <button className="win-titlebar-btn" type="button" onClick={signOut}>
            <LogOut size={14} />
            <span>ออกจากระบบ</span>
          </button>
        ) : (
          <button
            className="win-titlebar-btn"
            data-testid="google-sign-in"
            type="button"
            onClick={signInWithGoogle}
            disabled={busy || !isGoogleReady}
          >
            {busy ? <RefreshCw size={14} className="spin" /> : <LogIn size={14} />}
            <span>{isGoogleReady ? 'เข้าสู่ระบบด้วย Google' : 'รอตั้งค่าการเข้าสู่ระบบ'}</span>
          </button>
        )}
      </div>
    </header>
  );
}

export default TitleBar;
