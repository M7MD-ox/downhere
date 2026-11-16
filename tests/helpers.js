/**
 * DownMe Test Engine Helpers & Contract Verifiers
 * Shared utilities for 4-Tier E2E Test Suite
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load Fixtures
export function loadFixture(name) {
  const filePath = join(__dirname, 'fixtures', `${name}.json`);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Platform Detection & URL Canonicalization
 */
export function detectPlatform(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const url = rawUrl.trim();

  // YouTube
  if (/^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?.*v=|shorts\/|v\/)|youtu\.be\/)/i.test(url)) {
    return 'youtube';
  }
  // Facebook
  if (/^(https?:\/\/)?(www\.|m\.|web\.)?(facebook\.com\/(watch\/?\?|.*\/videos\/|reel\/)|fb\.watch\/)/i.test(url)) {
    return 'facebook';
  }
  // TikTok
  if (/^(https?:\/\/)?(www\.|m\.|vm\.)?(tiktok\.com\/(.*\/video\/|.*\/photo\/|@)?|vm\.tiktok\.com\/)/i.test(url)) {
    return 'tiktok';
  }
  // Pinterest
  if (/^(https?:\/\/)?([a-z]{2,3}\.|www\.)?(pinterest\.(com|[a-z]{2,3}(\.[a-z]{2})?)\/pin\/|pin\.it\/)/i.test(url)) {
    return 'pinterest';
  }

  return null;
}

/**
 * Extract canonical media ID or clean URL without tracking params
 */
export function cleanMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.trim());
    const platform = detectPlatform(rawUrl);

    if (platform === 'youtube') {
      if (parsed.hostname.includes('youtu.be')) {
        const id = parsed.pathname.slice(1).split('/')[0];
        const t = parsed.searchParams.get('t');
        return t ? `https://www.youtube.com/watch?v=${id}&t=${t}` : `https://www.youtube.com/watch?v=${id}`;
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.split('/shorts/')[1].split('/')[0];
        return `https://www.youtube.com/shorts/${id}`;
      }
      const v = parsed.searchParams.get('v');
      const t = parsed.searchParams.get('t');
      if (v) {
        return t ? `https://www.youtube.com/watch?v=${v}&t=${t}` : `https://www.youtube.com/watch?v=${v}`;
      }
    }

    if (platform === 'tiktok') {
      // Strip tracking params like ?_r=1&_t=8...
      return `${parsed.origin}${parsed.pathname}`;
    }

    if (platform === 'pinterest') {
      return `${parsed.origin}${parsed.pathname}`;
    }

    if (platform === 'facebook') {
      const v = parsed.searchParams.get('v');
      if (v) return `https://www.facebook.com/watch/?v=${v}`;
      return `${parsed.origin}${parsed.pathname}`;
    }

    return parsed.href;
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Default Quality Resolution Engine (Feature 8)
 * Defaults to highest available up to 1080p; caps 4K at 1080p unless user explicitly chose.
 */
export function resolveDefaultVideoQuality(formats, userOverride = null) {
  if (!formats || !Array.isArray(formats) || formats.length === 0) {
    return null;
  }

  if (userOverride) {
    const matched = formats.find(f => f.formatId === userOverride || f.height === parseInt(userOverride, 10));
    if (matched) return matched;
  }

  // Filter video streams with height
  const videoStreams = formats
    .filter(f => f.height && typeof f.height === 'number')
    .sort((a, b) => b.height - a.height);

  if (videoStreams.length === 0) return formats[0];

  // Highest quality <= 1080p
  const streamUpTo1080 = videoStreams.find(f => f.height <= 1080);
  if (streamUpTo1080) return streamUpTo1080;

  // If only 4K/higher available, cap at lowest available high-res
  return videoStreams[videoStreams.length - 1];
}

/**
 * Trimmer Timestamp & Slicing Calculator (Feature 10 & Category 7)
 */
export function parseTimestamp(str) {
  if (typeof str === 'number') return Math.max(0, str);
  if (!str || typeof str !== 'string') return 0;

  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

export function formatTimestamp(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const pad = n => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function validateTrimRange(startInput, endInput, totalDuration) {
  const start = parseTimestamp(startInput);
  const end = parseTimestamp(endInput);

  if (start < 0) return { valid: false, error: 'Start time cannot be negative' };
  if (totalDuration > 0 && start >= totalDuration) {
    return { valid: false, error: 'Start time cannot exceed media duration' };
  }
  if (start >= end) {
    return { valid: false, error: 'Start time must be strictly before end time' };
  }
  if (totalDuration > 0 && end > totalDuration + 0.5) {
    return { valid: false, error: 'End time cannot exceed media duration' };
  }
  if (end - start < 1.0) {
    return { valid: false, error: 'Minimum trim interval is 1.0 second' };
  }

  return {
    valid: true,
    startSeconds: start,
    endSeconds: end,
    durationSeconds: end - start,
    formattedDuration: formatTimestamp(end - start),
  };
}

/**
 * Filename Sanitization & RFC 5987 Encoding (Category 6)
 */
export function sanitizeFilename(rawTitle, extension = 'mp4', maxLength = 200) {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return `media_${Date.now()}.${extension}`;
  }

  // Preserve Arabic and standard unicode, replace illegal filesystem chars (\ / : * ? " < > | ; ` $)
  let clean = rawTitle
    .replace(/[\\/:*?"<>|;`$]/g, '_')
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .trim();

  // Strip excessive spaces or underscores
  clean = clean.replace(/\s+/g, ' ').replace(/_+/g, '_');

  // Enforce byte/char length
  if (clean.length > maxLength) {
    clean = clean.slice(0, maxLength).trim();
  }

  if (!clean) clean = 'media_download';
  return `${clean}.${extension.replace(/^\./, '')}`;
}

export function generateContentDisposition(filename) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
  const encodedUtf8 = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}

/**
 * SSRF & Private IP Address Detection Utility
 */
export function isPrivateOrSsrfIp(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr.trim());
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return true;
    if (host === '169.254.169.254') return true;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true;
    if (/^fc00:|^fe80:/i.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Classify raw extraction errors into user-facing status types
 */
export function classifyExtractionError(rawError) {
  if (!rawError || typeof rawError !== 'string') return 'UNKNOWN_ERROR';
  const err = rawError.toLowerCase();
  if (/age|confirm your age|inappropriate/i.test(err)) return 'AGE_RESTRICTED';
  if (/private|login|sign in|account/i.test(err)) return 'PRIVATE_CONTENT';
  if (/not found|404|deleted|removed/i.test(err)) return 'NOT_FOUND';
  if (/geo|blocked in your country|region/i.test(err)) return 'GEO_RESTRICTED';
  if (/copyright|dmca|takedown/i.test(err)) return 'COPYRIGHT_TAKEDOWN';
  return 'UNKNOWN_ERROR';
}

/**
 * Evaluate stream type, projection, and extreme duration characteristics
 */
export function evaluateStreamType(meta) {
  if (!meta || typeof meta !== 'object') {
    return { downloadable: false, reason: 'Invalid media metadata' };
  }
  if (meta.is_live) return { downloadable: false, reason: 'Live broadcast in progress' };
  if (meta.is_upcoming) return { downloadable: false, reason: 'Premiere not started' };
  const result = { downloadable: true };
  if (meta.projection_type) {
    result.projection = meta.projection_type;
  }
  if (meta.duration && meta.duration > 18000) {
    result.isExtremeDuration = true;
  }
  if (meta.duration && meta.duration < 2) {
    result.isUltraShort = true;
  }
  return result;
}

/**
 * Mock Backend Dispatcher for API Contract Simulation
 */
export function simulateBackendExtract(url) {
  if (isPrivateOrSsrfIp(url)) {
    return {
      status: 400,
      body: { success: false, error: 'SSRF blocked: Private or loopback IP address' },
    };
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return {
      status: 400,
      body: { success: false, error: 'Unsupported media URL or platform' },
    };
  }

  if (platform === 'youtube') {
    const fixture = loadFixture('youtube_fixture');
    return { status: 200, body: { success: true, ...fixture } };
  }

  if (platform === 'facebook') {
    const fixture = loadFixture('facebook_fixture');
    return { status: 200, body: { success: true, ...fixture } };
  }

  if (platform === 'tiktok') {
    const fixture = loadFixture('tiktok_fixture');
    const isAlbum = url.includes('/photo/');
    const data = isAlbum ? fixture.albumPost : fixture.videoPost;
    return { status: 200, body: { success: true, ...data } };
  }

  if (platform === 'pinterest') {
    const fixture = loadFixture('pinterest_fixture');
    if (url.includes('video')) return { status: 200, body: { success: true, ...fixture.videoPin } };
    if (url.includes('gif')) return { status: 200, body: { success: true, ...fixture.gifPin } };
    return { status: 200, body: { success: true, ...fixture.photoPin } };
  }

  return { status: 404, body: { success: false, error: 'Not found' } };
}

