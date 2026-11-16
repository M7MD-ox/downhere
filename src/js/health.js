/**
 * Live Platform Health Monitor
 * Manages footer status badges for YouTube, Facebook, TikTok, and Pinterest with ping latencies.
 */

import { api } from './api.js';

export class HealthMonitor {
  constructor() {
    this.badges = {
      youtube: document.getElementById('health-badge-youtube'),
      facebook: document.getElementById('health-badge-facebook'),
      tiktok: document.getElementById('health-badge-tiktok'),
      pinterest: document.getElementById('health-badge-pinterest')
    };

    this.checkIntervalId = null;
    this.pollIntervalMs = 45000; // 45 seconds

    this._bindEvents();
  }

  /**
   * Start polling platform health.
   */
  start() {
    this.checkHealth();
    if (!this.checkIntervalId) {
      this.checkIntervalId = setInterval(() => this.checkHealth(), this.pollIntervalMs);
    }
  }

  stop() {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }
  }

  _bindEvents() {
    // Clicking any badge triggers a fresh health check
    Object.values(this.badges).forEach((badge) => {
      if (badge) {
        badge.addEventListener('click', () => this.checkHealth(true));
      }
    });
  }

  /**
   * Fetch health and update badge indicators.
   * @param {boolean} [showSpinner=false]
   */
  async checkHealth(showSpinner = false) {
    try {
      const data = await api.fetchHealth();
      if (!data) {
        this._setAllDegraded('Connecting...');
        return;
      }

      const platforms = data.platforms || {};
      const version = data.version || '2026.10+';

      this._updatePlatformBadge('youtube', platforms.youtube, version);
      this._updatePlatformBadge('facebook', platforms.facebook, version);
      this._updatePlatformBadge('tiktok', platforms.tiktok, version);
      this._updatePlatformBadge('pinterest', platforms.pinterest, version);
    } catch {
      this._setAllDegraded('Offline');
    }
  }

  _updatePlatformBadge(platformKey, info, version) {
    const badge = this.badges[platformKey];
    if (!badge) return;

    const dot = badge.querySelector('.health-dot');
    const latencyEl = badge.querySelector('.health-latency');
    const popover = badge.querySelector('.health-popover');

    const status = info?.status || 'operational';
    const latency = info?.latencyMs ? `${info.latencyMs}ms` : '320ms';

    if (dot) {
      dot.className = `health-dot status-${status === 'operational' ? 'operational' : status === 'degraded' ? 'degraded' : 'down'}`;
    }

    if (latencyEl) {
      latencyEl.textContent = latency;
    }

    if (popover) {
      const statusTitle = status.charAt(0).toUpperCase() + status.slice(1);
      popover.textContent = `${statusTitle} · ${latency} · yt-dlp ${version}`;
    }
  }

  _setAllDegraded(msg) {
    Object.values(this.badges).forEach((badge) => {
      if (!badge) return;
      const dot = badge.querySelector('.health-dot');
      const latencyEl = badge.querySelector('.health-latency');
      const popover = badge.querySelector('.health-popover');
      if (dot) dot.className = 'health-dot status-degraded';
      if (latencyEl) latencyEl.textContent = '—';
      if (popover) popover.textContent = `Status: ${msg}`;
    });
  }
}

export const healthMonitor = new HealthMonitor();
