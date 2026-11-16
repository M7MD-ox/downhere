/**
 * In-App Instant Media Previewer
 * Provides clean Apple-style playback for video, audio waveforms with album art,
 * and photo carousels / lightboxes for Pinterest and TikTok albums.
 */

export class MediaPreviewer {
  constructor() {
    this.container = document.getElementById('media-preview-card');
    this.videoWrapper = document.getElementById('preview-video-container');
    this.videoEl = document.getElementById('preview-video');
    
    this.audioWrapper = document.getElementById('preview-audio-container');
    this.audioThumb = document.getElementById('audio-preview-thumb');
    this.audioPlayBtn = document.getElementById('audio-play-toggle');
    this.audioSeek = document.getElementById('audio-seek-slider');
    this.audioCurrentTime = document.getElementById('audio-current-time');
    this.audioDuration = document.getElementById('audio-duration');
    this.audioEl = new Audio();
    
    this.photoWrapper = document.getElementById('preview-photo-container');
    this.photoImg = document.getElementById('preview-photo-img');
    this.carouselPrevBtn = document.getElementById('carousel-prev');
    this.carouselNextBtn = document.getElementById('carousel-next');
    this.carouselCounter = document.getElementById('carousel-counter');

    this.currentData = null;
    this.currentPhotoIndex = 0;
    this.photosList = [];
    this.trimEndLimit = null;
    this.fallbackVideoUrl = null;
    this.fallbackAudioUrl = null;

    this._bindVideoEvents();
    this._bindAudioEvents();
    this._bindCarouselEvents();
  }

  _bindVideoEvents() {
    if (!this.videoEl) return;

    this.videoEl.addEventListener('timeupdate', () => {
      if (this.trimEndLimit !== null && this.videoEl.currentTime >= this.trimEndLimit) {
        this.videoEl.pause();
        this.trimEndLimit = null;
      }
    });

    this.videoEl.addEventListener('error', () => {
      if (this.fallbackVideoUrl && this.videoEl.dataset.usedFallback !== '1') {
        this.videoEl.dataset.usedFallback = '1';
        this.videoEl.src = this.fallbackVideoUrl;
        this.videoEl.load();
      }
    });
  }

  _bindAudioEvents() {
    if (!this.audioPlayBtn) return;

    this.audioPlayBtn.addEventListener('click', () => {
      if (this.audioEl.paused) {
        this.audioEl.play().catch(() => {});
      } else {
        this.audioEl.pause();
      }
    });

    this.audioEl.addEventListener('play', () => {
      this._updateAudioPlayIcon(true);
    });

    this.audioEl.addEventListener('pause', () => {
      this._updateAudioPlayIcon(false);
    });

    this.audioEl.addEventListener('timeupdate', () => {
      if (this.trimEndLimit !== null && this.audioEl.currentTime >= this.trimEndLimit) {
        this.audioEl.pause();
        this.trimEndLimit = null;
      }
      if (!this.audioEl.duration) return;
      const progress = (this.audioEl.currentTime / this.audioEl.duration) * 100;
      if (this.audioSeek) this.audioSeek.value = progress;
      if (this.audioCurrentTime) {
        this.audioCurrentTime.textContent = this.formatTime(this.audioEl.currentTime);
      }
    });

    this.audioEl.addEventListener('error', () => {
      if (this.fallbackAudioUrl && this.audioEl.dataset.usedFallback !== '1') {
        this.audioEl.dataset.usedFallback = '1';
        this.audioEl.src = this.fallbackAudioUrl;
      }
    });

    this.audioEl.addEventListener('loadedmetadata', () => {
      if (this.audioDuration) {
        this.audioDuration.textContent = this.formatTime(this.audioEl.duration);
      }
    });

    if (this.audioSeek) {
      this.audioSeek.addEventListener('input', (e) => {
        if (!this.audioEl.duration) return;
        const targetTime = (e.target.value / 100) * this.audioEl.duration;
        this.audioEl.currentTime = targetTime;
      });
    }
  }

  _bindCarouselEvents() {
    if (this.carouselPrevBtn) {
      this.carouselPrevBtn.addEventListener('click', () => this.prevPhoto());
    }
    if (this.carouselNextBtn) {
      this.carouselNextBtn.addEventListener('click', () => this.nextPhoto());
    }
  }

  _updateAudioPlayIcon(isPlaying) {
    if (!this.audioPlayBtn) return;
    this.audioPlayBtn.innerHTML = isPlaying
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  }

  /**
   * Render the preview card for extracted media metadata.
   * @param {Object} data - Extraction payload
   */
  renderPreview(data, fallbackVideoUrl = null, fallbackAudioUrl = null) {
    this.currentData = data;
    this.resetPreview();
    this.fallbackVideoUrl = fallbackVideoUrl;
    this.fallbackAudioUrl = fallbackAudioUrl;

    if (!data) {
      if (this.container) this.container.classList.add('hidden');
      return;
    }

    if (this.container) this.container.classList.remove('hidden');

    // Title, Author, Platform badge
    const titleEl = document.getElementById('preview-title');
    const authorEl = document.getElementById('preview-author');
    const badgeEl = document.getElementById('preview-platform-badge');
    const durationBadge = document.getElementById('preview-duration-badge');

    if (titleEl) titleEl.textContent = data.title || 'Untitled Media';
    if (authorEl) authorEl.textContent = data.author ? `By ${data.author}` : '';

    if (badgeEl) {
      badgeEl.className = `platform-pill-badge ${data.platform || 'youtube'}`;
      badgeEl.textContent = data.platform || 'Media';
    }

    if (durationBadge) {
      if (data.duration && data.duration > 0) {
        durationBadge.textContent = this.formatTime(data.duration);
        durationBadge.classList.remove('hidden');
      } else {
        durationBadge.classList.add('hidden');
      }
    }

    // Determine preview player mode
    const mediaType = data.mediaType || 'video';
    const previewUrl = data.previewUrl || data.streamUrl;

    if (mediaType === 'video' || (data.formats?.video?.length && !data.items)) {
      this._renderVideoPreview(previewUrl, data.thumbnail);
    } else if (mediaType === 'audio') {
      this._renderAudioPreview(previewUrl, data.thumbnail, data.duration);
    } else if (mediaType === 'photo' || mediaType === 'album' || data.items?.length) {
      this._renderPhotoPreview(data.items || [{ url: data.thumbnail || previewUrl }]);
    } else {
      // Default to video preview or poster
      this._renderVideoPreview(previewUrl, data.thumbnail);
    }
  }

  _renderVideoPreview(src, poster) {
    if (this.videoWrapper) this.videoWrapper.classList.remove('hidden');
    if (this.audioWrapper) this.audioWrapper.classList.add('hidden');
    if (this.photoWrapper) this.photoWrapper.classList.add('hidden');

    if (this.videoEl) {
      this.videoEl.poster = poster || '';
      this.videoEl.dataset.usedFallback = '0';
      const chosenSrc = src || this.fallbackVideoUrl;
      if (chosenSrc) {
        if (!src) this.videoEl.dataset.usedFallback = '1';
        this.videoEl.src = chosenSrc;
      } else {
        this.videoEl.removeAttribute('src');
      }
    }
  }

  _renderAudioPreview(src, poster, duration) {
    if (this.videoWrapper) this.videoWrapper.classList.add('hidden');
    if (this.audioWrapper) this.audioWrapper.classList.remove('hidden');
    if (this.photoWrapper) this.photoWrapper.classList.add('hidden');

    if (this.audioThumb) {
      this.audioThumb.src = poster || '/icons/icon-192x192.png';
    }
    this.audioEl.dataset.usedFallback = '0';
    const chosenSrc = src || this.fallbackAudioUrl;
    if (chosenSrc) {
      if (!src) this.audioEl.dataset.usedFallback = '1';
      this.audioEl.src = chosenSrc;
    }
    if (this.audioDuration && duration) {
      this.audioDuration.textContent = this.formatTime(duration);
    }
  }

  switchViewMode(mode) {
    if (!this.currentData) return;
    const previewUrl = this.currentData.previewUrl || this.currentData.streamUrl;
    if (mode === 'photo') {
      this.pause();
      const items = this.currentData.items?.length
        ? this.currentData.items
        : [{ url: this.currentData.thumbnail || previewUrl }];
      this._renderPhotoPreview(items);
    } else if (mode === 'audio') {
      if (this.videoEl) this.videoEl.pause();
      if (this.currentData.formats?.audio?.length) {
        this._renderAudioPreview(previewUrl, this.currentData.thumbnail, this.currentData.duration);
      }
    } else if (mode === 'video') {
      if (this.audioEl) this.audioEl.pause();
      if (this.currentData.formats?.video?.length) {
        this._renderVideoPreview(previewUrl, this.currentData.thumbnail);
      }
    }
  }

  _renderPhotoPreview(items) {
    if (this.videoWrapper) this.videoWrapper.classList.add('hidden');
    if (this.audioWrapper) this.audioWrapper.classList.add('hidden');
    if (this.photoWrapper) this.photoWrapper.classList.remove('hidden');

    this.photosList = items || [];
    this.currentPhotoIndex = 0;
    this._updatePhotoView();
  }

  _updatePhotoView() {
    if (!this.photosList.length) return;
    const current = this.photosList[this.currentPhotoIndex];
    const imgUrl = typeof current === 'string' ? current : (current.url || current.thumbnail);

    if (this.photoImg) {
      this.photoImg.src = imgUrl;
    }

    if (this.carouselCounter) {
      this.carouselCounter.textContent = `${this.currentPhotoIndex + 1} / ${this.photosList.length}`;
      if (this.photosList.length <= 1) {
        this.carouselCounter.classList.add('hidden');
        if (this.carouselPrevBtn) this.carouselPrevBtn.classList.add('hidden');
        if (this.carouselNextBtn) this.carouselNextBtn.classList.add('hidden');
      } else {
        this.carouselCounter.classList.remove('hidden');
        if (this.carouselPrevBtn) this.carouselPrevBtn.classList.remove('hidden');
        if (this.carouselNextBtn) this.carouselNextBtn.classList.remove('hidden');
      }
    }
  }

  nextPhoto() {
    if (!this.photosList.length) return;
    this.currentPhotoIndex = (this.currentPhotoIndex + 1) % this.photosList.length;
    this._updatePhotoView();
  }

  prevPhoto() {
    if (!this.photosList.length) return;
    this.currentPhotoIndex = (this.currentPhotoIndex - 1 + this.photosList.length) % this.photosList.length;
    this._updatePhotoView();
  }

  /**
   * Seek video or audio to specific timestamp for trim preview.
   * @param {number} seconds
   */
  seekTo(seconds, play = true, endLimit = null) {
    this.trimEndLimit = endLimit !== undefined ? endLimit : null;

    if (this.videoEl && !this.videoWrapper.classList.contains('hidden')) {
      if (!this.videoEl.src && this.fallbackVideoUrl) {
        this.videoEl.src = this.fallbackVideoUrl;
      }
      const applySeekAndPlay = () => {
        this.videoEl.currentTime = seconds;
        if (play) {
          this.videoEl.play().catch(() => {});
        } else {
          this.videoEl.pause();
        }
      };
      if (this.videoEl.readyState >= 1) {
        applySeekAndPlay();
      } else {
        this.videoEl.addEventListener('loadedmetadata', applySeekAndPlay, { once: true });
        this.videoEl.load();
      }
    } else if (this.audioEl && !this.audioWrapper.classList.contains('hidden')) {
      if (!this.audioEl.src && this.fallbackAudioUrl) {
        this.audioEl.src = this.fallbackAudioUrl;
      }
      const applyAudioSeek = () => {
        this.audioEl.currentTime = seconds;
        if (play) {
          this.audioEl.play().catch(() => {});
        } else {
          this.audioEl.pause();
        }
      };
      if (this.audioEl.readyState >= 1) {
        applyAudioSeek();
      } else {
        this.audioEl.addEventListener('loadedmetadata', applyAudioSeek, { once: true });
        this.audioEl.load();
      }
    }
  }

  /**
   * Pause media playback at a given time or stop.
   */
  pause() {
    if (this.videoEl) this.videoEl.pause();
    if (this.audioEl) this.audioEl.pause();
  }

  /**
   * Get duration of current active media.
   * @returns {number}
   */
  getDuration() {
    if (this.currentData?.duration) return this.currentData.duration;
    if (this.videoEl && this.videoEl.duration) return this.videoEl.duration;
    if (this.audioEl && this.audioEl.duration) return this.audioEl.duration;
    return 0;
  }

  resetPreview() {
    this.trimEndLimit = null;
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.dataset.usedFallback = '0';
      this.videoEl.load();
    }
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.removeAttribute('src');
      this._updateAudioPlayIcon(false);
    }
    if (this.audioCurrentTime) this.audioCurrentTime.textContent = '00:00';
    if (this.audioSeek) this.audioSeek.value = 0;
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
    const totalSec = Math.floor(seconds);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
}

export const previewer = new MediaPreviewer();
