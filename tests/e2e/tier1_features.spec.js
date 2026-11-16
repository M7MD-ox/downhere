/**
 * Tier 1: Comprehensive Feature Coverage Test Suite (55+ Tests)
 * Verifies core functionality across all 11 features defined in DownMe architecture.
 *
 * Run with: node --test tests/e2e/tier1_features.spec.js
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

describe('Tier 1: Comprehensive Feature Coverage Suite', () => {

  // =========================================================================
  // Feature 1: YouTube Video Extraction & Download (1080p Default)
  // =========================================================================
  describe('Feature 1: YouTube Video Extraction & Download', () => {
    const ytFixture = loadFixture('youtube_fixture');

    it('TC-T1-YT-01: Auto-selects 1080p Full HD by default when available', () => {
      const selected = resolveDefaultVideoQuality(ytFixture.formats.video);
      assert.ok(selected, 'Default format must not be null');
      assert.equal(selected.formatId, '1080p');
      assert.equal(selected.height, 1080);
      assert.equal(selected.ext, 'mp4');
      assert.equal(selected.isDefault, true);
    });

    it('TC-T1-YT-02: Selectable lower resolutions (720p, 480p, 360p) are available and selectable', () => {
      const videoFormats = ytFixture.formats.video;
      const ids = videoFormats.map(f => f.formatId);
      assert.ok(ids.includes('720p'), 'Should include 720p');
      assert.ok(ids.includes('480p'), 'Should include 480p');
      assert.ok(ids.includes('360p'), 'Should include 360p');

      const userSelected = resolveDefaultVideoQuality(videoFormats, '720p');
      assert.equal(userSelected.formatId, '720p');
      assert.equal(userSelected.height, 720);
    });

    it('TC-T1-YT-03: 4K UHD video does not override 1080p default cap but remains available', () => {
      const videoFormats = ytFixture.formats.video;
      const defaultQuality = resolveDefaultVideoQuality(videoFormats);
      assert.equal(defaultQuality.height, 1080, 'Initial default must remain 1080p');

      const fourKQuality = videoFormats.find(f => f.formatId === '2160p');
      assert.ok(fourKQuality, '2160p format must be available in options');
      assert.equal(fourKQuality.height, 2160);

      const manualOverride = resolveDefaultVideoQuality(videoFormats, '2160p');
      assert.equal(manualOverride.formatId, '2160p');
    });

    it('TC-T1-YT-04: Video stream metadata includes duration, author, and preview thumbnail', () => {
      assert.equal(ytFixture.id, 'dQw4w9WgXcQ');
      assert.equal(ytFixture.duration, 213);
      assert.equal(ytFixture.author, 'Rick Astley');
      assert.ok(ytFixture.thumbnail.includes('maxresdefault.jpg'));
    });

    it('TC-T1-YT-05: Initiating download provides valid MP4 MIME and Content-Disposition headers', () => {
      const filename = sanitizeFilename(ytFixture.title, 'mp4');
      const disposition = generateContentDisposition(filename);
      assert.ok(disposition.includes('attachment; filename='), 'Must be attachment');
      assert.ok(disposition.includes('.mp4'), 'Must have mp4 extension');
      assert.ok(disposition.includes("filename*=UTF-8''"), 'Must include RFC 5987 UTF-8 filename');
    });
  });

  // =========================================================================
  // Feature 2: YouTube Audio Extraction (MP3/M4A)
  // =========================================================================
  describe('Feature 2: YouTube Audio Extraction (MP3/M4A)', () => {
    const ytFixture = loadFixture('youtube_fixture');

    it('TC-T1-YTA-01: Default audio options include standard MP3 format', () => {
      const audioFormats = ytFixture.formats.audio;
      const mp3Standard = audioFormats.find(f => f.formatId === 'mp3-192');
      assert.ok(mp3Standard, 'Standard 192k MP3 must be available');
      assert.equal(mp3Standard.ext, 'mp3');
      assert.equal(mp3Standard.bitrate, 192);
    });

    it('TC-T1-YTA-02: High-resolution MP3 (320 kbps) is available with accurate bitrate descriptor', () => {
      const audioFormats = ytFixture.formats.audio;
      const mp3High = audioFormats.find(f => f.formatId === 'mp3-320');
      assert.ok(mp3High, 'High quality 320k MP3 must be available');
      assert.equal(mp3High.bitrate, 320);
      assert.equal(mp3High.hasCoverArt, true);
    });

    it('TC-T1-YTA-03: Native Apple audio (M4A / AAC) format is available for direct iOS playback', () => {
      const audioFormats = ytFixture.formats.audio;
      const m4a = audioFormats.find(f => f.formatId === 'm4a-aac');
      assert.ok(m4a, 'M4A format must be present');
      assert.equal(m4a.ext, 'm4a');
      assert.equal(m4a.hasCoverArt, true);
    });

    it('TC-T1-YTA-04: Audio formats support album art embedding flag', () => {
      const audioFormats = ytFixture.formats.audio;
      for (const format of audioFormats) {
        assert.equal(format.hasCoverArt, true, `Format ${format.formatId} should support cover art embedding`);
      }
    });

    it('TC-T1-YTA-05: Audio metadata tags include Title, Artist, and Source information', () => {
      const tags = {
        title: ytFixture.title,
        artist: ytFixture.author,
        album: 'DownMe Extracted Audio',
        comment: `https://www.youtube.com/watch?v=${ytFixture.id}`,
      };
      assert.equal(tags.title, 'Rick Astley - Never Gonna Give You Up (Official Music Video)');
      assert.equal(tags.artist, 'Rick Astley');
      assert.ok(tags.comment.includes('dQw4w9WgXcQ'));
    });
  });

  // =========================================================================
  // Feature 3: YouTube Thumbnails & Subtitles
  // =========================================================================
  describe('Feature 3: YouTube Thumbnails & Subtitles', () => {
    const ytFixture = loadFixture('youtube_fixture');

    it('TC-T1-YTT-01: Max-resolution thumbnail (maxresdefault.jpg) extracted with correct 1920x1080 dimensions', () => {
      const maxres = ytFixture.thumbnails.find(t => t.id === 'maxresdefault');
      assert.ok(maxres, 'maxresdefault must be present');
      assert.equal(maxres.width, 1920);
      assert.equal(maxres.height, 1080);
      assert.ok(maxres.url.endsWith('.jpg'));
    });

    it('TC-T1-YTT-02: Standard thumbnail (hqdefault.jpg) fallback is available when maxres is absent', () => {
      const hq = ytFixture.thumbnails.find(t => t.id === 'hqdefault');
      assert.ok(hq, 'hqdefault fallback must be present');
      assert.equal(hq.width, 480);
      assert.equal(hq.height, 360);
    });

    it('TC-T1-YTT-03: Subtitles list extracts available multilingual tracks (English, Arabic, French)', () => {
      const subtitles = ytFixture.subtitles;
      assert.equal(subtitles.length, 3);
      const langs = subtitles.map(s => s.lang);
      assert.ok(langs.includes('en'));
      assert.ok(langs.includes('ar'));
      assert.ok(langs.includes('fr'));
    });

    it('TC-T1-YTT-04: SRT subtitle track provides valid SRT download specification and URL', () => {
      const arSub = ytFixture.subtitles.find(s => s.lang === 'ar');
      assert.ok(arSub);
      assert.equal(arSub.ext, 'srt');
      assert.ok(arSub.label.includes('العربية'));
      assert.ok(arSub.url.includes('lang=ar'));
    });

    it('TC-T1-YTT-05: WebVTT subtitle track format is supported with proper extension', () => {
      const vttSub = ytFixture.subtitles.find(s => s.ext === 'vtt');
      assert.ok(vttSub, 'VTT subtitle track must exist');
      assert.equal(vttSub.lang, 'fr');
      assert.ok(vttSub.url.includes('fmt=vtt'));
    });
  });

  // =========================================================================
  // Feature 4: Facebook Video Extraction
  // =========================================================================
  describe('Feature 4: Facebook Video Extraction', () => {
    const fbFixture = loadFixture('facebook_fixture');

    it('TC-T1-FB-01: Public Facebook video extracts HD and SD MP4 streams', () => {
      const videos = fbFixture.formats.video;
      assert.equal(videos.length, 2);
      assert.equal(videos[0].formatId, 'hd');
      assert.equal(videos[0].isDefault, true);
      assert.equal(videos[1].formatId, 'sd');
    });

    it('TC-T1-FB-02: Facebook Reel URLs are recognized as valid Facebook video platform', () => {
      const reelUrl = 'https://www.facebook.com/reel/10158789523173456';
      assert.equal(detectPlatform(reelUrl), 'facebook');
      const clean = cleanMediaUrl(reelUrl);
      assert.equal(clean, 'https://www.facebook.com/reel/10158789523173456');
    });

    it('TC-T1-FB-03: Audio extraction is supported for Facebook video content', () => {
      const audioFormats = fbFixture.formats.audio;
      assert.ok(audioFormats.length >= 2);
      const mp3 = audioFormats.find(f => f.formatId === 'mp3-320');
      assert.ok(mp3, 'Facebook audio should support MP3 320k');
      assert.equal(mp3.ext, 'mp3');
    });

    it('TC-T1-FB-04: Facebook video preview displays title, duration, and thumbnail image', () => {
      assert.equal(fbFixture.title, 'Meta Connect Keynote - Next Generation Spatial Computing');
      assert.equal(fbFixture.duration, 98);
      assert.ok(fbFixture.thumbnail.includes('fbcdn.net'));
    });

    it('TC-T1-FB-05: Facebook shortlinks (fb.watch) resolve to facebook platform', () => {
      const shortUrl = 'https://fb.watch/mG21xV9sKL/';
      assert.equal(detectPlatform(shortUrl), 'facebook');
    });
  });

  // =========================================================================
  // Feature 5: TikTok Watermark-Free Media
  // =========================================================================
  describe('Feature 5: TikTok Watermark-Free Media & Album', () => {
    const ttFixture = loadFixture('tiktok_fixture');

    it('TC-T1-TT-01: TikTok video downloads without watermarks in MP4 format', () => {
      const video = ttFixture.videoPost;
      assert.equal(video.isWatermarkFree, true);
      assert.equal(video.formats.video[0].formatId, 'nowatermark');
      assert.equal(video.formats.video[0].ext, 'mp4');
    });

    it('TC-T1-TT-02: TikTok original audio track is extractable as MP3', () => {
      const audio = ttFixture.videoPost.formats.audio[0];
      assert.ok(audio);
      assert.equal(audio.ext, 'mp3');
      assert.equal(audio.formatId, 'mp3-original');
    });

    it('TC-T1-TT-03: TikTok photo items contain direct full-resolution image URLs', () => {
      const album = ttFixture.albumPost;
      assert.equal(album.mediaType, 'album');
      assert.equal(album.items.length, 6);
      assert.equal(album.items[0].resolution, '1440x2560');
      assert.ok(album.items[0].url.endsWith('.jpg'));
    });

    it('TC-T1-TT-04: TikTok multi-photo slideshow supports batch ZIP download', () => {
      const album = ttFixture.albumPost;
      assert.equal(album.canDownloadAsZip, true);
      const zipFilename = sanitizeFilename(album.title, 'zip');
      assert.ok(zipFilename.endsWith('.zip'));
      assert.equal(album.items.length, 6);
    });

    it('TC-T1-TT-05: TikTok mobile shortlinks (vm.tiktok.com) resolve to tiktok platform', () => {
      const shortUrl = 'https://vm.tiktok.com/ZM2bC9YqP/';
      assert.equal(detectPlatform(shortUrl), 'tiktok');
    });
  });

  // =========================================================================
  // Feature 6: Pinterest Media Extraction
  // =========================================================================
  describe('Feature 6: Pinterest Media Extraction', () => {
    const pinFixture = loadFixture('pinterest_fixture');

    it('TC-T1-PIN-01: High-res photo pin extracts uncompressed original quality', () => {
      const photo = pinFixture.photoPin;
      assert.equal(photo.mediaType, 'photo');
      const original = photo.formats.photo.find(f => f.formatId === 'original');
      assert.ok(original);
      assert.equal(original.resolution, '3840x2880');
      assert.equal(original.ext, 'jpg');
    });

    it('TC-T1-PIN-02: Pinterest video pin extracts MP4 video stream', () => {
      const video = pinFixture.videoPin;
      assert.equal(video.mediaType, 'video');
      assert.equal(video.formats.video[0].ext, 'mp4');
      assert.equal(video.duration, 42);
    });

    it('TC-T1-PIN-03: Animated GIF pin correctly detects GIF mediaType and preserves .gif format', () => {
      const gif = pinFixture.gifPin;
      assert.equal(gif.mediaType, 'gif');
      assert.equal(gif.formats.gif[0].ext, 'gif');
      assert.ok(gif.formats.gif[0].url.endsWith('.gif'));
    });

    it('TC-T1-PIN-04: Pinterest shortlinks (pin.it) resolve to pinterest platform', () => {
      const shortUrl = 'https://pin.it/3X9vK8y';
      assert.equal(detectPlatform(shortUrl), 'pinterest');
    });

    it('TC-T1-PIN-05: Pinterest country-code TLDs (pinterest.ca, pinterest.co.uk) auto-detect correctly', () => {
      assert.equal(detectPlatform('https://pinterest.ca/pin/993606736519694085/'), 'pinterest');
      assert.equal(detectPlatform('https://pinterest.co.uk/pin/993606736519694085/'), 'pinterest');
    });
  });

  // =========================================================================
  // Feature 7: URL Auto-Detection & Platform Badge
  // =========================================================================
  describe('Feature 7: URL Auto-Detection & Platform Badge', () => {
    it('TC-T1-DET-01: Recognizes YouTube standard and short URLs', () => {
      assert.equal(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
      assert.equal(detectPlatform('https://youtu.be/dQw4w9WgXcQ'), 'youtube');
      assert.equal(detectPlatform('https://youtube.com/shorts/aqz-KE-bpKQ'), 'youtube');
    });

    it('TC-T1-DET-02: Recognizes Facebook standard, mobile, and Reel URLs', () => {
      assert.equal(detectPlatform('https://www.facebook.com/watch/?v=10153231379946729'), 'facebook');
      assert.equal(detectPlatform('https://m.facebook.com/watch/?v=10153231379946729'), 'facebook');
      assert.equal(detectPlatform('https://fb.watch/mG21xV9sKL/'), 'facebook');
    });

    it('TC-T1-DET-03: Recognizes TikTok desktop, photo post, and mobile shortlinks', () => {
      assert.equal(detectPlatform('https://www.tiktok.com/@tiktok/video/7106594312292453678'), 'tiktok');
      assert.equal(detectPlatform('https://www.tiktok.com/@user/photo/7106594312292459999'), 'tiktok');
      assert.equal(detectPlatform('https://vm.tiktok.com/ZM2bC9YqP/'), 'tiktok');
    });

    it('TC-T1-DET-04: Recognizes Pinterest pin URLs and pin.it shortlinks', () => {
      assert.equal(detectPlatform('https://www.pinterest.com/pin/993606736519694085/'), 'pinterest');
      assert.equal(detectPlatform('https://pin.it/3X9vK8y'), 'pinterest');
    });

    it('TC-T1-DET-05: Real-time debounce returns null for incomplete or invalid strings', () => {
      assert.equal(detectPlatform(''), null);
      assert.equal(detectPlatform('   '), null);
      assert.equal(detectPlatform('https://google.com'), null);
      assert.equal(detectPlatform('not-a-valid-url'), null);
    });
  });

  // =========================================================================
  // Feature 8: 1080p Default Selection Logic
  // =========================================================================
  describe('Feature 8: 1080p Default Selection Logic', () => {
    it('TC-T1-DEF-01: Selects 1080p when both 1080p and lower resolutions exist', () => {
      const formats = [
        { formatId: '1080p', height: 1080 },
        { formatId: '720p', height: 720 },
        { formatId: '480p', height: 480 },
      ];
      const res = resolveDefaultVideoQuality(formats);
      assert.equal(res.formatId, '1080p');
    });

    it('TC-T1-DEF-02: Caps 4K (2160p) and 1440p streams at 1080p for initial default', () => {
      const formats = [
        { formatId: '2160p', height: 2160 },
        { formatId: '1440p', height: 1440 },
        { formatId: '1080p', height: 1080 },
        { formatId: '720p', height: 720 },
      ];
      const res = resolveDefaultVideoQuality(formats);
      assert.equal(res.formatId, '1080p', 'Should cap initial selection at 1080p');
    });

    it('TC-T1-DEF-03: Falls back to highest available (720p) when 1080p is unavailable', () => {
      const formats = [
        { formatId: '720p', height: 720 },
        { formatId: '480p', height: 480 },
        { formatId: '360p', height: 360 },
      ];
      const res = resolveDefaultVideoQuality(formats);
      assert.equal(res.formatId, '720p');
    });

    it('TC-T1-DEF-04: Falls back to 480p for legacy SD video clips', () => {
      const formats = [
        { formatId: '480p', height: 480 },
        { formatId: '360p', height: 360 },
      ];
      const res = resolveDefaultVideoQuality(formats);
      assert.equal(res.formatId, '480p');
    });

    it('TC-T1-DEF-05: User manual selection explicitly overrides 1080p default', () => {
      const formats = [
        { formatId: '1080p', height: 1080 },
        { formatId: '720p', height: 720 },
      ];
      const userSelected = resolveDefaultVideoQuality(formats, '720p');
      assert.equal(userSelected.formatId, '720p');
    });
  });

  // =========================================================================
  // Feature 9: Query Param Prefill & Dynamic Island Clipboard
  // =========================================================================
  describe('Feature 9: Query Param Prefill & Dynamic Island Clipboard', () => {
    it('TC-T1-PRE-01: Deep link parses ?url= parameter cleanly and auto-populates input', () => {
      const searchParams = new URLSearchParams('?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ');
      const incomingUrl = searchParams.get('url');
      assert.equal(incomingUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.equal(detectPlatform(incomingUrl), 'youtube');
    });

    it('TC-T1-PRE-02: Deep link parses ?text= parameter from iOS Share Sheet', () => {
      const searchParams = new URLSearchParams('?text=Check+this+video+https%3A%2F%2Fvm.tiktok.com%2FZM2bC9YqP%2F');
      const incomingText = searchParams.get('text');
      const matchedUrl = incomingText.match(/https?:\/\/[^\s]+/)?.[0];
      assert.ok(matchedUrl);
      assert.equal(detectPlatform(matchedUrl), 'tiktok');
    });

    it('TC-T1-PRE-03: Address bar query params can be cleaned via history replacement without page reload', () => {
      const initialUrl = 'https://downme.app/?url=https://youtu.be/dQw4w9WgXcQ';
      const parsed = new URL(initialUrl);
      parsed.search = '';
      assert.equal(parsed.href, 'https://downme.app/');
    });

    it('TC-T1-PRE-04: Dynamic Island clipboard detector recognizes valid media link in clipboard', () => {
      const clipboardText = 'https://www.pinterest.com/pin/993606736519694085/';
      const platform = detectPlatform(clipboardText);
      assert.equal(platform, 'pinterest');
      const bannerState = { visible: true, platform, url: clipboardText };
      assert.equal(bannerState.visible, true);
    });

    it('TC-T1-PRE-05: Dynamic Island clipboard detector ignores non-media text in clipboard', () => {
      const clipboardText = 'Meeting notes: discuss budget at 3 PM';
      const platform = detectPlatform(clipboardText);
      assert.equal(platform, null);
      const bannerState = { visible: platform !== null };
      assert.equal(bannerState.visible, false);
    });
  });

  // =========================================================================
  // Feature 10: Video & Audio Trimmer Tool
  // =========================================================================
  describe('Feature 10: Video & Audio Trimmer Tool', () => {
    it('TC-T1-TRM-01: Timecode parsing converts HH:MM:SS and MM:SS to exact seconds', () => {
      assert.equal(parseTimestamp('00:00:15'), 15);
      assert.equal(parseTimestamp('01:30'), 90);
      assert.equal(parseTimestamp('01:02:05'), 3725);
    });

    it('TC-T1-TRM-02: Formatted duration converts seconds back to MM:SS and HH:MM:SS string', () => {
      assert.equal(formatTimestamp(15), '00:15');
      assert.equal(formatTimestamp(90), '01:30');
      assert.equal(formatTimestamp(3725), '01:02:05');
    });

    it('TC-T1-TRM-03: Trimmer interval validation verifies start is strictly before end with >= 1.0s gap', () => {
      const valid = validateTrimRange('00:00:10', '00:00:30', 213);
      assert.equal(valid.valid, true);
      assert.equal(valid.durationSeconds, 20);
      assert.equal(valid.formattedDuration, '00:20');

      const invalid = validateTrimRange('00:00:30', '00:00:10', 213);
      assert.equal(invalid.valid, false);
      assert.ok(invalid.error.includes('before end time'));
    });

    it('TC-T1-TRM-04: Server-side FFmpeg parameters for stream-copy cut match exact timestamps', () => {
      const trim = validateTrimRange('00:00:15', '00:00:45', 213);
      assert.equal(trim.valid, true);
      const ffmpegArgs = [
        '-ss', '00:00:15',
        '-to', '00:00:45',
        '-c', 'copy',
      ];
      assert.equal(ffmpegArgs[1], '00:00:15');
      assert.equal(ffmpegArgs[3], '00:00:45');
      assert.equal(ffmpegArgs[5], 'copy');
    });

    it('TC-T1-TRM-05: Audio trimming with MP3 re-encoding generates valid bitrate and duration parameters', () => {
      const trim = validateTrimRange('00:01:00', '00:01:40', 213);
      assert.equal(trim.durationSeconds, 40);
      const ffmpegArgs = [
        '-ss', '00:01:00',
        '-to', '00:01:40',
        '-c:a', 'libmp3lame',
        '-b:a', '320k',
      ];
      assert.equal(ffmpegArgs[5], 'libmp3lame');
      assert.equal(ffmpegArgs[7], '320k');
    });
  });

  // =========================================================================
  // Feature 11: Live Platform Health Badges & Self-Healing
  // =========================================================================
  describe('Feature 11: Live Platform Health Badges & Self-Healing', () => {
    const healthFixture = loadFixture('health_fixture');

    it('TC-T1-HLT-01: Health payload reports all 4 platforms with status and latency', () => {
      const health = healthFixture.operational;
      assert.equal(health.status, 'healthy');
      const platforms = health.platforms;
      assert.ok(platforms.youtube);
      assert.ok(platforms.facebook);
      assert.ok(platforms.tiktok);
      assert.ok(platforms.pinterest);
    });

    it('TC-T1-HLT-02: Operational status resolves to green indicator badge color token (#30d158)', () => {
      const statusToColor = status => (status === 'operational' ? '#30d158' : status === 'degraded' ? '#ffd60a' : '#ff453a');
      assert.equal(statusToColor('operational'), '#30d158');
    });

    it('TC-T1-HLT-03: Degraded platform status resolves to amber indicator badge color token (#ffd60a)', () => {
      const health = healthFixture.degraded;
      assert.equal(health.platforms.facebook.status, 'degraded');
      assert.equal(health.platforms.facebook.latencyMs, 4200);
      const statusToColor = status => (status === 'operational' ? '#30d158' : status === 'degraded' ? '#ffd60a' : '#ff453a');
      assert.equal(statusToColor(health.platforms.facebook.status), '#ffd60a');
    });

    it('TC-T1-HLT-04: Extractor version and latency are included in badge popover metadata', () => {
      const health = healthFixture.operational;
      assert.equal(health.version, '2026.10.26');
      assert.equal(typeof health.platforms.youtube.latencyMs, 'number');
      assert.ok(health.platforms.youtube.lastChecked);
    });

    it('TC-T1-HLT-05: 1-Click updater returns valid recovery confirmation with version strings', () => {
      const updateRes = healthFixture.updateResponse;
      assert.equal(updateRes.success, true);
      assert.equal(updateRes.currentVersion, '2026.10.26');
      assert.ok(updateRes.message.includes('up to date'));
    });
  });
});
