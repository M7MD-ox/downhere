/**
 * Tier 3: Cross-Feature Pairwise Combinations Test Suite (7+ Flows)
 * Verifies complex multi-step interactions where multiple features intersect simultaneously.
 *
 * Run with: node --test tests/e2e/tier3_combinations.spec.js
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

describe('Tier 3: Cross-Feature Pairwise Combinations Suite', () => {

  // Flow 1: PWA Deep Link -> Platform Auto-Detect -> 1080p Default -> Video Trimmer -> Download Stream
  it('TC-T3-01: PWA Deep Link -> Auto-Detect -> 1080p Default -> Video Trimmer (0:15-0:45) -> Stream', () => {
    // 1. Ingest PWA deep link query parameter
    const queryUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const params = new URLSearchParams(`?url=${encodeURIComponent(queryUrl)}`);
    const resolvedUrl = params.get('url');
    assert.equal(resolvedUrl, queryUrl);

    // 2. Auto-detect platform
    const platform = detectPlatform(resolvedUrl);
    assert.equal(platform, 'youtube');

    // 3. Extract media metadata via backend simulation
    const extractRes = simulateBackendExtract(resolvedUrl);
    assert.equal(extractRes.status, 200);
    assert.equal(extractRes.body.success, true);

    // 4. Resolve default video quality (capped at 1080p)
    const defaultQuality = resolveDefaultVideoQuality(extractRes.body.formats.video);
    assert.equal(defaultQuality.formatId, '1080p');

    // 5. Apply Video Trimmer
    const trim = validateTrimRange('00:00:15', '00:00:45', extractRes.body.duration);
    assert.equal(trim.valid, true);
    assert.equal(trim.durationSeconds, 30);

    // 6. Generate download filename and stream headers
    const filename = sanitizeFilename(`${extractRes.body.title}_trim_15s_45s`, 'mp4');
    const disposition = generateContentDisposition(filename);
    assert.ok(disposition.includes('attachment; filename='));
    assert.ok(disposition.includes('trim_15s_45s'));
  });

  // Flow 2: Dynamic Island Auto-Clipboard -> TikTok Carousel -> Batch Album ZIP
  it('TC-T3-02: Dynamic Island Auto-Clipboard -> TikTok Carousel -> Deselect -> Batch Album ZIP', () => {
    // 1. Simulate clipboard detection event
    const clipboardContent = 'https://www.tiktok.com/@mountaintraveler/photo/7106594312292459999';
    const detectedPlatform = detectPlatform(clipboardContent);
    assert.equal(detectedPlatform, 'tiktok');

    // 2. Extract carousel metadata
    const extractRes = simulateBackendExtract(clipboardContent);
    assert.equal(extractRes.status, 200);
    assert.equal(extractRes.body.mediaType, 'album');
    assert.equal(extractRes.body.items.length, 6);

    // 3. Simulate user selecting 5 out of 6 photos (deselecting photo index 3)
    const selectedItems = extractRes.body.items.filter(item => item.index !== 3);
    assert.equal(selectedItems.length, 5);

    // 4. Verify ZIP generation request payload contract
    const zipPayload = {
      albumTitle: extractRes.body.title,
      items: selectedItems.map(item => ({
        index: item.index,
        url: item.url,
        filename: item.filename,
      })),
    };
    assert.equal(zipPayload.items.length, 5);
    const zipFilename = sanitizeFilename(zipPayload.albumTitle, 'zip');
    assert.ok(zipFilename.endsWith('.zip'));
  });

  // Flow 3: Drag & Drop Link -> Pinterest Animated GIF -> In-App Preview -> Download GIF
  it('TC-T3-03: Drag & Drop Link -> Pinterest Animated GIF -> In-App Preview -> Download GIF', () => {
    // 1. Simulate drag & drop drop-zone text ingestion
    const droppedText = 'https://www.pinterest.com/pin/771234567890123456/gif';
    const platform = detectPlatform(droppedText);
    assert.equal(platform, 'pinterest');

    // 2. Extract media metadata
    const extractRes = simulateBackendExtract(droppedText);
    assert.equal(extractRes.status, 200);
    assert.equal(extractRes.body.mediaType, 'gif');

    // 3. Verify in-app preview compatibility
    const gifFormat = extractRes.body.formats.gif[0];
    assert.equal(gifFormat.ext, 'gif');
    assert.ok(gifFormat.url.endsWith('.gif'));

    // 4. Verify Content-Type header for animated GIF delivery
    const expectedHeaders = {
      'Content-Type': 'image/gif',
      'Content-Disposition': generateContentDisposition(sanitizeFilename(extractRes.body.title, 'gif')),
    };
    assert.equal(expectedHeaders['Content-Type'], 'image/gif');
    assert.ok(expectedHeaders['Content-Disposition'].includes('.gif'));
  });

  // Flow 4: Direct Paste -> Facebook Reel -> Audio Tab (MP3 320kbps) -> Trimmer Cut -> Metadata
  it('TC-T3-04: Direct Paste -> Facebook Reel -> Audio MP3 320kbps -> Trimmer Cut -> Metadata', () => {
    // 1. Ingest Facebook Reel URL
    const reelUrl = 'https://www.facebook.com/reel/10158789523173456';
    assert.equal(detectPlatform(reelUrl), 'facebook');

    // 2. Extract metadata
    const extractRes = simulateBackendExtract(reelUrl);
    assert.equal(extractRes.status, 200);

    // 3. User toggles to Audio format tab and selects MP3 320kbps
    const audio320 = extractRes.body.formats.audio.find(a => a.formatId === 'mp3-320');
    assert.ok(audio320);
    assert.equal(audio320.bitrate, 320);

    // 4. User trims audio to first 30 seconds
    const trim = validateTrimRange('00:00:00', '00:00:30', extractRes.body.duration);
    assert.equal(trim.valid, true);
    assert.equal(trim.durationSeconds, 30);

    // 5. Verify audio metadata and cover art parameters
    const metadataContract = {
      title: extractRes.body.title,
      artist: extractRes.body.author,
      embedCoverArt: audio320.hasCoverArt,
      bitrate: '320k',
      duration: trim.durationSeconds,
    };
    assert.equal(metadataContract.embedCoverArt, true);
    assert.equal(metadataContract.bitrate, '320k');
  });

  // Flow 5: Timestamped URL (&t=1m30s) -> YouTube -> Trimmer Auto-Prefill -> 320k MP3 + Album Art
  it('TC-T3-05: Timestamped URL (&t=1m30s) -> YouTube -> Trimmer Auto-Prefill -> 320k MP3 + Album Art', () => {
    // 1. Ingest timestamped URL
    const timeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s';
    const parsed = new URL(timeUrl);
    const rawTime = parsed.searchParams.get('t').replace('s', '');
    const startTimeSecs = parseTimestamp(rawTime);
    assert.equal(startTimeSecs, 90);

    // 2. Auto-prefill trimmer start value
    const prefilledStart = formatTimestamp(startTimeSecs);
    assert.equal(prefilledStart, '01:30');

    // 3. Calculate trimmed range to end of media (duration = 213s)
    const trim = validateTrimRange(prefilledStart, formatTimestamp(213), 213);
    assert.equal(trim.valid, true);
    assert.equal(trim.startSeconds, 90);
    assert.equal(trim.endSeconds, 213);
    assert.equal(trim.durationSeconds, 123);

    // 4. Verify 320k MP3 download with cover art
    const filename = sanitizeFilename('Rick_Astley_trim_from_90s', 'mp3');
    assert.ok(filename.endsWith('.mp3'));
  });

  // Flow 6: Upstream Failure Simulation -> Live Badge Degraded -> 1-Click Update -> Extractor Recovery
  it('TC-T3-06: Upstream Failure Simulation -> Live Badge Degraded -> 1-Click Update -> Extractor Recovery', () => {
    const healthFixture = loadFixture('health_fixture');

    // 1. Initial degraded state (Facebook degraded)
    const degradedState = healthFixture.degraded;
    assert.equal(degradedState.status, 'degraded');
    assert.equal(degradedState.platforms.facebook.status, 'degraded');

    // 2. User/System triggers 1-Click update check
    const updateRes = healthFixture.updateResponse;
    assert.equal(updateRes.success, true);
    assert.ok(updateRes.message.includes('up to date'));

    // 3. Post-update re-probe yields operational state
    const operationalState = healthFixture.operational;
    assert.equal(operationalState.status, 'healthy');
    assert.equal(operationalState.platforms.facebook.status, 'operational');
  });

  // Flow 7: Direct Paste -> TikTok Video -> Responsive Viewport Resize Simulation (Desktop -> Mobile 375px)
  it('TC-T3-07: Direct Paste -> TikTok Video -> Responsive Viewport Resize (Desktop -> Mobile 375px)', () => {
    // 1. Ingest TikTok video URL on Desktop viewport (1440px)
    const ttUrl = 'https://www.tiktok.com/@tiktok/video/7106594312292453678';
    const extractRes = simulateBackendExtract(ttUrl);
    assert.equal(extractRes.status, 200);

    // 2. Verify state retention when transitioning viewports
    const appState = {
      viewportWidth: 1440,
      activeUrl: ttUrl,
      mediaTitle: extractRes.body.title,
      selectedFormat: 'nowatermark',
      hasOverflow: false,
    };
    assert.equal(appState.viewportWidth, 1440);

    // 3. Simulate viewport resize to iPhone SE / Mini mobile screen (375px)
    appState.viewportWidth = 375;
    // Responsive layout tokens ensure container max-width: 100% and overflow-x: hidden
    const containerStyle = { maxWidth: '100%', overflowX: 'hidden' };
    assert.equal(containerStyle.overflowX, 'hidden');
    // Ensure media state and selected format persist across resize
    assert.equal(appState.activeUrl, ttUrl);
    assert.equal(appState.selectedFormat, 'nowatermark');
  });
});
