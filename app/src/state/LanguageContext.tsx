/**
 * UI language (Bangla / English). The choice is persisted (localStorage on web,
 * SecureStore on native) and mirrored into the module-level active language in
 * lib/labels, which STR + the label functions read at render time.
 *
 * Reactivity model: changing the language updates this provider's state, which is
 * used to `key` the navigation subtree (see App.tsx). That remounts the screens so
 * every `STR.foo` / label-fn call re-reads the new language — while auth, basket,
 * and section state (held in providers above the key) survive untouched.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getItem, setItem } from "../lib/storage";
import { getActiveLang, setActiveLang, type Lang } from "../lib/labels";

const STORAGE_KEY = "appLang";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggle: () => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [lang, setLangState] = useState<Lang>(getActiveLang());

  // Hydrate the persisted choice on boot (default stays "bn").
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getItem(STORAGE_KEY);
      if (cancelled) return;
      if (stored === "en" || stored === "bn") {
        setActiveLang(stored);
        setLangState(stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLang = useCallback((next: Lang) => {
    setActiveLang(next); // sync the module var BEFORE the remount renders
    setLangState(next);
    void setItem(STORAGE_KEY, next);
  }, []);

  const toggle = useCallback(() => {
    setLang(getActiveLang() === "bn" ? "en" : "bn");
  }, [setLang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggle }}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
