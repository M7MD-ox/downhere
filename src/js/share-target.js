/**
 * DownMe Deep Link & Web Share Target API Consumer
 * Milestone M3: PWA, iOS Integration & Smart UX
 *
 * Responsibilities:
 * 1. Inspect URL search parameters on boot (?url=..., ?text=..., ?link=..., ?u=..., ?title=...).
 * 2. Extract valid HTTP/HTTPS media URLs even from messy multi-line or decorated shared text.
 * 3. Populate #url-input and dispatch reactive input events.
 * 4. Clean the browser address bar via window.history.replaceState.
 * 5. Automatically initiate media extraction.
 */

/**
 * Robust regex to match URLs within raw text.
 * Handles http://, https://, query parameters, path segments, and avoids capturing trailing punctuation.
 */
const URL_REGEX = /https?:\/\/[^\s"'<>()]+(?:\([^\s"'<>()]+\)|[^\s`!@#$%^&*()=+\[\]{};:'",.<>?])/gi;

/**
 * Extracts the first valid HTTP/HTTPS URL from a potentially messy text string.
 * Strips surrounding whitespace, quotes, parentheses, and trailing punctuation.
 *
 * @param {string} text - Raw input string (e.g. from ?text= or ?url=).
 * @returns {string|null} The cleaned URL, or null if no valid URL is found.
 */
export function extractUrlFromText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  // If the string is already a direct URL
  try {
    const directUrl = new URL(trimmed);
    if (directUrl.protocol === 'http:' || directUrl.protocol === 'https:') {
      return directUrl.href;
    }
  } catch {
    // Not a pure single URL, search inside text
  }

  const matches = trimmed.match(URL_REGEX);
  if (!matches || matches.length === 0) {
    return null;
  }

  let matchedUrl = matches[0].trim();

  // Clean trailing punctuation commonly appended in shared chat messages (. , ! ? ; :)
  matchedUrl = matchedUrl.replace(/[.,!?:;]+$/, '');

  // Strip closing parenthesis if no opening parenthesis is present in the URL
  if (matchedUrl.endsWith(')') && !matchedUrl.includes('(')) {
    matchedUrl = matchedUrl.slice(0, -1);
  }

  try {
    const parsed = new URL(matchedUrl);
    return parsed.href;
  } catch {
    return matchedUrl;
  }
}

/**
 * Parses URL search parameters for incoming share target data.
 * Checks 'url', 'text', 'link', 'u', and 'title' in priority order.
 *
 * @param {string|URLSearchParams} [search] - Optional query string or URLSearchParams.
 * @returns {string|null} Clean extracted media URL or null.
 */
export function parseShareTargetParams(search) {
  let params;
  if (search instanceof URLSearchParams) {
    params = search;
  } else if (typeof search === 'string') {
    params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  } else if (typeof window !== 'undefined' && window.location) {
    params = new URLSearchParams(window.location.search);
  } else {
    return null;
  }

  // Priority search across standard Web Share Target and deep link parameter keys
  const candidates = [
    params.get('url'),
    params.get('text'),
    params.get('link'),
    params.get('u'),
    params.get('title')
  ];

  for (const candidate of candidates) {
    if (candidate) {
      const extracted = extractUrlFromText(candidate);
      if (extracted) {
        return extracted;
      }
    }
  }

  return null;
}

/**
 * Cleans query parameters from the browser address bar without reloading the page.
 */
export function cleanBrowserAddressBar() {
  if (typeof window === 'undefined' || !window.history || !window.location) {
    return;
  }

  try {
    const cleanPath = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanPath);
  } catch (err) {
    console.warn('[ShareTarget] Unable to clean address bar:', err);
  }
}

/**
 * Triggers media extraction in the application shell.
 * Coordinates with window.downmeApp or clicks #extract-btn.
 *
 * @param {string} url - Validated media URL.
 */
export function triggerAutoExtraction(url) {
  if (typeof document === 'undefined') return;

  const inputEl = document.getElementById('url-input');
  if (inputEl) {
    inputEl.value = url;
    // Dispatch input & change events so controllers detect platform and update UI
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // If DownMeApp instance is available on window, call startExtraction directly
  if (typeof window !== 'undefined' && window.downmeApp && typeof window.downmeApp.startExtraction === 'function') {
    window.downmeApp.startExtraction();
    return;
  }

  // Fallback: trigger click on the Extract button
  const extractBtn = document.getElementById('extract-btn');
  if (extractBtn) {
    setTimeout(() => {
      extractBtn.click();
    }, 50);
  }
}

/**
 * Applies the incoming share target flow:
 * 1. Checks query parameters
 * 2. Populates input
 * 3. Cleans address bar
 * 4. Triggers extraction
 *
 * @param {string} [searchString] - Optional search query string override
 * @returns {boolean} True if a shared URL was detected and handled, false otherwise.
 */
export function applyShareTarget(searchString) {
  const targetUrl = parseShareTargetParams(searchString);
  if (!targetUrl) {
    return false;
  }

  cleanBrowserAddressBar();
  triggerAutoExtraction(targetUrl);
  return true;
}

/**
 * Main Share Target Handler class.
 */
export class ShareTargetHandler {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Check on startup
    if (typeof window !== 'undefined') {
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', () => {
          applyShareTarget();
        });
      } else {
        // Run immediately or after microtask to ensure DOM elements are bound
        setTimeout(() => {
          applyShareTarget();
        }, 0);
      }
    }
  }
}

export const shareTargetHandler = new ShareTargetHandler();

// Auto-initialize when loaded in browser
if (typeof window !== 'undefined') {
  shareTargetHandler.init();
}
