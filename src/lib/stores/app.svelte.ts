// =============================================================================
// GMTW Trail Map — App Store (Svelte 5 Runes)
//
// Globaler App-State: Theme, Sprache, GPS-Emoji, Toast, i18n
// =============================================================================

import { loadTheme, saveTheme, loadLang, saveLang, loadGpsEmoji, saveGpsEmoji } from '$lib/services/storage';
import { tts } from '$lib/services/tts';
import { TRANSLATIONS, t as i18nT } from '$lib/data/translations';
import type { Lang } from '$lib/types';

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export interface Toast {
  id: number;
  msg: string;
  type: 'info' | 'success' | 'error' | 'warn';
}

let _toastCounter = 0;

// ---------------------------------------------------------------------------
// AppStore class
// ---------------------------------------------------------------------------

class AppStore {
  theme = $state<'dark' | 'light'>('dark');
  lang  = $state<Lang>('de');
  gpsEmoji = $state('🦄');
  toasts = $state<Toast[]>([]);
  settingsOpen = $state(false);
  settingsTab = $state<'profile' | 'general' | 'tracks' | 'backup' | 'markers' | 'qr' | 'app'>('general');
  pwaInstallable = $state(false);
  swUpdateAvailable = $state(false);
  featurePlacement = $state(false);

  // Derived
  isDark = $derived(this.theme === 'dark');

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  init(): void {
    if (typeof window === 'undefined') return;
    this.theme    = loadTheme();
    this.lang     = (loadLang() as Lang) ?? 'de';
    this.gpsEmoji = loadGpsEmoji();
    this._applyTheme();
    this._applyLang();
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------

  toggleTheme(): void {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    saveTheme(this.theme);
    this._applyTheme();
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme;
    saveTheme(theme);
    this._applyTheme();
  }

  private _applyTheme(): void {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = this.theme;
    const metaColor = document.getElementById('meta-theme-color');
    if (metaColor) {
      metaColor.setAttribute('content', this.theme === 'dark' ? '#0b0e14' : '#f8fafc');
    }
  }

  // ---------------------------------------------------------------------------
  // Language / i18n
  // ---------------------------------------------------------------------------

  setLang(lang: Lang): void {
    this.lang = lang;
    saveLang(lang);
    tts.setLang(lang);
    this._applyLang();
  }

  /** i18n lookup — gibt übersetzten String zurück */
  t(key: string, vars?: Record<string, string | number>): string {
    return i18nT(this.lang, key as Parameters<typeof i18nT>[1], vars);
  }

  private _applyLang(): void {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = this.lang;
    // data-i18n attributes
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n!;
      el.textContent = this.t(key);
    });
    document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => {
      el.placeholder = this.t(el.dataset.i18nPh!);
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', this.t(el.dataset.i18nAria!));
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
      el.title = this.t(el.dataset.i18nTitle!);
    });
  }

  // ---------------------------------------------------------------------------
  // GPS Emoji
  // ---------------------------------------------------------------------------

  setGpsEmoji(emoji: string): void {
    this.gpsEmoji = emoji;
    saveGpsEmoji(emoji);
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  showToast(msg: string, type: Toast['type'] = 'info', duration = 3000): void {
    const id = ++_toastCounter;
    this.toasts = [...this.toasts, { id, msg, type }];
    setTimeout(() => {
      this.dismissToast(id);
    }, duration);
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  /** Convenience alias with optional duration (ms) */
  toast(msg: string, type: Toast['type'] = 'info', duration?: number): void {
    this.showToast(msg, type, duration);
  }

  // ---------------------------------------------------------------------------
  // Settings Panel
  // ---------------------------------------------------------------------------

  openSettings(tab?: AppStore['settingsTab']): void {
    if (tab) this.settingsTab = tab;
    this.featurePlacement = false; // safety: clear any stuck placement mode
    this.settingsOpen = true;
  }

  closeSettings(): void {
    this.settingsOpen = false;
    this.featurePlacement = false; // safety: always clear on close
  }

  enterFeaturePlacement(): void {
    this.featurePlacement = true;
  }

  exitFeaturePlacement(): void {
    this.featurePlacement = false;
  }

  switchTab(tab: AppStore['settingsTab']): void {
    this.settingsTab = tab;
  }

  // ---------------------------------------------------------------------------
  // PWA / SW
  // ---------------------------------------------------------------------------

  setPwaInstallable(val: boolean): void {
    this.pwaInstallable = val;
  }

  setSwUpdateAvailable(val: boolean): void {
    this.swUpdateAvailable = val;
  }
}

export const app = new AppStore();
