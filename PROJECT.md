# Project: DownMe

## Architecture
DownMe is an installable, Apple-minimalist Progressive Web Application (PWA) and personal media extraction service supporting YouTube, Facebook, TikTok (watermark-free), and Pinterest.

```
+---------------------------------------------------------------------------------+
|                                 Client (PWA)                                    |
| - Pure Vanilla ES Modules + Tailwind / Apple HIG Glassmorphism Design Tokens    |
| - Thmanyah Sans Primary Typeface (Light, Regular, Medium, Bold, Black)          |
| - Dynamic Island Floating Clipboard Card, Drag & Drop Overlay, In-App Preview   |
| - Responsive Viewports (375px - 430px Mobile, 1280px+ Desktop, Zero Overflow)   |
| - Service Worker (Cache-first Fonts/Shell, Offline Fallback) & Web Share Target |
| - Deep Link Consumer (?url=... & ?text=...) + iOS Apple Shortcut Bridge         |
+---------------------------------------+-----------------------------------------+
                                        │ HTTP / REST / Streaming
                                        ▼
+---------------------------------------------------------------------------------+
|                           FastAPI Backend Service                               |
| - Native in-memory yt-dlp (2026.10+) with Node.js JS runtime solver             |
| - Hybrid Extraction Engines (TikTok photo rehydration + Pinterest Resource API)|
| - Real-time FFmpeg 8.1.2 stream processing (1080p DASH merge, 320k MP3 + cover)|
| - Server-side fast stream-copy / re-encode video & audio trimmer                |
| - In-memory multi-photo ZIP streaming generator                                 |
| - Live health probes & badges (/api/health) and 1-click updater (/api/update)   |
| - Static PWA File Server on unified port                                        |
+---------------------------------------+-----------------------------------------+
                                        │
                                        ▼
+---------------------------------------------------------------------------------+
|                       Testing & Reliability Ecosystem                           |
| - Track A: Standalone Maintenance Test Suite (R4, scripts/test-maintenance.mjs) |
| - Track B: 4-Tier E2E Test Suite (T1: Feature, T2: Boundary, T3: Pair, T4: E2E) |
| - Phase 2 Hardening: Tier 5 Adversarial Coverage Audit                          |
+---------------------------------------------------------------------------------+
```

---

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | YouTube Video (1080p Default) | Auto-selects 1080p MP4 (merging video+audio streams via FFmpeg); selectable 720p, 480p, 360p, 4K | M1, M2, M4 | R1, survey |
| 2 | YouTube Audio Extraction (MP3/M4A) | High-fidelity audio up to 320kbps MP3 (libmp3lame) and native Apple M4A/AAC | M1, M2, M4 | R1, survey |
| 3 | Audio Album Art & Metadata Embedding | Automatically embeds video thumbnail and title/artist tags into MP3/M4A metadata | M1, M2, M4 | Follow-up 2 |
| 4 | YouTube Thumbnail Download | Downloads max resolution JPG thumbnail (`maxresdefault` with fallback to `hqdefault`) | M1, M2, M4 | R1, survey |
| 5 | YouTube Subtitles Extraction | Downloads manual and auto-generated captions in `.srt` and `.vtt` formats | M1, M2, M4 | Follow-up 2 |
| 6 | Facebook Video Download | Downloads public videos and Reels in available qualities (HD/SD MP4) | M1, M2, M4 | R1, survey |
| 7 | Facebook Shortlink Resolution | Resolves `fb.watch` shortlinks and redirects to canonical streams | M1, M2, M4 | R1, survey |
| 8 | TikTok Watermark-Free Video | Downloads unwatermarked MP4 videos using direct CDN video streams | M1, M2, M4 | R1, survey |
| 9 | TikTok Watermark-Free Photos | Extracts full-resolution photo posts without watermarks from web rehydration JSON | M1, M2, M4 | R1, Follow-up 2 |
| 10 | TikTok Album ZIP Download | Bundles multi-photo slideshows into a single downloadable ZIP archive | M1, M2, M4 | Follow-up 2 |
| 11 | Pinterest Auto-Detection | Recognizes `pin.it`, `pinterest.com/pin/*`, and international TLDs | M1, M2, M4 | Follow-up 1 |
| 12 | Pinterest High-Res Photos | Extracts original uncompressed photos (JPG/PNG/WebP) via Resource API | M1, M2, M4 | Follow-up 1 |
| 13 | Pinterest Video Download | Downloads video pins in MP4 format | M1, M2, M4 | Follow-up 1 |
| 14 | Pinterest Animated GIF Download | Identifies animated GIF pins and delivers valid multi-frame GIFs | M1, M2, M4 | Follow-up 1 |
| 15 | Pinterest Idea Pin / Carousel ZIP | Packages multi-slide Idea pins into downloadable ZIP archives | M1, M2, M4 | Follow-up 2 |
| 16 | Apple-Style Minimalist UI | Dark/light theme, frosted glassmorphism (`backdrop-filter: blur(24px)`), hairline borders | M2, M4 | R2, survey |
| 17 | Thmanyah Typography System | Integrates 5 weights of local Thmanyah font assets with full bilingual support | M2, M4 | R2, survey |
| 18 | Responsive Viewport Adaptation | Zero horizontal overflow on mobile (375px-430px) and fluid scaling to desktop (1280px+) | M2, M4 | R2, survey |
| 19 | Dynamic Island Auto-Clipboard | Floating island banner on app focus prompting 1-tap download if link in clipboard | M3, M4 | Follow-up 2 |
| 20 | In-App Instant Preview | Custom minimalist previewer for video, audio waveform, and photo lightbox carousel | M2, M4 | Follow-up 2 |
| 21 | Video & Audio Trimmer Tool | Dual-slider UI for start/end timestamps; server-side fast FFmpeg stream cut | M1, M2, M4 | Follow-up 2 |
| 22 | Drag & Drop Link Support | Desktop & iPad full-window glowing drop-zone overlay to extract dropped links | M2, M4 | Follow-up 2 |
| 23 | Live Platform Health Badges | Footer indicators showing live operational status for YT, FB, TikTok, Pinterest | M1, M2, M4 | Follow-up 2 |
| 24 | 1-Click / Auto Extractor Update | Endpoint `/api/system/update` to self-heal and update `yt-dlp` upon breakage | M1, M2, M4 | Follow-up 2 |
| 25 | Progressive Web App (PWA) | Web app manifest with standalone display, icons, and Apple mobile meta tags | M3, M4 | R3, survey |
| 26 | Service Worker & Offline Cache | Caches app shell, local Thmanyah fonts, and provides offline fallback page | M3, M4 | R3, survey |
| 27 | Deep Link & Query Param Handling | Automatically parses `?url=...` or `?text=...`, populates input, and triggers extraction | M3, M4 | R3, survey |
| 28 | Web Share Target Integration | Receives shared links directly from Android/desktop browser share targets | M3, M4 | R3, survey |
| 29 | iOS Apple Shortcut Bridge | Custom `.shortcut` definition for iOS Share Sheet ("Open in DownMe" & "Save to Photos") | M3, M4 | R3, survey |
| 30 | Standalone Maintenance Test Suite | Standalone runner (`scripts/test-maintenance.mjs`) reporting health per platform (R4) | M-TEST | R4, survey |
| 31 | 4-Tier E2E Test Suite | 55+ T1 Feature, 35+ T2 Boundary, 7+ T3 Pairwise, 6+ T4 Real-World scenarios | M-TEST, M5 | Project plan |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| **M-TEST** | **E2E Testing Track** | Standalone R4 Maintenance Test Runner (`scripts/test-maintenance.mjs`), live badge health tests, 1-click update check, and 4-tier E2E test suite (Tiers 1-4) with `TEST_READY.md`. | none | IN_PROGRESS |
| **M1** | **Backend Extraction & Streaming Engine** | FastAPI backend (`server/`), in-memory `yt-dlp` integration with Node.js JS solver, hybrid scrapers for TikTok photos & Pinterest photos/GIFs, FFmpeg 8.1.2 stream merger (1080p MP4), audio transcoder (320k MP3 + cover art), server trimmer, ZIP generator, `/api/health`, and `/api/system/update`. | none | IN_PROGRESS |
| **M2** | **Frontend Minimalist UI & Typography** | Thmanyah font setup (`public/fonts/`, `@font-face`), Apple design tokens (dark/light), responsive layout (375px-430px & 1280px+), URL input, in-app previewer, quality/format selectors (1080p default), trimmer slider UI, drag-and-drop, album gallery, footer health badges. | none | IN_PROGRESS |
| **M3** | **PWA, iOS Integration & Smart UX** | `manifest.webmanifest` (`share_target`), `sw.js` (cache-first fonts/shell, offline fallback), URL deep-link handling (`?url=...`), Dynamic Island clipboard prompt, iOS Apple Shortcut definition & guide (`DownMe.shortcut`). | M2 | PLANNED |
| **M4** | **Full-Stack Assembly & Wiring** | Unify frontend and backend on single server, wire API calls, real-time download streaming, clipboard events, trimmer download passing, health polling, and end-to-end user feedback. | M1, M2, M3 | PLANNED |
| **M5** | **Final Milestone: E2E Verification & Hardening** | Phase 1: Pass 100% of E2E Test Suite (Tiers 1-4). Phase 2: Adversarial Coverage Hardening (Tier 5) via Challenger loop. Forensic Integrity Audit. | M4, M-TEST | PLANNED |

---

## Interface Contracts

### Backend API ↔ Frontend Client

#### 1. `POST /api/extract`
- **Request Body**:
  ```json
  { "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
  ```
- **Response Body (200 OK)**:
  ```json
  {
    "success": true,
    "platform": "youtube" | "facebook" | "tiktok" | "pinterest",
    "id": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up",
    "author": "Rick Astley",
    "duration": 213,
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    "mediaType": "video" | "audio" | "photo" | "album",
    "formats": {
      "video": [
        { "formatId": "1080p", "label": "1080p Full HD", "ext": "mp4", "isDefault": true },
        { "formatId": "720p", "label": "720p HD", "ext": "mp4", "isDefault": false }
      ],
      "audio": [
        { "formatId": "mp3-320", "label": "MP3 High Quality (320 kbps)", "bitrate": 320, "ext": "mp3", "hasCoverArt": true },
        { "formatId": "m4a-aac", "label": "M4A / AAC (Apple Native)", "bitrate": 160, "ext": "m4a", "hasCoverArt": true }
      ]
    },
    "subtitles": [
      { "lang": "en", "label": "English", "ext": "srt" },
      { "lang": "ar", "label": "Arabic (العربية)", "ext": "srt" }
    ],
    "items": null,
    "canDownloadAsZip": false
  }
  ```

#### 2. `GET /api/download`
- **Query Parameters**:
  * `url`: Encoded media URL (string)
  * `formatId`: `1080p` | `720p` | `mp3-320` | `thumbnail` | `gif` | etc.
  * `mediaType`: `video` | `audio` | `photo` | `thumbnail`
  * `trimStart`: Optional timestamp (e.g. `00:00:15`)
  * `trimEnd`: Optional timestamp (e.g. `00:00:45`)
  * `embedCover`: `true` | `false`
- **Response**: Binary stream with headers:
  * `Content-Type`: `video/mp4` | `audio/mpeg` | `image/jpeg` | `image/gif`
  * `Content-Disposition`: `attachment; filename="<sanitized_filename>"`
  * `Transfer-Encoding: chunked`

#### 3. `POST /api/download/zip`
- **Request Body**:
  ```json
  {
    "albumTitle": "TikTok_Album_7106594",
    "items": [
      { "index": 1, "url": "https://...", "filename": "photo_01.jpg" },
      { "index": 2, "url": "https://...", "filename": "photo_02.jpg" }
    ]
  }
  ```
- **Response**: Binary `application/zip` stream with `Content-Disposition: attachment; filename="<album_name>.zip"`.

#### 4. `GET /api/health`
- **Response (200 OK)**:
  ```json
  {
    "status": "healthy",
    "version": "2026.10.26",
    "platforms": {
      "youtube": { "status": "operational", "latencyMs": 340 },
      "facebook": { "status": "operational", "latencyMs": 480 },
      "tiktok": { "status": "operational", "latencyMs": 290 },
      "pinterest": { "status": "operational", "latencyMs": 210 }
    }
  }
  ```

#### 5. `POST /api/system/update`
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "previousVersion": "2026.10.26",
    "currentVersion": "2026.10.26",
    "message": "yt-dlp is up to date"
  }
  ```

---

## Code Layout & File Ownership Boundaries

```
downme/
├── server/                                # Owned exclusively by M1 Worker
│   ├── __init__.py
│   ├── main.py                           # FastAPI application & route dispatcher
│   ├── config.py                         # App configuration, cookies, tool paths
│   ├── extractors/
│   │   ├── __init__.py
│   │   ├── base.py                       # Base extractor interface & regex matcher
│   │   ├── youtube.py                    # YouTube extractor (in-memory yt-dlp + Node JS runtime)
│   │   ├── facebook.py                   # Facebook & Reels extractor
│   │   ├── tiktok.py                     # TikTok watermark-free video & photo slideshow extractor
│   │   └── pinterest.py                  # Pinterest photo, video, GIF & Idea pin extractor
│   ├── services/
│   │   ├── __init__.py
│   │   ├── ffmpeg.py                     # FFmpeg 8.1.2 streaming merger, transcoder, and trimmer
│   │   ├── zip_service.py                # In-memory streaming ZIP archive builder
│   │   ├── health_service.py             # Platform probe & latency monitor
│   │   └── updater_service.py            # Self-healing yt-dlp package updater
│   └── utils/
│       ├── __init__.py
│       └── sanitizer.py                  # Filename sanitization (RFC 5987, Arabic, emoji-safe)
│
├── public/                                # Owned by M2 / M3 Workers
│   ├── fonts/                            # Thmanyah font files copied from asset directory
│   │   ├── thmanyahsans-Light.otf
│   │   ├── thmanyahsans-Regular.otf
│   │   ├── thmanyahsans-Medium.otf
│   │   ├── thmanyahsans-Bold.otf
│   │   └── thmanyahsans-Black.otf
│   ├── icons/                            # PWA app icons (192, 512, maskable, apple-touch)
│   ├── shortcuts/
│   │   └── DownMe.shortcut               # Apple Shortcut definition file
│   ├── manifest.webmanifest              # Web App Manifest with share_target
│   ├── sw.js                             # Service worker for offline caching
│   └── offline.html                      # Minimalist Apple-style offline fallback screen
│
├── src/                                  # Owned by M2 Worker
│   ├── css/
│   │   ├── apple-theme.css               # Design tokens, dark/light modes, glassmorphism
│   │   ├── thmanyah-typography.css       # @font-face rules, font hierarchy, fallbacks
│   │   └── components.css                # Button pills, trimmer sliders, cards, dynamic island
│   ├── js/
│   │   ├── app.js                        # Main application controller
│   │   ├── api.js                        # API client (extract, download, health, update)
│   │   ├── clipboard.js                  # Dynamic Island auto-clipboard detector
│   │   ├── preview.js                    # In-app media previewer (video, audio waveform, photo)
│   │   ├── trimmer.js                    # Video & audio trimmer dual-slider component
│   │   ├── dragdrop.js                   # Desktop/iPad drag & drop link overlay
│   │   ├── health.js                     # Footer live platform status badges
│   │   └── share-target.js               # ?url=... & ?text=... deep link handler
│   └── index.html                        # Main Apple-style minimalist SPA document
│
├── scripts/                              # Owned by M-TEST Worker
│   ├── test-maintenance.mjs              # Standalone R4 Maintenance Test Runner
│   └── copy_fonts.py                     # Asset synchronization script
│
├── tests/                                # Owned exclusively by M-TEST Worker
│   ├── e2e/
│   │   ├── tier1_features.spec.js        # 55+ Tier 1 Feature Tests
│   │   ├── tier2_boundaries.spec.js      # 35+ Tier 2 Boundary & Corner Cases
│   │   ├── tier3_combinations.spec.js    # Tier 3 Pairwise & Multi-Interaction Tests
│   │   └── tier4_real_world.spec.js      # Tier 4 Real-World Application Workflows
│   └── fixtures/                         # Mock responses & offline test data
│
├── TEST_INFRA.md                         # Owned by E2E Testing Track
├── TEST_READY.md                         # Published when E2E test suite is complete
└── PROJECT.md                            # Project Scope & Architecture (Orchestrator)
```
