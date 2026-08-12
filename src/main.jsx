import React from 'react';
import { createRoot } from 'react-dom/client';
// Bundled rather than loaded from a CDN: this is an offline-capable PWA used on the
// warehouse floor, so the brand font has to survive having no network. Latin + Thai
// subsets at the three weights the UI actually uses.
import '@fontsource/kanit/400.css';
import '@fontsource/kanit/500.css';
import '@fontsource/kanit/600.css';
import '@fontsource/kanit/thai-400.css';
import '@fontsource/kanit/thai-500.css';
import '@fontsource/kanit/thai-600.css';
import App from './App.jsx';
import './styles.css';
import { getCanonicalAppRedirect } from './services/canonicalApp.js';

const PRIMARY_APP_URL = import.meta.env.VITE_PRIMARY_APP_URL || 'https://scan-to-sheet-ten.vercel.app';
const canonicalRedirect = getCanonicalAppRedirect(window.location, PRIMARY_APP_URL);

if (canonicalRedirect) {
  window.location.replace(canonicalRedirect);
} else {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations?.()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
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
