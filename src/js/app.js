/**
 * DownMe Main Application Controller
 * Milestone M2: Frontend Minimalist UI & Thmanyah Typography
 */

import { api } from './api.js';
import { previewer } from './preview.js';
import { trimmer } from './trimmer.js';
import { dragDrop } from './dragdrop.js';
import { healthMonitor } from './health.js';
import { clipboardDetector, initClipboardDetector } from './clipboard.js';
import { shareTargetHandler, applyShareTarget } from './share-target.js';
import { muxVideoAndAudio, preloadFFmpeg } from './muxer.js';

export class DownMeApp {
  constructor() {
    // DOM Elements - Input & Controls
    this.brandRefreshBtn = document.getElementById('brand-refresh-btn');
    this.urlInput = document.getElementById('url-input');
    this.extractBtn = document.getElementById('extract-btn');
    this.clearBtn = document.getElementById('clear-btn');
    this.platformIcon = document.getElementById('platform-icon');
    this.statusMessage = document.getElementById('status-message');
    this.progressBar = document.getElementById('download-progress-bar');

    // DOM Elements - Preview & Options
    this.previewCard = document.getElementById('media-preview-card');
    this.formatTabs = document.querySelectorAll('.format-tab');
    this.videoQualitySection = document.getElementById('video-quality-section');
    this.audioQualitySection = document.getElementById('audio-quality-section');
    this.subtitlesSection = document.getElementById('subtitles-section');
    this.videoQualityPills = document.getElementById('video-quality-pills');
    this.audioQualityPills = document.getElementById('audio-quality-pills');
    this.subtitlesSelect = document.getElementById('subtitles-select');
    this.embedCoverCheckbox = document.getElementById('embed-cover-checkbox');
    this.downloadPrimaryBtn = document.getElementById('download-primary-btn');

    // Multi-photo Album
    this.albumSection = document.getElementById('album-gallery-container');
    this.albumGrid = document.getElementById('album-grid');
    this.downloadAlbumZipBtn = document.getElementById('download-album-zip-btn');
    this.selectAllPhotosBtn = document.getElementById('select-all-photos-btn');

    // Dynamic Island
    this.clipboardBanner = document.getElementById('clipboard-banner');
    this.clipboardUrlEl = document.getElementById('clipboard-url');
    this.clipboardDownloadBtn = document.getElementById('clipboard-download-btn');
    this.clipboardDismissBtn = document.getElementById('clipboard-dismiss-btn');
    this.clipboardIcon = document.getElementById('clipboard-icon');

    // Trimmer Toggle & Live Spotlight Status
    this.trimToggleBtn = document.getElementById('trim-toggle-btn');
    this.spotlightStatus = document.getElementById('spotlight-status');
    this.recentHistorySection = document.getElementById('recent-history-section');
    this.recentHistoryPills = document.getElementById('recent-history-pills');
    this.recentClearBtn = document.getElementById('recent-clear-btn');
    this._inputDebounceTimer = null;

    // State
    this.currentData = null;
    this.activeMediaType = 'video'; // 'video' | 'audio' | 'photo' | 'subtitles'
    this.selectedVideoFormat = '1080p';
    this.selectedAudioFormat = 'mp3-320';
    this.selectedSubtitleLang = '';
    this.selectedPhotoIndices = new Set();
    this.isExtracting = false;
    this.lastDetectedClipboard = '';
  }

  init() {
    this._initTheme();
    this._bindEvents();
    this._initDragDrop();
    this._renderRecentHistory();
    this._handleIncomingParams();
    this._checkClipboardOnFocus();
  }

  _initTheme() {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  _bindEvents() {
    if (this.brandRefreshBtn) {
      this.brandRefreshBtn.addEventListener('click', () => window.location.reload());
      this.brandRefreshBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.location.reload();
        }
      });
    }

    if (this.urlInput) {
      this.urlInput.addEventListener('input', () => this._onUrlInputChange());
      
      // Auto-extract immediately on paste (Ctrl+V, context menu paste, mobile paste)
      this.urlInput.addEventListener('paste', () => {
        setTimeout(() => {
          const val = (this.urlInput?.value || '').trim();
          if (val && this._isValidMediaUrl(val)) {
            this.startExtraction();
          }
        }, 80);
      });

      this.urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.startExtraction();
        }
      });
    }

    if (this.extractBtn) {
      this.extractBtn.addEventListener('click', () => this.startExtraction());
    }

    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => this._clearInput());
    }

    if (this.trimToggleBtn) {
      this.trimToggleBtn.addEventListener('click', () => {
        const opened = trimmer.toggleVisible();
        this.trimToggleBtn.classList.toggle('active', opened);
      });
    }

    // Format Tab Pills
    this.formatTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const type = tab.getAttribute('data-type');
        this.setMediaType(type);
      });
    });

    // Primary Download CTA
    if (this.downloadPrimaryBtn) {
      this.downloadPrimaryBtn.addEventListener('click', () => this._onDownloadClick());
    }

    // Album ZIP Button
    if (this.downloadAlbumZipBtn) {
      this.downloadAlbumZipBtn.addEventListener('click', () => this._downloadSelectedAlbumZip());
    }

    if (this.selectAllPhotosBtn) {
      this.selectAllPhotosBtn.addEventListener('click', () => this._toggleSelectAllPhotos());
    }
  }

  _initDragDrop() {
    dragDrop.init((droppedUrl) => {
      if (this.urlInput) {
        this.urlInput.value = droppedUrl;
        this._onUrlInputChange();
        this.startExtraction();
      }
    });
  }

  _onUrlInputChange() {
    const val = (this.urlInput?.value || '').trim();

    if (this.clearBtn) {
      this.clearBtn.classList.toggle('hidden', val.length === 0);
    }

    this._detectAndDisplayPlatform(val);

    // Auto-extract when a full supported URL is entered/pasted
    if (this._inputDebounceTimer) clearTimeout(this._inputDebounceTimer);
    if (val && this._isValidMediaUrl(val) && !this.isExtracting) {
      this._inputDebounceTimer = setTimeout(() => {
        if (this.urlInput?.value.trim() === val && !this.isExtracting && !this.currentData) {
          this.startExtraction();
        }
      }, 500);
    }
  }

  _isValidMediaUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) return false;
    try {
      const parsed = new URL(clean);
      return Boolean(parsed.hostname && parsed.hostname.includes('.'));
    } catch {
      return false;
    }
  }

  _detectAndDisplayPlatform(url) {
    if (!this.platformIcon) return;

    let platform = 'generic';
    if (/youtube\.com|youtu\.be/i.test(url)) {
      platform = 'youtube';
    } else if (/facebook\.com|fb\.watch/i.test(url)) {
      platform = 'facebook';
    } else if (/tiktok\.com/i.test(url)) {
      platform = 'tiktok';
    } else if (/pinterest\.com|pin\.it/i.test(url)) {
      platform = 'pinterest';
    }

    this.platformIcon.className = `spotlight-platform-icon platform-${platform}`;
    this.platformIcon.innerHTML = this._getPlatformSvg(platform);
  }

  _getPlatformSvg(platform) {
    switch (platform) {
      case 'youtube':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
      case 'facebook':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`;
      case 'tiktok':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`;
      case 'pinterest':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0a12 12 0 0 0-4.37 23.18c-.07-.99-.13-2.52.03-3.61l.9-3.81s-.23-.46-.23-1.14c0-1.07.62-1.87 1.39-1.87.66 0 .97.49.97 1.08 0 .66-.42 1.65-.64 2.56-.18.77.38 1.39 1.14 1.39 1.37 0 2.42-1.45 2.42-3.54 0-1.85-1.33-3.15-3.23-3.15-2.2 0-3.49 1.65-3.49 3.35 0 .66.26 1.38.58 1.77a.3.3 0 0 1 .07.29c-.08.33-.26 1.06-.3 1.2-.05.21-.17.26-.39.16-1.44-.67-2.34-2.77-2.34-4.46 0-3.63 2.64-6.97 7.61-6.97 4 0 7.11 2.85 7.11 6.66 0 3.97-2.5 7.17-5.98 7.17-1.17 0-2.27-.61-2.64-1.33l-.72 2.75c-.26 1.01-.97 2.27-1.44 3.05A12 12 0 1 0 12 0z"/></svg>`;
      default:
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
    }
  }

  async _handlePasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        this.urlInput.value = text.trim();
        this._onUrlInputChange();
        this.startExtraction();
      }
    } catch {
      this._setStatus('Please paste the URL directly into the field.', 'error');
    }
  }

  _clearInput() {
    if (this.urlInput) {
      this.urlInput.value = '';
      this._onUrlInputChange();
      this.urlInput.focus();
    }
    this.resetState();
  }

  _handleIncomingParams() {
    // 1. Try specialized Web Share Target & deep link consumer
    if (typeof applyShareTarget === 'function') {
      const handled = applyShareTarget();
      if (handled) return;
    }

    // 2. Direct fallback URL parsing
    const params = new URLSearchParams(window.location.search);
    const incomingUrl = params.get('url') || params.get('text') || params.get('link');
    if (incomingUrl) {
      const clean = this._extractFirstUrl(incomingUrl);
      if (clean && this.urlInput) {
        this.urlInput.value = clean;
        this._onUrlInputChange();
        // Clean URL from address bar without reloading
        window.history.replaceState({}, document.title, window.location.pathname);
        this.startExtraction();
      }
    }
  }

  _extractFirstUrl(str) {
    if (!str) return null;
    const match = str.match(/(https?:\/\/[^\s]+)/i);
    return match ? match[0].trim() : null;
  }

  async _checkClipboardOnFocus() {
    // Initialize specialized Dynamic Island clipboard detector (handles focus/visibilitychange)
    if (typeof initClipboardDetector === 'function') {
      initClipboardDetector();
    }
  }

  showClipboardBanner(url) {
    this.lastDetectedClipboard = url;
    if (clipboardDetector && typeof clipboardDetector.showBanner === 'function') {
      clipboardDetector.showBanner(url, this._detectPlatformName(url));
    } else {
      if (!this.clipboardBanner) return;
      if (this.clipboardUrlEl) {
        this.clipboardUrlEl.textContent = url;
      }
      this.clipboardBanner.classList.add('active');
      setTimeout(() => {
        this.hideClipboardBanner();
      }, 8000);
    }
  }

  hideClipboardBanner() {
    if (clipboardDetector && typeof clipboardDetector.hideBanner === 'function') {
      clipboardDetector.hideBanner();
    }
    if (this.clipboardBanner) {
      this.clipboardBanner.classList.remove('active');
    }
  }

  _detectPlatformName(url) {
    if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
    if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
    if (/tiktok\.com/i.test(url)) return 'tiktok';
    if (/pinterest\.com|pin\.it/i.test(url)) return 'pinterest';
    if (/instagram\.com/i.test(url)) return 'instagram';
    if (/(?:^|\.)(?:x|twitter)\.com/i.test(url)) return 'twitter';
    return 'generic';
  }

  /**
   * Main media extraction workflow.
   */
  async startExtraction() {
    const url = (this.urlInput?.value || '').trim();
    if (!url) {
      this._setStatus('Please enter or paste a media link.', 'error');
      return;
    }

    if (this.isExtracting) return;
    this.isExtracting = true;
    this._setExtractingState(true);
    this._setStatus('Analyzing and extracting media streams...', 'loading');

    try {
      const data = await api.extractMedia(url);
      this.currentData = data;
      this._setStatus('', '');
      this._populateExtractedData(data);
      this._saveRecentItem(url, data);
    } catch (err) {
      this.resetState(false);
      const errorMsg = err.message || 'Extraction failed. Please check the URL.';
      this._setStatus(errorMsg, 'error');
    } finally {
      this.isExtracting = false;
      this._setExtractingState(false);
    }
  }

  _setExtractingState(loading) {
    if (this.extractBtn) {
      this.extractBtn.disabled = loading;
      this.extractBtn.innerHTML = loading
        ? `<svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Extracting...`
        : `Extract`;
    }
  }

  _populateExtractedData(data) {
    const originalUrl = (this.urlInput?.value || '').trim();
    const defaultVideoFmt = (data.formats?.video?.find(v => v.formatId === '1080p' || v.isDefault) || data.formats?.video?.[0])?.formatId || '1080p';
    const defaultAudioFmt = (data.formats?.audio?.find(a => a.formatId === 'mp3-320') || data.formats?.audio?.[0])?.formatId || 'mp3-320';
    const fallbackVideoUrl = data.formats?.video?.length && originalUrl
      ? api.buildDownloadUrl({ url: originalUrl, formatId: defaultVideoFmt, mediaType: 'video' })
      : null;
    const fallbackAudioUrl = data.formats?.audio?.length && originalUrl
      ? api.buildDownloadUrl({ url: originalUrl, formatId: defaultAudioFmt, mediaType: 'audio' })
      : null;

    // 1. Render in-app preview with fallback stream URLs for trim preview
    previewer.renderPreview(data, fallbackVideoUrl, fallbackAudioUrl);

    if (data.formats?.video?.some(v => v.muxed === false)) {
      preloadFFmpeg();
    }

    // 2. Setup dynamic format tabs based on what this link actually has
    const hasVideo = Boolean(data.formats?.video?.length);
    const hasAudio = Boolean(data.formats?.audio?.length);
    const hasPhotos = Boolean(data.items?.length || data.mediaType === 'photo' || data.mediaType === 'album' || data.thumbnail);
    const hasSubtitles = Boolean(data.subtitles?.length);

    this.formatTabs.forEach((tab) => {
      const type = tab.getAttribute('data-type');
      if (type === 'video') {
        tab.classList.toggle('hidden', !hasVideo);
        tab.textContent = data.platform === 'tiktok' ? 'Video (No Watermark)' : 'Video (MP4)';
      } else if (type === 'audio') {
        tab.classList.toggle('hidden', !hasAudio);
        tab.textContent = 'Audio (MP3)';
      } else if (type === 'photo') {
        tab.classList.toggle('hidden', !hasPhotos);
        tab.textContent = data.items?.length > 1
          ? `Photos (${data.items.length})`
          : (data.mediaType === 'photo' ? 'Photo' : 'Thumbnail (JPG)');
      } else if (type === 'subtitles') {
        tab.classList.toggle('hidden', !hasSubtitles);
        tab.textContent = hasSubtitles ? `Subtitles (${data.subtitles.length})` : 'Subtitles';
      }
    });

    // Populate Video Qualities (1080p default when present)
    if (this.videoQualityPills && data.formats?.video) {
      this.videoQualityPills.innerHTML = '';
      const preferredFmt =
        data.formats.video.find(v => v.formatId === '1080p') ||
        data.formats.video.find(v => v.isDefault) ||
        data.formats.video[0];

      data.formats.video.forEach((fmt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quality-pill';
        const sizeMb = fmt.filesizeApprox
          ? ` (${(fmt.filesizeApprox / (1024 * 1024)).toFixed(1)} MB)`
          : '';
        btn.textContent = `${fmt.label || fmt.formatId}${sizeMb}`;
        btn.setAttribute('data-format-id', fmt.formatId);

        if (preferredFmt && fmt.formatId === preferredFmt.formatId) {
          btn.classList.add('active');
          this.selectedVideoFormat = fmt.formatId;
        }

        btn.addEventListener('click', () => {
          this.videoQualityPills.querySelectorAll('.quality-pill').forEach(p => p.classList.remove('active'));
          btn.classList.add('active');
          this.selectedVideoFormat = fmt.formatId;
        });

        this.videoQualityPills.appendChild(btn);
      });
    }

    // Populate Audio Qualities (320kbps MP3 default)
    if (this.audioQualityPills && data.formats?.audio) {
      this.audioQualityPills.innerHTML = '';
      data.formats.audio.forEach((fmt, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quality-pill';
        btn.textContent = fmt.label || fmt.formatId;
        btn.setAttribute('data-format-id', fmt.formatId);

        if (fmt.formatId === 'mp3-320' || idx === 0) {
          btn.classList.add('active');
          this.selectedAudioFormat = fmt.formatId;
        }

        btn.addEventListener('click', () => {
          this.audioQualityPills.querySelectorAll('.quality-pill').forEach(p => p.classList.remove('active'));
          btn.classList.add('active');
          this.selectedAudioFormat = fmt.formatId;
        });

        this.audioQualityPills.appendChild(btn);
      });
    }

    // Populate Subtitles
    if (this.subtitlesSelect) {
      this.subtitlesSelect.innerHTML = '<option value="">None / Off</option>';
      if (data.subtitles) {
        data.subtitles.forEach((sub, idx) => {
          const opt = document.createElement('option');
          opt.value = sub.lang;
          opt.dataset.ext = sub.ext || 'srt';
          opt.textContent = `${sub.label || sub.lang} (.${sub.ext || 'srt'})`;
          if (idx === 0) opt.selected = true;
          this.subtitlesSelect.appendChild(opt);
        });
      }
    }

    // Initialize Trimmer (hidden by default; toggle button opens it)
    if (this.trimToggleBtn) {
      this.trimToggleBtn.classList.remove('active');
    }
    if (data.duration && data.duration > 2) {
      trimmer.init(data.duration, (seekSec, play = true, endLimit = null) => {
        previewer.seekTo(seekSec, play, endLimit);
      });
      if (this.trimToggleBtn) this.trimToggleBtn.classList.remove('hidden');
    } else {
      trimmer.reset();
      if (this.trimToggleBtn) this.trimToggleBtn.classList.add('hidden');
    }

    // Default media type tab after controls are ready
    if (hasVideo) {
      this.setMediaType('video');
    } else if (hasPhotos) {
      this.setMediaType('photo');
    } else if (hasAudio) {
      this.setMediaType('audio');
    }

    // Multi-photo Album Gallery
    if (hasPhotos && data.items && data.items.length > 1) {
      this._renderAlbumGallery(data.items);
    } else if (this.albumSection) {
      this.albumSection.classList.add('hidden');
    }
  }

  setMediaType(type) {
    this.activeMediaType = type;

    this.formatTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-type') === type);
    });

    if (this.videoQualitySection) {
      this.videoQualitySection.classList.toggle('hidden', type !== 'video' || !this.currentData?.formats?.video?.length);
    }
    if (this.audioQualitySection) {
      this.audioQualitySection.classList.toggle('hidden', type !== 'audio' || !this.currentData?.formats?.audio?.length);
    }
    if (this.subtitlesSection) {
      this.subtitlesSection.classList.toggle('hidden', type !== 'subtitles' || !this.currentData?.subtitles?.length);
    }

    // Sync previewer player with active tab (e.g. clicking Thumbnail tab previews thumbnail image)
    previewer.switchViewMode(type);

    // Keep trimmer collapsed by default; show only the toggle button when video/audio has duration > 2s
    const canTrim = (type === 'video' || type === 'audio') && (this.currentData?.duration > 2);
    if (this.trimToggleBtn) {
      this.trimToggleBtn.classList.toggle('hidden', !canTrim);
    }
    if (!canTrim) {
      trimmer.setVisible(false);
      if (this.trimToggleBtn) this.trimToggleBtn.classList.remove('active');
    }
  }

  _renderAlbumGallery(items) {
    if (!this.albumSection || !this.albumGrid) return;
    this.albumSection.classList.remove('hidden');
    this.albumGrid.innerHTML = '';
    this.selectedPhotoIndices.clear();

    items.forEach((item, index) => {
      this.selectedPhotoIndices.add(index);

      const tile = document.createElement('div');
      tile.className = 'album-photo-tile selected';
      tile.setAttribute('data-index', String(index));

      const img = document.createElement('img');
      img.src = item.thumbnail || item.url;
      img.alt = `Photo ${index + 1}`;
      img.loading = 'lazy';

      const overlay = document.createElement('div');
      overlay.className = 'album-tile-overlay';
      overlay.innerHTML = `<div class="album-tile-checkbox"></div>`;

      tile.appendChild(img);
      tile.appendChild(overlay);

      tile.addEventListener('click', () => {
        if (this.selectedPhotoIndices.has(index)) {
          this.selectedPhotoIndices.delete(index);
          tile.classList.remove('selected');
        } else {
          this.selectedPhotoIndices.add(index);
          tile.classList.add('selected');
          previewer.goToPhoto(index);
        }
        this._updateAlbumZipButtonText();
      });

      this.albumGrid.appendChild(tile);
    });

    this._updateAlbumZipButtonText();
  }

  _toggleSelectAllPhotos() {
    if (!this.currentData?.items) return;
    const allSelected = this.selectedPhotoIndices.size === this.currentData.items.length;

    const tiles = this.albumGrid.querySelectorAll('.album-photo-tile');
    if (allSelected) {
      this.selectedPhotoIndices.clear();
      tiles.forEach(t => t.classList.remove('selected'));
    } else {
      this.selectedPhotoIndices.clear();
      this.currentData.items.forEach((_, idx) => this.selectedPhotoIndices.add(idx));
      tiles.forEach(t => t.classList.add('selected'));
    }
    this._updateAlbumZipButtonText();
  }

  _updateAlbumZipButtonText() {
    if (!this.downloadAlbumZipBtn) return;
    const count = this.selectedPhotoIndices.size;
    this.downloadAlbumZipBtn.disabled = count === 0;
    this.downloadAlbumZipBtn.textContent = count === 1
      ? 'Download Selected Photo (1)'
      : `Download Selected as ZIP (${count} Photos)`;
  }

  async _downloadSelectedAlbumZip() {
    if (!this.currentData?.items || !this.selectedPhotoIndices.size) return;

    const selectedEntries = this.currentData.items
      .map((item, idx) => ({ item, idx }))
      .filter(({ idx }) => this.selectedPhotoIndices.has(idx));

    if (selectedEntries.length === 1) {
      const originalUrl = (this.urlInput?.value || '').trim();
      const targetIdx = selectedEntries[0].idx;
      this._setStatus('', '');
      api.triggerDownload({
        url: originalUrl,
        formatId: 'original',
        mediaType: 'photo',
        itemIndex: targetIdx
      });
      return;
    }

    const selectedItems = selectedEntries.map(({ item }) => item);
    this._setStatus('Packaging selected high-res photos into ZIP...', '');

    try {
      await api.downloadAlbumZip(this.currentData.title || 'downhere_Album', selectedItems);
      this._setStatus('ZIP download started!', 'success');
    } catch (err) {
      this._setStatus(err.message || 'ZIP download failed.', 'error');
    }
  }

  _onDownloadClick() {
    if (!this.currentData) {
      this._setStatus('Please extract a link first.', 'error');
      return;
    }

    const originalUrl = (this.urlInput?.value || '').trim();
    const trimInfo = trimmer.getTrimRange();

    let formatId = this.selectedVideoFormat;
    let mediaType = this.activeMediaType;
    let subtitleLang = null;
    let subtitleExt = 'srt';
    let itemIndex = null;

    if (mediaType === 'audio') {
      formatId = this.selectedAudioFormat;
    } else if (mediaType === 'photo') {
      const isThumb = this.currentData.mediaType !== 'photo' && !this.currentData.items?.length;
      mediaType = isThumb ? 'thumbnail' : 'photo';
      formatId = isThumb ? 'thumbnail' : 'original';
      if (!isThumb && this.currentData.items?.length) {
        itemIndex = this.selectedPhotoIndices.size === 1
          ? Array.from(this.selectedPhotoIndices)[0]
          : (previewer.currentPhotoIndex || 0);
      }
    } else if (mediaType === 'subtitles') {
      const selectedOpt = this.subtitlesSelect?.selectedOptions?.[0];
      const lang = this.subtitlesSelect?.value;
      if (!lang) {
        this._setStatus('Please choose a subtitle language.', 'error');
        return;
      }
      formatId = lang;
      subtitleLang = lang;
      subtitleExt = selectedOpt?.dataset?.ext || 'srt';
    }

    const embedCover = this.embedCoverCheckbox ? this.embedCoverCheckbox.checked : true;

    // If YouTube/adaptive video has no audio track (muxed === false) and an audio stream exists,
    // merge video + audio directly in the browser via FFmpeg WASM.
    const selectedVideoFmt = mediaType === 'video'
      ? (this.currentData.formats?.video || []).find(v => v.formatId === formatId)
      : null;
    const bestAudioFmt = (this.currentData.formats?.audio || []).find(a => a.ext === 'm4a')
      || this.currentData.formats?.audio?.[0];

    if (mediaType === 'video' && selectedVideoFmt?.muxed === false && bestAudioFmt) {
      const videoUrl = api.buildDownloadUrl({ url: originalUrl, formatId, mediaType: 'video' });
      const audioUrl = api.buildDownloadUrl({ url: originalUrl, formatId: bestAudioFmt.formatId, mediaType: 'audio' });
      if (this.downloadPrimaryBtn) this.downloadPrimaryBtn.disabled = true;
      this._setStatus('Preparing HD video + audio merge...', 'loading');
      muxVideoAndAudio({
        videoUrl,
        audioUrl,
        title: this.currentData.title || 'downhere_video',
        trimStart: trimInfo.trimStart,
        trimEnd: trimInfo.trimEnd,
        onProgress: (msg) => this._setStatus(msg, 'loading'),
      })
        .then(() => {
          this._showDownloadStartedFeedback('HD Video + Audio download started!');
        })
        .catch(() => {
          api.triggerDownload({
            url: originalUrl,
            formatId,
            mediaType,
            trimStart: trimInfo.trimStart,
            trimEnd: trimInfo.trimEnd,
            embedCover,
            subtitleLang,
            subtitleExt,
            itemIndex,
          });
          this._showDownloadStartedFeedback('Video download started!');
        })
        .finally(() => {
          if (this.downloadPrimaryBtn) this.downloadPrimaryBtn.disabled = false;
        });
      return;
    }

    const typeLabels = {
      audio: 'Audio download started!',
      thumbnail: 'Thumbnail download started!',
      photo: 'Image download started!',
      subtitles: 'Subtitles download started!',
      video: 'Video download started!',
    };
    api.triggerDownload({
      url: originalUrl,
      formatId: formatId,
      mediaType: mediaType,
      trimStart: (mediaType === 'video' || mediaType === 'audio') ? trimInfo.trimStart : null,
      trimEnd: (mediaType === 'video' || mediaType === 'audio') ? trimInfo.trimEnd : null,
      embedCover: embedCover,
      subtitleLang: subtitleLang,
      subtitleExt: subtitleExt,
      itemIndex: itemIndex
    });
    this._showDownloadStartedFeedback(typeLabels[mediaType] || 'Download started!');
  }

  _showDownloadStartedFeedback(message = 'Download started!') {
    this._setStatus(message, 'success');
    if (this.downloadPrimaryBtn) {
      this.downloadPrimaryBtn.textContent = 'Download Started ✓';
      clearTimeout(this._downloadBtnResetTimer);
      this._downloadBtnResetTimer = setTimeout(() => {
        if (this.downloadPrimaryBtn) {
          this.downloadPrimaryBtn.textContent = 'Download';
        }
      }, 2500);
    }
  }

  _setStatus(msg, type = '') {
    if (this.statusMessage) {
      this.statusMessage.textContent = msg;
      this.statusMessage.className = `status-message ${type}`;
    }

    if (this.spotlightStatus) {
      if (!msg) {
        this.spotlightStatus.classList.add('hidden');
        this.spotlightStatus.innerHTML = '';
      } else {
        this.spotlightStatus.classList.remove('hidden');
        this.spotlightStatus.className = `spotlight-status ${type}`;

        let iconSvg = '';
        if (type === 'loading') {
          iconSvg = `<svg class="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
        } else if (type === 'error') {
          iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
        } else if (type === 'success') {
          iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>`;
        } else {
          iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
        }

        this.spotlightStatus.innerHTML = `
          <div class="status-icon">${iconSvg}</div>
          <div class="status-text">${this._escapeHtml(msg)}</div>
        `;
      }
    }
  }

  _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  resetState(clearStatus = true) {
    this.currentData = null;
    this.selectedPhotoIndices.clear();
    previewer.resetPreview();
    trimmer.reset();
    if (this.trimToggleBtn) {
      this.trimToggleBtn.classList.add('hidden');
      this.trimToggleBtn.classList.remove('active');
    }
    if (this.previewCard) this.previewCard.classList.add('hidden');
    if (this.albumSection) this.albumSection.classList.add('hidden');
    if (clearStatus) {
      this._setStatus('', '');
    }
  }

  _loadRecentHistory() {
    try {
      const raw = localStorage.getItem('downme_recent_v1');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _saveRecentItem(url, data) {
    if (!url || !data) return;
    try {
      const list = this._loadRecentHistory().filter((item) => item.url !== url);
      list.unshift({
        url,
        title: (data.title || url).slice(0, 60),
        platform: data.platform || this._detectPlatformName(url),
        ts: Date.now(),
      });
      localStorage.setItem('downme_recent_v1', JSON.stringify(list.slice(0, 8)));
      this._renderRecentHistory();
    } catch {
      // Ignore storage quota / private mode errors
    }
  }

  _clearRecentHistory() {
    try {
      localStorage.removeItem('downme_recent_v1');
    } catch {
      // Ignore
    }
    this._renderRecentHistory();
  }

  _renderRecentHistory() {
    if (!this.recentHistorySection || !this.recentHistoryPills) return;
    if (this.recentClearBtn && !this.recentClearBtn.dataset.bound) {
      this.recentClearBtn.dataset.bound = '1';
      this.recentClearBtn.addEventListener('click', () => this._clearRecentHistory());
    }

    const items = this._loadRecentHistory();
    this.recentHistoryPills.innerHTML = '';
    this.recentHistorySection.classList.remove('hidden');

    if (items.length === 0) {
      if (this.recentClearBtn) this.recentClearBtn.classList.add('hidden');
      const emptyEl = document.createElement('span');
      emptyEl.className = 'recent-empty-text';
      emptyEl.textContent = 'No recent links yet';
      this.recentHistoryPills.appendChild(emptyEl);
      return;
    }

    if (this.recentClearBtn) this.recentClearBtn.classList.remove('hidden');

    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'recent-pill';
      btn.title = item.url;

      const plat = document.createElement('span');
      plat.className = 'recent-pill-platform';
      plat.textContent = item.platform || 'link';

      const title = document.createElement('span');
      title.className = 'recent-pill-title';
      title.textContent = item.title || item.url;

      btn.appendChild(plat);
      btn.appendChild(title);
      btn.addEventListener('click', () => {
        if (this.urlInput) {
          this.urlInput.value = item.url;
          this._onUrlInputChange();
          this.startExtraction();
        }
      });
      this.recentHistoryPills.appendChild(btn);
    });

    this.recentHistorySection.classList.remove('hidden');
  }
}

// Auto-instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  const app = new DownMeApp();
  window.downmeApp = app;
  app.init();
});

// Global module registry for inspection and testing
if (typeof window !== 'undefined') {
  window.downme = {
    api,
    previewer,
    trimmer,
    dragDrop,
    healthMonitor,
    clipboardDetector,
    shareTargetHandler,
    get app() {
      return window.downmeApp;
    },
  };
}
