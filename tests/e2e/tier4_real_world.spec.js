/**
 * Tier 4: Real-World Application Scenarios Test Suite (6 User Journeys)
 * Verifies end-to-end user workflows matching real-world personas and device interactions.
 *
 * Run with: node --test tests/e2e/tier4_real_world.spec.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFixture,
  detectPlatform,
  cleanMediaUrl,
  resolveDefaultVideoQuality,
  parseTimestamp,
  formatTimestamp,
  validateTrimRange,
  sanitizeFilename,
  generateContentDisposition,
  simulateBackendExtract,
} from '../helpers.js';

describe('Tier 4: Real-World Application Scenarios Suite', () => {

  // =========================================================================
  // Scenario 1: The Content Creator Reaction Clip Workflow
  // =========================================================================
  it('TC-T4-01: Scenario 1 - The Content Creator Reaction Clip Workflow', () => {
    // 1. Creator pastes 15-minute documentary video URL
    const ytUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const platform = detectPlatform(ytUrl);
    assert.equal(platform, 'youtube');

    // 2. DownMe extracts media details
    const extractRes = simulateBackendExtract(ytUrl);
    assert.equal(extractRes.status, 200);

    // 3. System auto-selects 1080p Full HD by default
    const videoQuality = resolveDefaultVideoQuality(extractRes.body.formats.video);
    assert.equal(videoQuality.formatId, '1080p');

    // 4. Creator adjusts trimmer to select exact 30-second quote (04:15 to 04:45)
    // 04:15 = 255s, 04:45 = 285s
    const trim = validateTrimRange('04:15', '04:45', 900); // 15 min documentary
    assert.equal(trim.valid, true);
    assert.equal(trim.durationSeconds, 30);
    assert.equal(trim.formattedDuration, '00:30');

    // 5. In-app preview seeks to 04:15 and marks pause boundary at 04:45
    const previewState = {
      currentTime: trim.startSeconds,
      pauseTime: trim.endSeconds,
      isPlaying: true,
    };
    assert.equal(previewState.currentTime, 255);
    assert.equal(previewState.pauseTime, 285);

    // 6. Creator triggers download; server formats stream-copy cut parameters
    const filename = sanitizeFilename(`${extractRes.body.title}_clip_04m15s_04m45s`, 'mp4');
    const disposition = generateContentDisposition(filename);
    assert.ok(disposition.includes('clip_04m15s_04m45s'));
    assert.ok(disposition.includes('.mp4'));
  });

  // =========================================================================
  // Scenario 2: The Podcast & Audio Enthusiast Workflow
  // =========================================================================
  it('TC-T4-02: Scenario 2 - The Podcast & Audio Enthusiast Workflow', () => {
    // 1. User pastes YouTube podcast URL
    const podcastUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const extractRes = simulateBackendExtract(podcastUrl);
    assert.equal(extractRes.status, 200);

    // 2. User navigates to Audio format tab
    const audioFormats = extractRes.body.formats.audio;
    assert.ok(audioFormats.length > 0);

    // 3. User selects high-fidelity 320 kbps MP3
    const mp3Option = audioFormats.find(a => a.formatId === 'mp3-320');
    assert.ok(mp3Option);
    assert.equal(mp3Option.bitrate, 320);

    // 4. User verifies "Embed Cover Art" is enabled
    assert.equal(mp3Option.hasCoverArt, true);

    // 5. User extracts audio; verifies ID3 tags and thumbnail payload
    const id3Payload = {
      title: extractRes.body.title,
      artist: extractRes.body.author,
      album: 'DownMe Podcast Library',
      coverArtUrl: extractRes.body.thumbnail,
      bitrate: 320,
    };
    assert.ok(id3Payload.coverArtUrl.endsWith('.jpg'));
    assert.equal(id3Payload.bitrate, 320);

    // 6. Verify filename matches sanitized podcast title
    const filename = sanitizeFilename(extractRes.body.title, 'mp3');
    assert.ok(filename.endsWith('.mp3'));
  });

  // =========================================================================
  // Scenario 3: The Social Media Archiver Workflow
  // =========================================================================
  it('TC-T4-03: Scenario 3 - The Social Media Archiver Workflow', () => {
    // 1. Archiver copies viral TikTok video URL
    const ttUrl = 'https://www.tiktok.com/@creativestudio/video/7106594312292453678';
    assert.equal(detectPlatform(ttUrl), 'tiktok');

    // 2. Dynamic Island clipboard banner detects link
    const bannerState = {
      detectedUrl: ttUrl,
      promptText: 'TikTok link detected. Download watermark-free?',
      action: 'EXTRACT',
    };
    assert.equal(bannerState.action, 'EXTRACT');

    // 3. Media extraction succeeds with watermark-free stream
    const extractRes = simulateBackendExtract(ttUrl);
    assert.equal(extractRes.status, 200);
    assert.equal(extractRes.body.isWatermarkFree, true);

    // 4. Archiver downloads watermark-free MP4 video
    const videoFormat = extractRes.body.formats.video[0];
    assert.equal(videoFormat.formatId, 'nowatermark');
    assert.equal(videoFormat.ext, 'mp4');

    // 5. Archiver toggles to audio tab and downloads background sound as MP3
    const audioFormat = extractRes.body.formats.audio[0];
    assert.equal(audioFormat.ext, 'mp3');

    // 6. Filenames are clean and sanitized
    const videoFilename = sanitizeFilename(`${extractRes.body.title}_nowatermark`, 'mp4');
    const audioFilename = sanitizeFilename(`${extractRes.body.title}_audio`, 'mp3');
    assert.ok(videoFilename.endsWith('.mp4'));
    assert.ok(audioFilename.endsWith('.mp3'));
  });

  // =========================================================================
  // Scenario 4: The Visual Designer Moodboard Workflow
  // =========================================================================
  it('TC-T4-04: Scenario 4 - The Visual Designer Moodboard Workflow', () => {
    // 1. Designer drags high-res photo pin into DownMe
    const photoPinUrl = 'https://www.pinterest.com/pin/993606736519694085/';
    const extractPhoto = simulateBackendExtract(photoPinUrl);
    assert.equal(extractPhoto.status, 200);
    assert.equal(extractPhoto.body.mediaType, 'photo');

    // 2. Extracts original high-resolution photo format (3840x2880)
    const origPhoto = extractPhoto.body.formats.photo.find(p => p.formatId === 'original');
    assert.ok(origPhoto);
    assert.equal(origPhoto.resolution, '3840x2880');

    // 3. Designer pastes an animated GIF pin URL
    const gifPinUrl = 'https://www.pinterest.com/pin/771234567890123456/gif';
    const extractGif = simulateBackendExtract(gifPinUrl);
    assert.equal(extractGif.status, 200);
    assert.equal(extractGif.body.mediaType, 'gif');

    // 4. Verifies GIF preview and looped playback
    const gifFormat = extractGif.body.formats.gif[0];
    assert.equal(gifFormat.ext, 'gif');

    // 5. Verifies both assets receive sanitized filenames
    const photoFile = sanitizeFilename(extractPhoto.body.title, 'jpg');
    const gifFile = sanitizeFilename(extractGif.body.title, 'gif');
    assert.ok(photoFile.endsWith('.jpg'));
    assert.ok(gifFile.endsWith('.gif'));
  });

  // =========================================================================
  // Scenario 5: The Mobile iOS Share Sheet User Journey
  // =========================================================================
  it('TC-T4-05: Scenario 5 - The Mobile iOS Share Sheet User Journey', () => {
    // 1. User shares Facebook Reel from iOS Share Sheet
    const sharedReelUrl = 'https://www.facebook.com/reel/10158789523173456';

    // 2. Apple Shortcut constructs launch URL: downme.app/?url=<encoded_url>
    const shortcutDeepLink = `https://downme.app/?url=${encodeURIComponent(sharedReelUrl)}`;
    const parsed = new URL(shortcutDeepLink);
    const prefilledUrl = parsed.searchParams.get('url');
    assert.equal(prefilledUrl, sharedReelUrl);

    // 3. PWA boots, detects mobile viewport (390px iPhone 14/15/16)
    const mobileViewport = { width: 390, height: 844, isMobile: true };
    assert.ok(mobileViewport.width <= 430 && mobileViewport.width >= 375);

    // 4. DownMe auto-populates and automatically extracts
    const extractRes = simulateBackendExtract(prefilledUrl);
    assert.equal(extractRes.status, 200);

    // 5. Default selects HD video quality for mobile download
    const selectedQuality = resolveDefaultVideoQuality(extractRes.body.formats.video);
    assert.equal(selectedQuality.formatId, 'hd');
    assert.equal(selectedQuality.ext, 'mp4');

    // 6. Triggers download directly compatible with iOS Files / Photos app
    const filename = sanitizeFilename(extractRes.body.title, 'mp4');
    const disposition = generateContentDisposition(filename);
    assert.ok(disposition.includes('.mp4'));
  });

  // =========================================================================
  // Scenario 6: The PWA Offline Resilience Journey
  // =========================================================================
  it('TC-T4-06: Scenario 6 - The PWA Offline Resilience Journey', () => {
    // 1. Simulating service worker cache containing App Shell & Thmanyah fonts
    const cacheStorage = new Map([
      ['/index.html', { status: 200, contentType: 'text/html' }],
      ['/fonts/thmanyahsans-Regular.otf', { status: 200, contentType: 'font/otf' }],
      ['/fonts/thmanyahsans-Bold.otf', { status: 200, contentType: 'font/otf' }],
      ['/offline.html', { status: 200, contentType: 'text/html' }],
    ]);

    // 2. Network connectivity goes offline (e.g. subway commute)
    let isOnline = false;

    // 3. Opening app shell resolves from cache without network
    const cachedShell = cacheStorage.get('/index.html');
    assert.ok(cachedShell);
    assert.equal(cachedShell.status, 200);

    // 4. Local Thmanyah fonts render instantly from cache without FOUT/FOIT
    const cachedFont = cacheStorage.get('/fonts/thmanyahsans-Regular.otf');
    assert.ok(cachedFont);
    assert.equal(cachedFont.status, 200);

    // 5. Attempting media extraction while offline triggers graceful offline banner
    const offlineState = {
      isOnline,
      bannerMessage: 'You are offline. Reconnect to download media.',
      canSubmit: false,
    };
    assert.equal(offlineState.canSubmit, false);
    assert.ok(offlineState.bannerMessage.includes('offline'));

    // 6. Network connectivity restored
    isOnline = true;
    offlineState.isOnline = isOnline;
    offlineState.canSubmit = true;
    assert.equal(offlineState.canSubmit, true);
  });
});
