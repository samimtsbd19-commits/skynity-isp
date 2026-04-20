// ============================================================
// Minimal i18n for the admin dashboard + public portal.
//
// Usage:
//   const t = useT();
//   <h1>{t('nav.overview')}</h1>
//
// Languages come from /portal/flags (public) and /settings (admin)
// — but we ship the full catalog in-bundle so there's never a
// network round-trip before the UI can render.
// ============================================================
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import React from 'react';
import bn from './bn.json';
import en from './en.json';

const CATALOG = { bn, en };
const STORAGE_KEY = 'skynity.lang';

const LangContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || detectBrowserLang();
    } catch {
      return 'bn';
    }
  });

  // Persist + sync <html lang="…"> so screen readers get it right.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    try { document.documentElement.lang = lang; } catch { /* ignore */ }
  }, [lang]);

  const t = useCallback((key, vars) => {
    const cat = CATALOG[lang] || CATALOG.en;
    const s = cat[key] ?? CATALOG.en[key] ?? key;
    if (!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  }, [lang]);

  const value = { lang, setLang, t, available: Object.keys(CATALOG) };
  return React.createElement(LangContext.Provider, { value }, children);
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside <LanguageProvider>');
  return ctx;
}

export function useT() {
  return useLang().t;
}

function detectBrowserLang() {
  try {
    const raw = (navigator.language || navigator.userLanguage || 'bn').toLowerCase();
    if (raw.startsWith('bn')) return 'bn';
    if (raw.startsWith('en')) return 'en';
  } catch { /* ignore */ }
  return 'bn';
}

export const LANG_LABELS = {
  bn: 'বাংলা',
  en: 'English',
};
