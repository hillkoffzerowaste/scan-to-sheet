import React from 'react';
import { FileSpreadsheet, LogIn, LogOut, Moon, RefreshCw, ScanLine, Sun, Volume2, VolumeX } from 'lucide-react';

// แถบหัวโปรแกรมแบบ Windows: ชื่อระบบซ้าย สถานะและ control ขวา สูงคงที่ ไม่มีคำโปรย
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
}) {
  return (
    <div className="win-titlebar">
      <span className="win-app-mark" aria-hidden="true"><ScanLine size={14} /></span>
      <h1 className="win-app-name">HILLKOFF — Scan to Sheet</h1>

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

        {isSignedIn ? (
          <button className="win-titlebar-btn" type="button" onClick={signOut}>
            <LogOut size={14} />
            <span>ออกจากระบบ</span>
          </button>
        ) : (
          <button
            className="win-titlebar-btn"
            type="button"
            onClick={signInWithGoogle}
            disabled={busy || !isGoogleReady}
          >
            {busy ? <RefreshCw size={14} className="spin" /> : <LogIn size={14} />}
            <span>{isGoogleReady ? 'Login with Google' : 'รอใส่ OAuth Client ID'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default TitleBar;
