"""Live Platform Probe & Health Monitoring Service.

Provides real-time health checks, latency measurements, and tool version reporting
for YouTube, Facebook, TikTok, and Pinterest.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, Optional
import httpx
from pydantic import BaseModel

from server.config import system_paths

PROBE_TARGETS = {
    "youtube": "https://www.youtube.com/generate_204",
    "facebook": "https://www.facebook.com/favicon.ico",
    "tiktok": "https://www.tiktok.com/favicon.ico",
    "pinterest": "https://www.pinterest.com/favicon.ico",
}

PROBE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
}


class PlatformStatus(BaseModel):
    status: str  # "operational" | "degraded" | "offline"
    latencyMs: int
    lastChecked: Optional[str] = None


class HealthResponse(BaseModel):
    status: str  # "healthy" | "degraded"
    version: str
    platforms: Dict[str, PlatformStatus]
    engine: Optional[Dict[str, Any]] = None


class HealthService:
    def __init__(self, cache_ttl_seconds: int = 60):
        self.cache_ttl = cache_ttl_seconds
        self._cached_health: Optional[HealthResponse] = None
        self._last_probe_time: float = 0
        self._lock = asyncio.Lock()

    async def _probe_single_platform(
        self,
        client: httpx.AsyncClient,
        platform: str,
        target_url: str,
    ) -> PlatformStatus:
        t0 = time.perf_counter()
        try:
            resp = await client.get(target_url, timeout=5.0)
            latency = int((time.perf_counter() - t0) * 1000)
            # Accept any reasonable HTTP status (200, 204, 301, 302)
            if resp.status_code in (200, 204, 301, 302, 403):
                return PlatformStatus(status="operational", latencyMs=max(1, latency))
            return PlatformStatus(status="degraded", latencyMs=latency)
        except Exception:
            latency = int((time.perf_counter() - t0) * 1000)
            return PlatformStatus(status="degraded", latencyMs=latency)

    async def check_health(self, force: bool = False) -> HealthResponse:
        now = time.time()
        async with self._lock:
            if not force and self._cached_health and (now - self._last_probe_time) < self.cache_ttl:
                return self._cached_health

            async with httpx.AsyncClient(
                headers=PROBE_HEADERS,
                follow_redirects=True,
                verify=False,
            ) as client:
                tasks = [
                    self._probe_single_platform(client, p, url)
                    for p, url in PROBE_TARGETS.items()
                ]
                results = await asyncio.gather(*tasks)

            platforms_dict: dict[str, PlatformStatus] = {}
            for platform, status in zip(PROBE_TARGETS.keys(), results):
                platforms_dict[platform] = status

            overall_status = "healthy"
            if any(s.status != "operational" for s in platforms_dict.values()):
                # If only some are degraded, overall is still operational or degraded
                operational_count = sum(1 for s in platforms_dict.values() if s.status == "operational")
                overall_status = "healthy" if operational_count >= 2 else "degraded"

            response = HealthResponse(
                status=overall_status,
                version=system_paths.yt_dlp_version,
                platforms=platforms_dict,
                engine={
                    "ytDlpVersion": system_paths.yt_dlp_version,
                    "ffmpegVersion": system_paths.ffmpeg_version,
                    "nodeVersion": system_paths.node_version,
                },
            )

            self._cached_health = response
            self._last_probe_time = now
            return response


health_service = HealthService()
