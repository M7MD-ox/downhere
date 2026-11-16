/**
 * DownMe Dynamic Island Auto-Clipboard Detection Controller
 * Milestone M3: PWA, iOS Integration & Smart UX
 *
 * Responsibilities:
 * 1. Listen to window focus and document visibilitychange events.
 * 2. Safely read system clipboard with permission check and error boundary.
 * 3. Validate clipboard content against YouTube, Facebook, TikTok, and Pinterest regexes.
 * 4. Animate the Dynamic Island floating card (#clipboard-banner) with platform branding.
 * 5. Handle one-tap Download and Dismiss actions.
 */

import { extractUrlFromText } from './share-target.js';

// Regexes for supported media platforms
export const PLATFORM_PATTERNS = {
  youtube: /(?:youtube\.com\/(?:watch|shorts|embed|v|live)|youtu\.be\/)/i,
  facebook: /(?:facebook\.com\/(?:watch|reel|videos|story|permalink|.*\/posts)|fb\.watch\/)/i,
  tiktok: /(?:tiktok\.com\/.*(?:video|photo)|vm\.tiktok\.com\/|vt\.tiktok\.com\/)/i,
  pinterest: /(?:pinterest\.[a-z.]+\/pin\/|pin\.it\/)/i,
  instagram: /(?:instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv|share)\/)/i,
  twitter: /(?:(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/\d+)/i
};

// Platform SVG Glyphs for the Dynamic Island
export const PLATFORM_ICONS = {
  youtube: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#ff0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  facebook: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#1877f2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  tiktok: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#00f2fe"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
  pinterest: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#e60023"><path d="M12 0a12 12 0 0 0-4.37 23.18c-.07-.99-.13-2.52.03-3.61l.9-3.81s-.23-.46-.23-1.14c0-1.07.62-1.87 1.39-1.87.66 0 .97.49.97 1.08 0 .66-.42 1.65-.64 2.56-.18.77.38 1.39 1.14 1.39 1.37 0 2.42-1.45 2.42-3.54 0-1.85-1.33-3.15-3.23-3.15-2.2 0-3.49 1.65-3.49 3.35 0 .66.26 1.38.58 1.77a.3.3 0 0 1 .07.29c-.08.33-.26 1.06-.3 1.2-.05.21-.17.26-.39.16-1.44-.67-2.34-2.77-2.34-4.46 0-3.63 2.64-6.97 7.61-6.97 4 0 7.11 2.85 7.11 6.66 0 3.97-2.5 7.17-5.98 7.17-1.17 0-2.27-.61-2.64-1.33l-.72 2.75c-.26 1.01-.97 2.27-1.44 3.05A12 12 0 1 0 12 0z"/></svg>`,
  instagram: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#e1306c"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`,
  twitter: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  generic: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`
};

/**
 * Detects supported media platform from URL string.
 *
 * @param {string} url - Candidate URL.
 * @returns {'youtube'|'facebook'|'tiktok'|'pinterest'|'instagram'|'twitter'|'generic'|null}
 */
export function detectPlatform(url) {
  if (!url || typeof url !== 'string') return null;

  if (PLATFORM_PATTERNS.youtube.test(url)) return 'youtube';
  if (PLATFORM_PATTERNS.facebook.test(url)) return 'facebook';
  if (PLATFORM_PATTERNS.tiktok.test(url)) return 'tiktok';
  if (PLATFORM_PATTERNS.pinterest.test(url)) return 'pinterest';
  if (PLATFORM_PATTERNS.instagram.test(url)) return 'instagram';
  if (PLATFORM_PATTERNS.twitter.test(url)) return 'twitter';

  return null;
}

/**
 * Validates clipboard text. Extracts URL and checks whether it matches a supported platform.
 *
 * @param {string} text - Raw clipboard text.
 * @returns {{ url: string, platform: string } | null}
 */
export function validateSupportedUrl(text) {
  const extractedUrl = extractUrlFromText(text);
  if (!extractedUrl) return null;

  const platform = detectPlatform(extractedUrl);
  if (!platform) return null;

  return {
    url: extractedUrl,
    platform: platform
  };
}

/**
 * Dynamic Island Clipboard Detector Component.
 */
export class ClipboardDetector {
  constructor() {
    this.banner = null;
    this.urlEl = null;
    this.iconEl = null;
    this.downloadBtn = null;
    this.dismissBtn = null;
    this.currentDetectedUrl = null;
    this.lastProcessedUrl = null;
    this.dismissedUrls = new Set();
    this.dismissTimer = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    if (typeof document === 'undefined') return;

    this.banner = document.getElementById('clipboard-banner');
    this.urlEl = document.getElementById('clipboard-url');
    this.iconEl = document.getElementById('clipboard-icon');
    this.downloadBtn = document.getElementById('clipboard-download-btn');
    this.dismissBtn = document.getElementById('clipboard-dismiss-btn');

    this._bindEvents();
    this._attachWindowListeners();

    // Initial check after page loads
    setTimeout(() => {
      this.checkClipboard();
    }, 400);
  }

  _bindEvents() {
    const activateDetectedUrl = () => {
      if (!this.currentDetectedUrl) return;
      const targetUrl = this.currentDetectedUrl;
      this.hideBanner();

      const inputEl = document.getElementById('url-input');
      if (inputEl) {
        inputEl.value = targetUrl;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (typeof window !== 'undefined' && window.downmeApp && typeof window.downmeApp.startExtraction === 'function') {
        window.downmeApp.startExtraction();
      } else {
        const extractBtn = document.getElementById('extract-btn');
        if (extractBtn) extractBtn.click();
      }
    };

    if (this.banner) {
      this.banner.style.cursor = 'pointer';
      this.banner.addEventListener('click', (e) => {
        if (this.dismissBtn && (e.target === this.dismissBtn || this.dismissBtn.contains(e.target))) {
          return;
        }
        activateDetectedUrl();
      });
    }

    if (this.downloadBtn) {
      this.downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activateDetectedUrl();
      });
    }

    if (this.dismissBtn) {
      this.dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.currentDetectedUrl) {
          this.dismissedUrls.add(this.currentDetectedUrl);
        }
        this.hideBanner();
      });
    }
  }

  _attachWindowListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('focus', () => {
      this.checkClipboard();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.checkClipboard();
      }
    });

    const inputEl = document.getElementById('url-input');
    if (inputEl) {
      inputEl.addEventListener('focus', () => this.checkClipboard());
    }
  }

  /**
   * Safely reads clipboard content and prompts banner if a valid media URL is found.
   */
  async checkClipboard() {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.readText) {
      return;
    }

    const inputEl = document.getElementById('url-input');
    const currentInput = inputEl ? inputEl.value.trim() : '';

    try {
      // Check permission state where available
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const status = await navigator.permissions.query({ name: 'clipboard-read' });
          if (status.state === 'denied') {
            return;
          }
        } catch {
          // Permissions query for clipboard-read not supported in some browsers (e.g. Firefox)
        }
      }

      const text = await navigator.clipboard.readText();
      if (!text || typeof text !== 'string') return;

      const detected = validateSupportedUrl(text);
      if (!detected) return;

      // Avoid re-prompting if already in input, dismissed, or already active
      if (currentInput && currentInput === detected.url) return;
      if (this.dismissedUrls.has(detected.url)) return;
      if (this.lastProcessedUrl === detected.url && this.banner && this.banner.classList.contains('active')) {
        return;
      }

      this.currentDetectedUrl = detected.url;
      this.lastProcessedUrl = detected.url;
      this.showBanner(detected.url, detected.platform);
    } catch {
      // Permission denied or security restrictions in inactive window
    }
  }

  /**
   * Slides down the Dynamic Island banner with spring animation.
   *
   * @param {string} url - Validated media link.
   * @param {string} platform - Platform identifier.
   */
  showBanner(url, platform) {
    if (!this.banner) {
      this.banner = document.getElementById('clipboard-banner');
      this.urlEl = document.getElementById('clipboard-url');
      this.iconEl = document.getElementById('clipboard-icon');
    }
    if (!this.banner) return;

    if (this.urlEl) {
      this.urlEl.textContent = url;
      this.urlEl.title = url;
    }

    if (this.iconEl) {
      this.iconEl.innerHTML = PLATFORM_ICONS[platform] || PLATFORM_ICONS.generic;
    }

    this.banner.classList.add('active');

    // Reset auto-dismiss timer (8 seconds)
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
    }
    this.dismissTimer = setTimeout(() => {
      this.hideBanner();
    }, 8000);
  }

  /**
   * Hides the Dynamic Island banner.
   */
  hideBanner() {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }

    if (this.banner) {
      this.banner.classList.remove('active');
    }
    this.currentDetectedUrl = null;
  }
}

export const clipboardDetector = new ClipboardDetector();

// Auto-initialize when loaded in browser
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      clipboardDetector.init();
    });
  } else {
    clipboardDetector.init();
  }
}

// Named helper functions for direct external consumption
export function initClipboardDetector() {
  clipboardDetector.init();
}

export function checkClipboard() {
  return clipboardDetector.checkClipboard();
}

export function showClipboardBanner(url, platform) {
  clipboardDetector.showBanner(url, platform || detectPlatform(url) || 'generic');
}

export function hideClipboardBanner() {
  clipboardDetector.hideBanner();
}
