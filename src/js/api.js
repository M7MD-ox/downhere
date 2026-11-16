/**
 * DownMe API Client
 * Interfaces with backend endpoints for media extraction, streaming downloads,
 * multi-photo ZIP bundling, system health probes, and updater.
 */

export class ApiClient {
  constructor(baseUrl = '') {
    let customUrl = '';
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const paramUrl = params.get('backend_url');
        if (paramUrl) {
          customUrl = paramUrl;
          window.localStorage.setItem('downme_backend_url', paramUrl);
        } else {
          customUrl = window.localStorage.getItem('downme_backend_url') || '';
        }
      } catch {
        // Storage access fallback
      }
    }
    this.baseUrl = (customUrl || baseUrl || '').replace(/\/$/, '');
  }

  setBaseUrl(url) {
    this.baseUrl = (url || '').replace(/\/$/, '');
    if (typeof window !== 'undefined') {
      try {
        if (this.baseUrl) {
          window.localStorage.setItem('downme_backend_url', this.baseUrl);
        } else {
          window.localStorage.removeItem('downme_backend_url');
        }
      } catch {}
    }
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  /**
   * Extract metadata and available formats for a given media URL.
   * @param {string} url - Target media URL
   * @returns {Promise<Object>} Extraction result
   */
  async extractMedia(url) {
    if (!url || typeof url !== 'string') {
      throw new Error('Please provide a valid media URL.');
    }

    const endpoint = `${this.baseUrl}/api/extract`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ url: url.trim() })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMsg = data?.detail || data?.error || `Extraction failed with status ${response.status}`;
        throw new Error(errorMsg);
      }

      if (!data || data.success === false) {
        throw new Error(data?.error || 'Unable to extract media from the provided URL.');
      }

      return data;
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Unable to connect to the DownMe server. Please ensure the backend is running.');
      }
      throw err;
    }
  }

  /**
   * Build the download URL with query parameters.
   * @param {Object} options
   * @returns {string} Fully qualified download URL
   */
  buildDownloadUrl({
    url,
    formatId = '1080p',
    mediaType = 'video',
    trimStart = null,
    trimEnd = null,
    embedCover = true,
    subtitleLang = null,
    subtitleExt = 'srt',
    filename = null,
    itemIndex = null
  }) {
    const params = new URLSearchParams();
    params.set('url', url);
    params.set('formatId', formatId);
    params.set('mediaType', mediaType);

    if (trimStart) params.set('trimStart', trimStart);
    if (trimEnd) params.set('trimEnd', trimEnd);
    if (embedCover !== undefined) params.set('embedCover', String(embedCover));
    if (mediaType === 'subtitles' && subtitleLang) {
      params.set('subtitleLang', subtitleLang);
      params.set('subtitleExt', subtitleExt);
    }
    if (itemIndex !== undefined && itemIndex !== null) {
      params.set('itemIndex', String(itemIndex));
    }
    if (filename) params.set('filename', filename);

    return `${this.baseUrl}/api/download?${params.toString()}`;
  }

  /**
   * Trigger direct streaming download in the browser.
   * @param {Object} options
   */
  triggerDownload(options) {
    const downloadUrl = this.buildDownloadUrl(options);
    
    // Create hidden anchor to initiate browser download without navigating away
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.setAttribute('download', '');
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 2000);
  }

  /**
   * Download multi-photo album as a ZIP archive.
   * @param {string} albumTitle
   * @param {Array<{url: string, filename?: string}>} items
   */
  async downloadAlbumZip(albumTitle, items) {
    if (!items || !items.length) {
      throw new Error('No photos selected for ZIP download.');
    }

    const endpoint = `${this.baseUrl}/api/download/zip`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        albumTitle: albumTitle || 'downhere_Album',
        items: items.map((item, idx) => ({
          index: idx + 1,
          url: item.url,
          filename: item.filename || `photo_${String(idx + 1).padStart(2, '0')}.jpg`
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to generate ZIP archive (status ${response.status})`);
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${albumTitle || 'album'}.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    }, 2000);
  }

  /**
   * Query platform health and probe latencies.
   * @returns {Promise<Object>} Health response
   */
  async fetchHealth() {
    const endpoint = `${this.baseUrl}/api/health`;
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-cache'
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Trigger 1-click extractor self-healing updater.
   * @returns {Promise<Object>} Update response
   */
  async triggerUpdate() {
    const endpoint = `${this.baseUrl}/api/system/update`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    });
    return await response.json();
  }
}

export const api = new ApiClient();
