/**
 * Drag & Drop Link Overlay for Desktop and iPad
 * Allows dragging links directly from browser tabs, bookmarks, or social apps into DownMe.
 */

export class DragDropHandler {
  constructor() {
    this.overlay = document.getElementById('drag-drop-overlay');
    this.dragCounter = 0;
    this.onDropCallback = null;

    this._bindEvents();
  }

  /**
   * Register callback to invoke when a media URL is dropped.
   * @param {Function} callback - Function receiving clean URL string
   */
  init(callback) {
    this.onDropCallback = callback;
  }

  _bindEvents() {
    if (!this.overlay) return;

    window.addEventListener('dragenter', (e) => this._onDragEnter(e));
    window.addEventListener('dragover', (e) => this._onDragOver(e));
    window.addEventListener('dragleave', (e) => this._onDragLeave(e));
    window.addEventListener('drop', (e) => this._onDrop(e));
  }

  _onDragEnter(e) {
    e.preventDefault();
    this.dragCounter++;

    if (this._hasValidDragData(e)) {
      this.showOverlay();
    }
  }

  _onDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  _onDragLeave(e) {
    e.preventDefault();
    this.dragCounter--;

    if (this.dragCounter <= 0) {
      this.dragCounter = 0;
      this.hideOverlay();
    }
  }

  _onDrop(e) {
    e.preventDefault();
    this.dragCounter = 0;
    this.hideOverlay();

    if (!e.dataTransfer) return;

    let droppedText = '';
    // Check uri-list first (Safari/iOS/Chrome standard for dragged links)
    if (e.dataTransfer.types.includes('text/uri-list')) {
      droppedText = e.dataTransfer.getData('text/uri-list');
    } else if (e.dataTransfer.types.includes('text/plain')) {
      droppedText = e.dataTransfer.getData('text/plain');
    } else if (e.dataTransfer.types.includes('text/html')) {
      const html = e.dataTransfer.getData('text/html');
      const match = html.match(/href=["'](https?:\/\/[^"']+)["']/i);
      if (match) droppedText = match[1];
    }

    if (droppedText) {
      const cleanUrl = this.extractUrl(droppedText);
      if (cleanUrl && this.onDropCallback) {
        this.onDropCallback(cleanUrl);
      }
    }
  }

  _hasValidDragData(e) {
    if (!e.dataTransfer) return false;
    const types = Array.from(e.dataTransfer.types || []);
    return types.includes('text/uri-list') || types.includes('text/plain') || types.includes('text/html');
  }

  extractUrl(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/(https?:\/\/[^\s]+)/i);
    return match ? match[0].trim() : null;
  }

  showOverlay() {
    if (this.overlay) {
      this.overlay.classList.add('active');
    }
  }

  hideOverlay() {
    if (this.overlay) {
      this.overlay.classList.remove('active');
    }
  }
}

export const dragDrop = new DragDropHandler();
