/// <reference types="vite/client" />
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { isNative } from './api';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD && !isNative() && 'serviceWorker' in navigator) {
  const registerLocalShell = () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // A first visit without the app shell cannot be cached; match data remains on this device.
    });
  };
  window.addEventListener('ichihime:local-mode', registerLocalShell);
  if (localStorage.getItem('ichihime.local-mode') === '1') {
    if (document.readyState === 'complete') registerLocalShell();
    else window.addEventListener('load', registerLocalShell, { once: true });
  }
}
