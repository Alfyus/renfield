import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import de from './locales/de.json';
import en from './locales/en.json';
import it from './locales/it.json';
import dePro from './locales/de.pro.json';
import enPro from './locales/en.pro.json';
import itPro from './locales/it.pro.json';

/**
 * Recursively merge two plain-object trees.
 */
function deepMerge<T extends Record<string, unknown>>(base: T, overlay: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const baseVal = out[key];
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal)
    ) {
      out[key] = deepMerge(baseVal as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

const edition = (import.meta.env.VITE_APP_EDITION || 'community') as 'community' | 'pro';
const deResources = edition === 'pro' ? deepMerge(de, dePro as Record<string, unknown>) : de;
const enResources = edition === 'pro' ? deepMerge(en, enPro as Record<string, unknown>) : en;
const itResources = edition === 'pro' ? deepMerge(it, itPro as Record<string, unknown>) : it;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: deResources },
      en: { translation: enResources },
      it: { translation: itResources }
    },
    fallbackLng: 'en',
    supportedLngs: ['de', 'en', 'it'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'renfield_language'
    },
    interpolation: {
      escapeValue: false,
      defaultVariables: {
        appName: import.meta.env.VITE_APP_NAME || 'Renfield',
      },
    }
  });

export default i18n;
