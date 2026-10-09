import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_LOCAL_SETTINGS,
  type LocalSettings,
  type LocalSettingValue,
  type Preferences,
} from './types';

function isLocalSettings(value: unknown): value is LocalSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (item) =>
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean',
    )
  );
}

export function usePersistentUiSettings() {
  const [settings, setSettings] = useState<LocalSettings>(DEFAULT_LOCAL_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('signal_ui_settings');
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (isLocalSettings(parsed)) {
          setSettings({ ...DEFAULT_LOCAL_SETTINGS, ...parsed });
        } else {
          localStorage.removeItem('signal_ui_settings');
        }
      } catch {
        localStorage.removeItem('signal_ui_settings');
      }
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) {
      localStorage.setItem('signal_ui_settings', JSON.stringify(settings));
    }
  }, [ready, settings]);

  const updateSetting = useCallback((key: string, value: LocalSettingValue) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  return [settings, updateSetting] as const;
}

export function useApplicationTheme(theme: Preferences['theme']) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const useDark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = useDark ? 'dark' : 'light';
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [theme]);
}
