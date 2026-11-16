/**
 * Video & Audio Trimmer Dual Slider Component
 * Provides visual start and end timecode controls for server-side FFmpeg stream cutting.
 */

export class MediaTrimmer {
  constructor() {
    this.container = document.getElementById('trimmer-container');
    this.startInput = document.getElementById('trim-start-range');
    this.endInput = document.getElementById('trim-end-range');
    this.sliderHighlight = document.getElementById('trim-slider-highlight');
    this.startTimeDisplay = document.getElementById('trim-start-time');
    this.endTimeDisplay = document.getElementById('trim-end-time');
    this.durationDisplay = document.getElementById('trim-duration-display');
    this.previewTrimBtn = document.getElementById('preview-trim-btn');

    this.duration = 0;
    this.startSec = 0;
    this.endSec = 0;
    this.onSeekCallback = null;
    this.previewTimeoutId = null;

    this._bindEvents();
  }

  _bindEvents() {
    if (this.startInput && this.endInput) {
      this.startInput.addEventListener('input', () => this._onStartChange());
      this.endInput.addEventListener('input', () => this._onEndChange());
    }

    if (this.previewTrimBtn) {
      this.previewTrimBtn.addEventListener('click', () => this.previewTrimSegment());
    }
  }

  /**
   * Initialize trimmer with total media duration in seconds.
   * @param {number} duration - Total duration in seconds
   * @param {Function} [onSeek] - Callback to seek preview player
   */
  init(duration, onSeek = null) {
    this.duration = Math.max(0, Math.floor(duration || 0));
    this.onSeekCallback = onSeek;

    if (this.duration <= 2) {
      this.setVisible(false);
      return;
    }

    this.startSec = 0;
    this.endSec = this.duration;

    if (this.startInput) {
      this.startInput.min = '0';
      this.startInput.max = String(this.duration);
      this.startInput.value = '0';
    }

    if (this.endInput) {
      this.endInput.min = '0';
      this.endInput.max = String(this.duration);
      this.endInput.value = String(this.duration);
    }

    this._updateUI();
    // Stay hidden by default until toggled open
    this.setVisible(false);
  }

  toggleVisible() {
    if (!this.container) return false;
    const isHidden = this.container.classList.contains('hidden');
    this.setVisible(isHidden);
    return isHidden;
  }

  _onStartChange() {
    let startVal = parseFloat(this.startInput.value);
    let endVal = parseFloat(this.endInput.value);

    // Prevent start handle from passing end handle (minimum 1 second apart)
    if (startVal >= endVal) {
      startVal = Math.max(0, endVal - 1);
      this.startInput.value = String(startVal);
    }

    this.startSec = startVal;
    this._updateUI();

    if (this.onSeekCallback) {
      this.onSeekCallback(this.startSec);
    }
  }

  _onEndChange() {
    let startVal = parseFloat(this.startInput.value);
    let endVal = parseFloat(this.endInput.value);

    // Prevent end handle from passing start handle
    if (endVal <= startVal) {
      endVal = Math.min(this.duration, startVal + 1);
      this.endInput.value = String(endVal);
    }

    this.endSec = endVal;
    this._updateUI();

    if (this.onSeekCallback) {
      this.onSeekCallback(this.endSec);
    }
  }

  _updateUI() {
    if (!this.duration) return;

    // Calculate percentages for highlight bar
    const leftPercent = (this.startSec / this.duration) * 100;
    const rightPercent = (this.endSec / this.duration) * 100;
    const widthPercent = rightPercent - leftPercent;

    if (this.sliderHighlight) {
      this.sliderHighlight.style.left = `${leftPercent}%`;
      this.sliderHighlight.style.width = `${widthPercent}%`;
    }

    const startStr = this.formatTime(this.startSec);
    const endStr = this.formatTime(this.endSec);
    const selectedSec = Math.max(0, this.endSec - this.startSec);

    if (this.startTimeDisplay) this.startTimeDisplay.textContent = startStr;
    if (this.endTimeDisplay) this.endTimeDisplay.textContent = endStr;
    if (this.durationDisplay) {
      this.durationDisplay.textContent = `Selected: ${this.formatTime(selectedSec)} (original: ${this.formatTime(this.duration)})`;
    }
  }

  /**
   * Preview trimmed segment in media player.
   */
  previewTrimSegment() {
    if (!this.onSeekCallback) return;

    if (this.previewTimeoutId) {
      clearTimeout(this.previewTimeoutId);
      this.previewTimeoutId = null;
    }

    // Play strictly from startSec to endSec via previewer trimEndLimit + backup timer
    this.onSeekCallback(this.startSec, true, this.endSec);

    const playDurationMs = Math.max(500, (this.endSec - this.startSec) * 1000);
    this.previewTimeoutId = setTimeout(() => {
      if (this.onSeekCallback) {
        this.onSeekCallback(this.endSec, false, null);
      }
    }, playDurationMs + 250);
  }

  /**
   * Get trimmed time parameters.
   * @returns {{ trimStart: string|null, trimEnd: string|null, isTrimmed: boolean }}
   */
  getTrimRange() {
    if (this.duration <= 0 || (this.startSec === 0 && this.endSec >= this.duration)) {
      return { trimStart: null, trimEnd: null, isTrimmed: false };
    }

    return {
      trimStart: this.formatTimecodeHHMMSS(this.startSec),
      trimEnd: this.formatTimecodeHHMMSS(this.endSec),
      isTrimmed: true
    };
  }

  setVisible(visible) {
    if (this.container) {
      if (visible) {
        this.container.classList.remove('hidden');
      } else {
        this.container.classList.add('hidden');
      }
    }
  }

  reset() {
    this.duration = 0;
    this.startSec = 0;
    this.endSec = 0;
    if (this.previewTimeoutId) {
      clearTimeout(this.previewTimeoutId);
      this.previewTimeoutId = null;
    }
    this.setVisible(false);
  }

  formatTime(seconds) {
    const s = Math.floor(seconds || 0);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  formatTimecodeHHMMSS(seconds) {
    const s = Math.floor(seconds || 0);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
}

export const trimmer = new MediaTrimmer();
