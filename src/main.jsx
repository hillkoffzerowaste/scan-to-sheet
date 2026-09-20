import React from 'react';
import { createRoot } from 'react-dom/client';
// Bundled rather than loaded from a CDN: this is an offline-capable PWA used on the
// warehouse floor, so the brand font has to survive having no network. Latin + Thai
// subsets at the weights the UI actually uses.
// 700/800 are loaded because the design system sets headings, metric figures and every
// action button at those weights. Without the real faces the browser synthesises bold by
// smearing the 600 outlines, which on Thai glyphs closes the loops in ค ด ต and thickens
// the vowel marks into the line above.
import '@fontsource/kanit/400.css';
import '@fontsource/kanit/500.css';
import '@fontsource/kanit/600.css';
import '@fontsource/kanit/700.css';
import '@fontsource/kanit/800.css';
import '@fontsource/kanit/thai-400.css';
import '@fontsource/kanit/thai-500.css';
import '@fontsource/kanit/thai-600.css';
import '@fontsource/kanit/thai-700.css';
import '@fontsource/kanit/thai-800.css';
import App from './App.jsx';
import './styles.css';
import { getCanonicalAppRedirect } from './services/canonicalApp.js';
import { isRemoteRoute } from './services/remoteRoute.js';

const PRIMARY_APP_URL = import.meta.env.VITE_PRIMARY_APP_URL || 'https://scan-to-sheet--hillkoff-twin-oganization.asia-southeast1.hosted.app';
const canonicalRedirect = getCanonicalAppRedirect(window.location, PRIMARY_APP_URL);

if (canonicalRedirect) {
  window.location.replace(canonicalRedirect);
} else if (isRemoteRoute(window.location)) {
  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (manifestLink) manifestLink.setAttribute('href', '/remote.webmanifest');

  if ('serviceWorker' in navigator) {
    // scope แคบไว้ที่ /remote เท่านั้น เพื่อไม่ให้ worker ตัวนี้ไปคุมหน้าแอปบนเครื่องที่สแกน
    navigator.serviceWorker.register('/remote-sw.js', { scope: '/remote' }).catch(() => {});
  }

  // โหลดแยก bundle: เครื่องที่สแกนไม่ต้องดาวน์โหลดหน้ารีโมท และหน้ารีโมทไม่ลาก CSS ของ shell
  // เดสก์ท็อปมาด้วย (ตัวแปร --remote-touch ประกาศใน scope .remote-app ไม่ใช่ :root)
  import('./remote/RemoteApp.jsx').then(({ default: RemoteApp }) => {
    createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <RemoteApp />
      </React.StrictMode>,
    );
  });
} else {
  if ('serviceWorker' in navigator) {
    // Registrations are cleared here because an earlier cache-first worker served a stale bundle
    // to the scanning desktop without any sign (e1b980b). The remote screen has its own
    // network-first worker, so its scope must survive someone opening the desktop app.
    navigator.serviceWorker.getRegistrations?.()
      .then((registrations) => Promise.all(registrations
        .filter((registration) => !/\/remote\/?$/.test(registration.scope))
        .map((registration) => registration.unregister())))
      .catch(() => {});
  }

  if ('caches' in window) {
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('scan-to-sheet-')).map((key) => caches.delete(key))))
      .catch(() => {});
  }

  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
