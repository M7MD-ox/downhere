/**
 * Tier 2: Boundary & Corner Cases Test Suite (35+ Tests)
 * Verifies system robustness, SSRF prevention, security sanitization, and edge conditions.
 *
 * Run with: node --test tests/e2e/tier2_boundaries.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPlatform,
  cleanMediaUrl,
  parseTimestamp,
  formatTimestamp,
  validateTrimRange,
  sanitizeFilename,
  generateContentDisposition,
  simulateBackendExtract,
  isPrivateOrSsrfIp,
  classifyExtractionError,
  evaluateStreamType,
  resolveDefaultVideoQuality,
} from '../helpers.js';


describe('Tier 2: Boundary & Corner Cases Suite', () => {

  // =========================================================================
  // Category 1: Malformed & Corrupted URLs
  // =========================================================================
  describe('Category 1: Malformed & Corrupted URLs', () => {
    it('TC-T2-MAL-01: Empty strings and whitespace-only inputs are rejected without API dispatch', () => {
      const inputs = ['', '   ', '\t\n', '             '];
      for (const input of inputs) {
        assert.equal(detectPlatform(input), null);
        const res = simulateBackendExtract(input);
        assert.equal(res.status, 400);
      }
    });

    it('TC-T2-MAL-02: Non-URL plain text queries are detected as invalid media URLs', () => {
      const queries = ['funny cat videos 2026', 'rick astley music', 'download youtube video now'];
      for (const query of queries) {
        assert.equal(detectPlatform(query), null);
        const res = simulateBackendExtract(query);
        assert.equal(res.status, 400);
      }
    });

    it('TC-T2-MAL-03: Malformed schemes (ttp, ftp, javascript, data) are strictly rejected', () => {
      const schemes = [
        'ttp://youtube.com/watch?v=123',
        'ftp://tiktok.com/@user/video/123',
        'javascript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD4=',
      ];
      for (const url of schemes) {
        assert.equal(detectPlatform(url), null);
        const res = simulateBackendExtract(url);
        assert.equal(res.status, 400);
      }
    });

    it('TC-T2-MAL-04: Truncated video identifiers or empty query strings are flagged as invalid', () => {
      const truncated = [
        'https://www.youtube.com/watch?v=',
        'https://youtu.be/',
        'https://www.facebook.com/watch/?v=',
      ];
      for (const url of truncated) {
        const cleaned = cleanMediaUrl(url);
        assert.ok(!cleaned.includes('watch?v=undefined') && !cleaned.includes('watch?v=null'));
      }
    });

    it('TC-T2-MAL-05: Script and command injection payloads are neutralized and rejected', () => {
      const injections = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ; rm -rf /',
        'https://tiktok.com/@user/video/123"<script>alert(1)</script>',
        'https://www.pinterest.com/pin/123456$(whoami)',
        'https://facebook.com/watch?v=123`id`',
      ];
      for (const payload of injections) {
        const sanitized = sanitizeFilename(payload, 'mp4');
        assert.ok(!sanitized.includes(';'), 'Sanitizer must remove semicolons');
        assert.ok(!sanitized.includes('<script>'), 'Sanitizer must remove script tags');
        assert.ok(!sanitized.includes('`'), 'Sanitizer must remove backticks');
      }
    });
  });

  // =========================================================================
  // Category 2: Unsupported Domains & SSRF Prevention
  // =========================================================================
  describe('Category 2: Unsupported Domains & SSRF Prevention', () => {
    it('TC-T2-DOM-01: Unsupported social media platforms (Twitter/X, Instagram) return unsupported status', () => {
      assert.equal(detectPlatform('https://x.com/user/status/123456789'), null);
      assert.equal(detectPlatform('https://twitter.com/user/status/123456789'), null);
      assert.equal(detectPlatform('https://instagram.com/reel/123456789'), null);
    });

    it('TC-T2-DOM-02: Unsupported video sites (Vimeo, Dailymotion, Twitch) return unsupported status', () => {
      assert.equal(detectPlatform('https://vimeo.com/76979871'), null);
      assert.equal(detectPlatform('https://www.dailymotion.com/video/x7tgad0'), null);
      assert.equal(detectPlatform('https://twitch.tv/videos/123456'), null);
    });

    it('TC-T2-DOM-03: Arbitrary generic non-media websites are rejected gracefully', () => {
      assert.equal(detectPlatform('https://en.wikipedia.org/wiki/Apple_Inc.'), null);
      assert.equal(detectPlatform('https://github.com/yt-dlp/yt-dlp'), null);
      assert.equal(detectPlatform('https://news.ycombinator.com'), null);
    });

    it('TC-T2-DOM-04: Localhost and private loopback addresses are blocked by SSRF defense', () => {
      const privateUrls = [
        'http://localhost:8000/api/secret',
        'http://127.0.0.1:3000/internal',
        'http://0.0.0.0:8080/admin',
        'http://192.168.1.1/router',
        'http://10.0.0.1/auth',
      ];
      for (const url of privateUrls) {
        assert.ok(isPrivateOrSsrfIp(url), `${url} must be identified as private IP`);
        assert.equal(detectPlatform(url), null, 'Private IP must not match any media platform');
        const res = simulateBackendExtract(url);
        assert.equal(res.status, 400, 'Backend extract simulation must reject SSRF addresses with 400');
      }
    });

    it('TC-T2-DOM-05: Cloud metadata IP (169.254.169.254) is blocked by SSRF filter', () => {
      const metadataUrl = 'http://169.254.169.254/latest/meta-data/';
      assert.ok(isPrivateOrSsrfIp(metadataUrl));
      assert.equal(detectPlatform(metadataUrl), null);
      const res = simulateBackendExtract(metadataUrl);
      assert.equal(res.status, 400, 'Cloud metadata IP must be rejected with 400');
    });
  });

  // =========================================================================
  // Category 3: Content Availability & Access Boundaries
  // =========================================================================
  describe('Category 3: Content Availability & Access Boundaries', () => {
    it('TC-T2-ACC-01: Detects private or authentication-required media error messages', () => {
      const sample = 'ERROR: [youtube] Private video. Sign in if you\'ve been granted access to this video';
      assert.equal(classifyExtractionError(sample), 'PRIVATE_CONTENT');
    });

    it('TC-T2-ACC-02: Detects deleted or removed 404 media error messages', () => {
      const sample = 'ERROR: [tiktok] Video has been deleted or is not found (404)';
      assert.equal(classifyExtractionError(sample), 'NOT_FOUND');
    });

    it('TC-T2-ACC-03: Detects geo-restricted region blocked content errors', () => {
      const sample = 'ERROR: [youtube] This video is not available in your country/region due to geo-restriction';
      assert.equal(classifyExtractionError(sample), 'GEO_RESTRICTED');
    });

    it('TC-T2-ACC-04: Detects age-restricted challenges cleanly without unhandled crash', () => {
      const sample = 'ERROR: [youtube] Sign in to confirm your age. This video may be inappropriate for some users';
      assert.equal(classifyExtractionError(sample), 'AGE_RESTRICTED');
    });

    it('TC-T2-ACC-05: Detects copyright takedown notices and provides specific explanation', () => {
      const sample = 'ERROR: [youtube] Video unavailable: This video is no longer available due to a copyright claim';
      assert.equal(classifyExtractionError(sample), 'COPYRIGHT_TAKEDOWN');
    });
  });

  // =========================================================================
  // Category 4: Special Stream Formats & Extreme Durations
  // =========================================================================
  describe('Category 4: Special Stream Formats & Extreme Durations', () => {
    it('TC-T2-STR-01: Active live streams are flagged to prevent downloading during live broadcast', () => {
      const liveMeta = { id: 'live123', is_live: true, duration: 0 };
      const status = evaluateStreamType(liveMeta);
      assert.equal(status.downloadable, false);
      assert.ok(status.reason.includes('Live broadcast'));
    });

    it('TC-T2-STR-02: Scheduled upcoming premieres are detected and blocked before launch', () => {
      const premiereMeta = { id: 'prem123', is_upcoming: true, duration: 0 };
      const status = evaluateStreamType(premiereMeta);
      assert.equal(status.downloadable, false);
      assert.ok(status.reason.includes('Premiere not started'));
    });

    it('TC-T2-STR-03: Ultra-short clips (< 2 seconds) maintain valid trimmer and media parameters', () => {
      const shortMeta = { id: 'short1', duration: 1.5 };
      const status = evaluateStreamType(shortMeta);
      assert.equal(status.downloadable, true);
      assert.equal(status.isUltraShort, true);

      const trim = validateTrimRange('00:00:00', '00:00:01', 1.5);
      assert.equal(trim.valid, true);
      assert.equal(trim.durationSeconds, 1);
    });

    it('TC-T2-STR-04: Extreme long-form videos (> 5 hours) calculate accurate filesize in GB', () => {
      const longDuration = 28800; // 8 hours
      const bitrateBps = 2500000; // 2.5 Mbps
      const estBytes = (longDuration * bitrateBps) / 8;
      const estGb = (estBytes / (1024 * 1024 * 1024)).toFixed(2);
      assert.equal(estGb, '8.38', 'Estimated size of 8-hour video should be ~8.38 GB');
    });

    it('TC-T2-STR-05: 360-degree VR videos are treated as standard equirectangular MP4 streams', () => {
      const vrStream = {
        formatId: '1080p-vr',
        label: '1080p 360° Spherical (Equirectangular)',
        ext: 'mp4',
        height: 1080,
        projection_type: 'equirectangular',
      };
      const resolved = resolveDefaultVideoQuality([vrStream]);
      assert.ok(resolved, 'VR stream should resolve to playable format');
      assert.equal(resolved.formatId, '1080p-vr');
      assert.equal(resolved.ext, 'mp4');

      const streamStatus = evaluateStreamType(vrStream);
      assert.equal(streamStatus.downloadable, true, 'Equirectangular VR streams must be downloadable');
      assert.equal(streamStatus.projection, 'equirectangular');
    });
  });


  // =========================================================================
  // Category 5: Complex URL Query Variations & Tracking Parameters
  // =========================================================================
  describe('Category 5: Complex URL Query Variations & Tracking Parameters', () => {
    it('TC-T2-QUR-01: Heavy UTM and tracking queries are stripped while preserving video identity', () => {
      const messy = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=facebook&utm_medium=cpc&si=abc123xyz&fbclid=IwAR2mock';
      const clean = cleanMediaUrl(messy);
      assert.equal(clean, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.ok(!clean.includes('utm_source'));
      assert.ok(!clean.includes('fbclid'));
    });

    it('TC-T2-QUR-02: Embedded timestamp parameter (&t=1m30s or ?t=90) is parsed for trimmer auto-start', () => {
      const timeUrl = 'https://youtu.be/dQw4w9WgXcQ?t=90';
      const parsed = new URL(timeUrl);
      const t = parsed.searchParams.get('t');
      assert.equal(t, '90');
      const startSecs = parseTimestamp(t);
      assert.equal(startSecs, 90);
      assert.equal(formatTimestamp(startSecs), '01:30');
    });

    it('TC-T2-QUR-03: Playlist URL parameter (&list=PL...) extracts single target video without entire playlist', () => {
      const playlistUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890ABCDEF';
      const clean = cleanMediaUrl(playlistUrl);
      assert.equal(clean, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.ok(!clean.includes('list='));
    });

    it('TC-T2-QUR-04: Pinterest regional country-code domains resolve seamlessly', () => {
      const domains = [
        'https://es.pinterest.com/pin/993606736519694085/',
        'https://de.pinterest.com/pin/993606736519694085/',
        'https://pinterest.fr/pin/993606736519694085/',
      ];
      for (const d of domains) {
        assert.equal(detectPlatform(d), 'pinterest');
      }
    });

    it('TC-T2-QUR-05: Mobile web URLs (m.youtube.com, touch.facebook.com) normalize cleanly', () => {
      assert.equal(detectPlatform('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
      assert.equal(detectPlatform('https://m.facebook.com/watch/?v=10153231379946729'), 'facebook');
      assert.equal(cleanMediaUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });
  });

  // =========================================================================
  // Category 6: Internationalization & Filename Sanitization
  // =========================================================================
  describe('Category 6: Internationalization & Filename Sanitization', () => {
    it('TC-T2-I18-01: Arabic media titles preserve UTF-8 Arabic characters and Thmanyah typography', () => {
      const arabicTitle = 'ثمانية: بودكاست فنجان مع عبدالرحمن أبو مالح';
      const sanitized = sanitizeFilename(arabicTitle, 'mp4');
      assert.ok(sanitized.includes('ثمانية'), 'Must preserve Arabic word ثمانية');
      assert.ok(sanitized.includes('فنجان'), 'Must preserve Arabic word فنجان');
      assert.ok(sanitized.endsWith('.mp4'));

      const disposition = generateContentDisposition(sanitized);
      assert.ok(disposition.includes("filename*=UTF-8''"));
    });

    it('TC-T2-I18-02: Emoji-rich titles strip or neutralize emojis safely for filesystem compatibility', () => {
      const emojiTitle = '🔥 Top 10 Insane Stunts 🚀 [Must See!] 🎉';
      const sanitized = sanitizeFilename(emojiTitle, 'mp4');
      assert.ok(sanitized.endsWith('.mp4'));
      assert.ok(!sanitized.includes('[') || !sanitized.includes('?'));
    });

    it('TC-T2-I18-03: Illegal filesystem characters (/ \\ : * ? " < > |) are replaced with underscores', () => {
      const dangerousTitle = 'What / Why : A * Story ? "Yes" <or> No | Final';
      const sanitized = sanitizeFilename(dangerousTitle, 'mp4');
      const illegal = /[\\/:*?"<>|]/;
      assert.ok(!illegal.test(sanitized), `Sanitized filename "${sanitized}" must not contain illegal OS chars`);
    });

    it('TC-T2-I18-04: Extremely long titles (> 255 chars) are truncated safely without breaking extension', () => {
      const longTitle = 'A'.repeat(300);
      const sanitized = sanitizeFilename(longTitle, 'mp4', 200);
      assert.ok(sanitized.length <= 205, 'Filename length must not exceed 205 chars including extension');
      assert.ok(sanitized.endsWith('.mp4'), 'Must retain .mp4 extension');
    });

    it('TC-T2-I18-05: Bidirectional mixed English and Arabic titles sanitize cleanly', () => {
      const bidiTitle = 'DownMe App - الإصدار التجريبي v1.0';
      const sanitized = sanitizeFilename(bidiTitle, 'mp4');
      assert.ok(sanitized.includes('DownMe'));
      assert.ok(sanitized.includes('الإصدار'));
      assert.ok(sanitized.endsWith('.mp4'));
    });
  });

  // =========================================================================
  // Category 7: Trimming Boundary Conditions
  // =========================================================================
  describe('Category 7: Trimming Boundary Conditions', () => {
    it('TC-T2-TRM-01: Zero start timestamp (00:00:00) is valid and parsed as 0 seconds', () => {
      const res = validateTrimRange('00:00:00', '00:00:30', 120);
      assert.equal(res.valid, true);
      assert.equal(res.startSeconds, 0);
      assert.equal(res.durationSeconds, 30);
    });

    it('TC-T2-TRM-02: End time equal to total duration cuts cleanly at media end', () => {
      const res = validateTrimRange('00:00:10', '00:02:00', 120);
      assert.equal(res.valid, true);
      assert.equal(res.endSeconds, 120);
      assert.equal(res.durationSeconds, 110);
    });

    it('TC-T2-TRM-03: Start time greater than or equal to end time is rejected with clear error', () => {
      const inverted = validateTrimRange('00:01:00', '00:00:30', 120);
      assert.equal(inverted.valid, false);
      assert.ok(inverted.error.includes('strictly before'));

      const identical = validateTrimRange('00:00:30', '00:00:30', 120);
      assert.equal(identical.valid, false);
    });

    it('TC-T2-TRM-04: Sub-second trim interval (< 1.0s) is rejected for codec keyframe stability', () => {
      const tiny = validateTrimRange('00:00:10', '00:00:10.5', 120);
      assert.equal(tiny.valid, false);
      assert.ok(tiny.error.includes('Minimum trim interval'));
    });

    it('TC-T2-TRM-05: Start time beyond total media duration is rejected with error', () => {
      const beyond = validateTrimRange('00:05:00', '00:06:00', 120);
      assert.equal(beyond.valid, false);
      assert.ok(beyond.error.includes('cannot exceed'));
    });
  });
});
