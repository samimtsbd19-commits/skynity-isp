import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LanguageProvider } from './i18n';
import { ToastProvider } from './components/Toast';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LanguageProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </LanguageProvider>
  </React.StrictMode>
);

// Register the portal service worker (production only — avoids
// stale-bundle headaches during `vite dev`).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
