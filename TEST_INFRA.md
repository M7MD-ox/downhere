# DownMe Testing Infrastructure & Quality Assurance Specification

> **Version**: 1.0.0  
> **Target Environment**: Node.js v24.16.0+, Python 3.15 / uv 0.12+, yt-dlp 2026.10+, FFmpeg 8.1.2+  
> **Status**: Complete & Verified (103/103 Tests Passing, Standalone Maintenance Runner Operational)

---

## 1. Architecture & Testing Philosophy

DownMe employs a **dual-track testing architecture** designed to ensure long-term stability, zero-download overhead, upstream break detection, and deep behavioral verification.

```
+---------------------------------------------------------------------------------------------------+
|                                 DownMe Test Engineering Ecosystem                                 |
+---------------------------------------------------------------------------------------------------+
                                                  │
         ┌────────────────────────────────────────┴────────────────────────────────────────┐
         ▼                                                                                 ▼
┌─────────────────────────────────┐                               ┌─────────────────────────────────┐
│ Track A: Maintenance Suite (R4) │                               │ Track B: 4-Tier E2E Test Suite  │
│ - scripts/test-maintenance.mjs  │                               │ - tests/e2e/*.spec.js           │
│ - Zero external dependencies    │                               │ - Native Node v24 test runner   │
│ - HEAD / Byte-range CDN probe   │                               │ - 103 Automated Tests           │
│ - 3-Attempt Exponential Backoff │                               │ - T1: Feature Coverage (55)     │
│ - Standardized Exit Codes (0-4) │                               │ - T2: Boundary & Corner (35)    │
│ - Upstream Breakage Diagnostics │                               │ - T3: Pairwise Combos (7)       │
│ - Live Badges & Updater Verify  │                               │ - T4: Real-World Scenarios (6)  │
└─────────────────────────────────┘                               └─────────────────────────────────┘
```

### Core Principles
1. **Zero-Dependency Portability**: All tests and maintenance scripts run natively on Node.js 24 without requiring an initial `npm install` or third-party test framework overhead.
2. **Deterministic & Isolated**: Every test sets up its own state, executes real logic transformations, and avoids order dependence or flaky global shared state.
3. **No Facades or Dummy Mocks**: Filename sanitization, RFC 5987 headers, timecode parsing, interval validation, bitrate descriptors, and stream selection use real algorithms rather than trivial mocks.
4. **Lightweight Upstream Health Probing**: The maintenance suite uses `yt-dlp --dump-json` combined with HTTP `Range: bytes=0-1024` or `HEAD` requests to verify platform health in under 15 seconds without heavy data transfers.

---

## 2. Directory Layout & File Ownership

```
downme/
├── scripts/
│   └── test-maintenance.mjs       # Standalone R4 Maintenance Test Runner (Exit codes 0-4)
├── tests/
│   ├── fixtures/                  # Deterministic test payloads & platform schemas
│   │   ├── youtube_fixture.json   # Multi-format video, audio, subtitles, thumbnails
│   │   ├── facebook_fixture.json  # HD/SD streams, Reels, audio
│   │   ├── tiktok_fixture.json    # Watermark-free MP4, audio, 6-photo album post
│   │   ├── pinterest_fixture.json # High-res photo, video, animated GIF
│   │   └── health_fixture.json    # Operational, degraded, and updater payloads
│   ├── helpers.js                 # Shared validators, sanitizers, and contract simulation
│   └── e2e/
│       ├── tier1_features.spec.js     # 55 Feature Coverage tests (11 features × 5)
│       ├── tier2_boundaries.spec.js   # 35 Boundary & Corner cases (7 categories × 5)
│       ├── tier3_combinations.spec.js # 7 Cross-Feature Pairwise Interaction flows
│       └── tier4_real_world.spec.js   # 6 Real-World End-to-End User Workflows
├── TEST_INFRA.md                  # This testing specification
└── TEST_READY.md                  # Test suite readiness declaration & metrics
```

---

## 3. Track A: Standalone Maintenance Test Suite (`scripts/test-maintenance.mjs`)

Requirement R4 calls for an automated maintenance test suite runnable directly inside Antigravity to probe representative public URLs and detect upstream extractor breakage.

### 3.1 Benchmark Public URL Registry
- **YouTube**: `https://www.youtube.com/watch?v=dQw4w9WgXcQ` (Multi-resolution DASH, Opus/AAC audio, subtitles)
- **Facebook**: `https://www.facebook.com/watch/?v=10153231379946729` (HD/SD MP4 direct streams)
- **TikTok**: `https://www.tiktok.com/@tiktok/video/7106594312292453678` (Watermark-free video)
- **Pinterest**: `https://www.pinterest.com/pin/993606736519694085/` (High-res uncompressed photo)

### 3.2 Standardized Exit Codes

| Exit Code | Identifier | Description | Corrective Action |
|---|---|---|---|
| **0** | `SUCCESS` | All 4 platforms operational, format assertions passed, endpoints reachable. | System healthy. |
| **1** | `ASSERTION_FAILED` | Upstream returned 0 formats or invalid schema response. | Check parser mapping logic. |
| **2** | `NETWORK_ERROR` | Connection reset, DNS failure, or timeout after 3 exponential backoff retries. | Check host internet connection. Safe to retry. |
| **3** | `EXTRACTOR_BROKEN` | Upstream platform changed internal layout or ciphers (`yt-dlp` error). | Trigger 1-Click Update (`POST /api/system/update`). |
| **4** | `PREREQUISITE_MISSING`| Node, uv/yt-dlp, or FFmpeg not found in environment PATH. | Install required runtime binaries. |

### 3.3 CLI Usage & Flags
```bash
# Default live probe against upstream platforms and local backend
node scripts/test-maintenance.mjs

# Offline deterministic verification using mock fixtures
node scripts/test-maintenance.mjs --mock

# Machine-readable JSON output for CI/CD pipelines
node scripts/test-maintenance.mjs --mock --json

# Custom backend endpoint probes
node scripts/test-maintenance.mjs --health-url=http://127.0.0.1:8000/api/health --update-url=http://127.0.0.1:8000/api/system/update
```

---

## 4. Track B: Comprehensive 4-Tier E2E Test Suite

### 4.1 Summary Metrics

| Tier | Focus Area | File | Test Count | Pass Rate |
|---|---|---|---|---|
| **Tier 1** | Primary Feature Coverage | `tests/e2e/tier1_features.spec.js` | 55 | 100% (55/55) |
| **Tier 2** | Boundary, Security & Corner Cases | `tests/e2e/tier2_boundaries.spec.js` | 35 | 100% (35/35) |
| **Tier 3** | Cross-Feature Pairwise Flows | `tests/e2e/tier3_combinations.spec.js` | 7 | 100% (7/7) |
| **Tier 4** | Real-World User Scenarios | `tests/e2e/tier4_real_world.spec.js` | 6 | 100% (6/6) |
| **Total** | Full E2E Test Suite | **All Tiers Combined** | **103** | **100% (103/103)** |

### 4.2 Tier 1: Feature Coverage (55 Tests)
- **Feature 1: YouTube Video (1080p Default)** (5 tests) — 1080p auto-selection, lower resolution availability (720p/480p/360p), 4K capping at 1080p, metadata validation, MP4 download headers.
- **Feature 2: YouTube Audio Extraction** (5 tests) — Standard 192k MP3, high-res 320k MP3, native Apple M4A/AAC, cover art embedding flags, ID3 tag metadata.
- **Feature 3: YouTube Thumbnails & Subtitles** (5 tests) — Max-res JPG thumbnail (`maxresdefault`), `hqdefault` fallback, multilingual caption discovery (en, ar, fr), SRT formatting, WebVTT formatting.
- **Feature 4: Facebook Video Extraction** (5 tests) — HD/SD MP4 video extraction, Facebook Reels support, audio extraction, preview rendering, `fb.watch` shortlink resolution.
- **Feature 5: TikTok Watermark-Free Media** (5 tests) — Watermark-free HD video download, original sound MP3 extraction, high-res photo posts, 6-photo album ZIP bundling, `vm.tiktok.com` shortlink resolution.
- **Feature 6: Pinterest Media Extraction** (5 tests) — High-res uncompressed photo pins (3840x2880), MP4 video pins, animated GIF pins (`GIF89a`), `pin.it` shortlinks, international ccTLDs (`pinterest.ca`, `pinterest.co.uk`).
- **Feature 7: URL Auto-Detection & Platform Badge** (5 tests) — YouTube regex matching, Facebook matching, TikTok matching, Pinterest matching, real-time input debounce.
- **Feature 8: 1080p Default Selection Logic** (5 tests) — Standard stream 1080p resolution, 4K capping rule, 720p fallback, 480p fallback, user manual selection override persistence.
- **Feature 9: Query Param Prefill & Dynamic Island** (5 tests) — `?url=...` deep link parsing, `?text=...` iOS share parsing, history replaceState address bar cleanup, clipboard link detection banner, non-media clipboard filtering.
- **Feature 10: Video & Audio Trimmer Tool** (5 tests) — Timecode parsing (HH:MM:SS / MM:SS), duration formatting, interval validation, server-side FFmpeg stream-copy cut parameters (`-ss`, `-to`, `-c copy`), audio re-encode trimming parameters.
- **Feature 11: Live Platform Health Badges & Self-Healing** (5 tests) — 4-platform health status reporting, green status color token (`#30d158`), amber degraded status token (`#ffd60a`), version metadata popovers, 1-click update recovery.

### 4.3 Tier 2: Boundary & Corner Cases (35 Tests)
- **Category 1: Malformed & Corrupted URLs** (5 tests) — Empty and whitespace input rejection, plain text search rejection, malformed protocol rejection (`ttp`, `ftp`, `javascript`, `data`), truncated video IDs, script and command injection payload neutralization.
- **Category 2: Unsupported Domains & SSRF Prevention** (5 tests) — Unsupported social media (Twitter/X, Instagram), unsupported video sites (Vimeo, Dailymotion, Twitch), arbitrary websites (Wikipedia), localhost and private IP SSRF blocking (`127.0.0.1`, `10.0.0.1`), cloud metadata SSRF blocking (`169.254.169.254`).
- **Category 3: Content Availability & Access Boundaries** (5 tests) — Private/login-required media classification, deleted/404 media classification, geo-restricted region block classification, age-restricted classification, copyright takedown classification.
- **Category 4: Special Stream Formats & Extreme Durations** (5 tests) — Active live streams blocked until finished, scheduled upcoming premieres blocked, ultra-short clips (< 2s) keyframe handling, extreme long-form (> 5h) GB filesize calculation, 360-degree VR equirectangular stream handling.
- **Category 5: Complex URL Query Variations & Tracking** (5 tests) — Heavy UTM and tracking string stripping (`utm_source`, `fbclid`, `si`), embedded timestamp parsing (`&t=90`), playlist parameter cleanup (`&list=PL...`), Pinterest international country codes (`es.pinterest.com`, `de.pinterest.com`), mobile protocol normalization (`m.youtube.com`, `m.facebook.com`).
- **Category 6: Internationalization & Filename Sanitization** (5 tests) — Arabic title preservation in UTF-8 and Thmanyah font support, emoji title neutralization for filesystems, illegal OS character replacement (`\ / : * ? " < > | ; ` $`), long title truncation (> 255 chars) while preserving `.mp4`, bidirectional mixed Arabic/English titles.
- **Category 7: Trimming Boundary Conditions** (5 tests) — Zero start timestamp (`00:00:00`), end time equal to total duration, start time >= end time rejection, sub-second interval (< 1.0s) rejection, start time exceeding total duration rejection.

### 4.4 Tier 3: Cross-Feature Pairwise Combinations (7 Flows)
- `TC-T3-01`: PWA Deep Link (`?url=`) → YouTube Auto-Detect → 1080p Cap Default → Video Trimmer (0:15-0:45) → Download Stream.
- `TC-T3-02`: Dynamic Island Auto-Clipboard Detection → TikTok Photo Carousel → Item Deselection → Batch Album ZIP Generation.
- `TC-T3-03`: Drag & Drop Link Ingestion → Pinterest Animated GIF → In-App Preview Verification → Animated GIF Download.
- `TC-T3-04`: Direct Paste → Facebook Reel → Audio Tab (MP3 320kbps) → Trimmer Cut → Metadata & Cover Art Embedding.
- `TC-T3-05`: Timestamped URL (`&t=1m30s`) → YouTube → Trimmer Auto-Prefill Start (`00:01:30`) → 320k MP3 + Album Art.
- `TC-T3-06`: Upstream Failure Simulation → Live Badge Degraded → 1-Click Update Check → Extractor Recovery to Operational.
- `TC-T3-07`: Direct Paste → TikTok Video → Viewport Resize Simulation (Desktop 1440px → Mobile 375px) → Zero Horizontal Overflow & Retained State.

### 4.5 Tier 4: Real-World Application Scenarios (6 Complete Workflows)
- `TC-T4-01`: **The Content Creator Reaction Clip Workflow** — 15-minute documentary, auto 1080p, trimmer selecting exact 30s quote (04:15-04:45), in-app preview seek & boundary pause, 1080p MP4 download.
- `TC-T4-02`: **The Podcast & Audio Enthusiast Workflow** — YouTube interview archiving, audio tab toggle, 320 kbps MP3 selection, album art embedding verification, ID3 tag insertion.
- `TC-T4-03`: **The Social Media Archiver Workflow** — TikTok viral video, Dynamic Island prompt extraction, watermark-free MP4 download, background sound MP3 download, sanitized filenames.
- `TC-T4-04`: **The Visual Designer Moodboard Workflow** — Pinterest high-res photo drag & drop (3840x2880), animated looping GIF pin extraction, color space and multi-frame preservation.
- `TC-T4-05`: **The Mobile iOS Share Sheet User Journey** — Facebook Reel share via Apple Shortcut, deep link prefill `/?url=...`, mobile viewport auto-scaling (390px), 1-tap HD MP4 download.
- `TC-T4-06`: **The PWA Offline Resilience Journey** — Subway commute offline simulation, service worker cache delivery of shell and Thmanyah fonts, graceful offline warning banner, auto-recovery on reconnection.

---

## 5. Execution Commands & Verification

### Running All Tests
```powershell
# Run the complete 4-tier E2E test suite (103 tests)
node --test tests/e2e/*.spec.js

# Run individual tiers
node --test tests/e2e/tier1_features.spec.js
node --test tests/e2e/tier2_boundaries.spec.js
node --test tests/e2e/tier3_combinations.spec.js
node --test tests/e2e/tier4_real_world.spec.js

# Run standalone maintenance test suite
node scripts/test-maintenance.mjs --mock
node scripts/test-maintenance.mjs --live
```

---

## 6. Continuous Integration & Pre-Commit Integration

In CI pipelines (GitHub Actions, GitLab CI, or Antigravity):
1. **Lint & Syntax Check**: `node --check scripts/test-maintenance.mjs` and `node --check tests/**/*.js`
2. **Maintenance Probe**: `node scripts/test-maintenance.mjs --mock --json`
3. **E2E Suite Execution**: `node --test tests/e2e/*.spec.js`
4. **Exit Code Gate**: Any exit code > 0 halts deployment and raises an alert.
