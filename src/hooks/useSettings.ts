import { useState, useCallback, useMemo } from "react";

export type Locale = "en" | "ko";
export type WordWrap = "word" | "char";
export type ParagraphSpacing = 0 | 10 | 20 | 30 | 40 | 50;

export interface Settings {
  locale: Locale;
  wordWrap: WordWrap;
  paragraphSpacing: ParagraphSpacing;
  keepFormatOnPaste: boolean;
  spellcheck: boolean;
}

const STORAGE_KEY = "markdown-studio-settings";

const DEFAULTS: Settings = {
  locale: "ko",
  wordWrap: "word",
  paragraphSpacing: 0,
  keepFormatOnPaste: true,
  spellcheck: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function persist(s: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function useSettings() {
  const [settings, setSettingsRaw] = useState<Settings>(load);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettingsRaw((prev) => {
      const next = { ...prev, [key]: value };
      persist(next);
      return next;
    });
  }, []);

  return useMemo(() => ({ settings, update }), [settings, update]);
}
