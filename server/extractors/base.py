"""Base Extractor Protocol, Regex Matchers & Media Data Models."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
import httpx
from pydantic import BaseModel, Field

# URL Detection Regular Expressions
URL_PATTERNS = {
    "youtube": re.compile(
        r"^(https?://)?(www\.|m\.)?(youtube\.com/(watch\?v=|shorts/|live/|embed/)|youtu\.be/)([\w-]{11})",
        re.IGNORECASE,
    ),
    "facebook": re.compile(
        r"^(https?://)?(www\.|m\.|fb\.)?(facebook\.com/(watch/?\?v=|reel/|.+?/videos/|share/v/)|fb\.watch/)",
        re.IGNORECASE,
    ),
    "tiktok": re.compile(
        r"^(https?://)?(www\.|vm\.|vt\.)?(tiktok\.com/(@[\w.-]+/(video|photo)/\d+|t/[\w-]+)|[a-z0-9]+\.tiktok\.com)",
        re.IGNORECASE,
    ),
    "pinterest": re.compile(
        r"^(https?://)?(www\.|[a-z]{2}\.)?(pinterest\.[a-z.]+/pin/(\d+)|pin\.it/[a-zA-Z0-9]+)",
        re.IGNORECASE,
    ),
}


class VideoFormat(BaseModel):
    formatId: str
    label: str
    ext: str = "mp4"
    resolution: Optional[str] = None
    filesizeApprox: Optional[int] = None
    isDefault: bool = False
    rawVideoUrl: Optional[str] = Field(default=None, exclude=True)
    rawAudioUrl: Optional[str] = Field(default=None, exclude=True)


class AudioFormat(BaseModel):
    formatId: str
    label: str
    bitrate: int
    ext: str = "mp3"
    hasCoverArt: bool = True
    rawAudioUrl: Optional[str] = Field(default=None, exclude=True)


class Subtitle(BaseModel):
    lang: str
    label: str
    ext: str = "srt"
    url: Optional[str] = None


class AlbumItem(BaseModel):
    index: int
    url: str
    width: Optional[int] = None
    height: Optional[int] = None
    ext: str = "jpg"
    filename: Optional[str] = None


class ExtractionResponse(BaseModel):
    success: bool = True
    platform: str
    id: str
    title: str
    author: str
    duration: Optional[int] = None
    thumbnail: Optional[str] = None
    previewUrl: Optional[str] = None
    mediaType: str = "video"  # "video" | "audio" | "photo" | "album"
    formats: Dict[str, Any] = Field(default_factory=lambda: {"video": [], "audio": []})
    subtitles: Optional[List[Subtitle]] = None
    items: Optional[List[AlbumItem]] = None
    canDownloadAsZip: bool = False
    # Internal cache map for stream resolutions
    directStreams: Dict[str, Any] = Field(default_factory=dict, exclude=True)


class StreamTarget(BaseModel):
    mediaType: str  # "video" | "audio" | "photo"
    title: str
    author: str
    thumbnailUrl: Optional[str] = None
    videoUrl: Optional[str] = None
    audioUrl: Optional[str] = None
    directUrl: Optional[str] = None
    ext: str = "mp4"
    isDashMerge: bool = False
    needsTranscode: bool = False
    targetBitrate: Optional[int] = None


class BaseExtractor(ABC):
    """Abstract base class for all platform extractors."""

    platform_name: str

    @abstractmethod
    def can_handle(self, url: str) -> bool:
        """Check if URL matches this platform's pattern."""
        pass

    async def resolve_url(self, url: str) -> str:
        """Resolve shortlinks (pin.it, fb.watch, vm.tiktok.com) to their canonical URLs."""
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=10.0,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/128.0.0.0 Safari/537.36"
                    )
                },
            ) as client:
                resp = await client.head(url)
                return str(resp.url)
        except Exception:
            return url

    @abstractmethod
    async def extract(self, url: str) -> ExtractionResponse:
        """Extract media metadata and stream options."""
        pass

    @abstractmethod
    async def get_stream_target(
        self,
        url: str,
        format_id: str,
        media_type: str,
    ) -> StreamTarget:
        """Resolve direct stream URLs for FFmpeg piping or client streaming."""
        pass


_QUALITY_LABELS = {
    2160: "2160p 4K",
    1440: "1440p 2K",
    1080: "1080p Full HD",
    720: "720p HD",
    480: "480p SD",
}


def build_real_video_formats(
    video_candidates: List[Dict[str, Any]],
    best_audio_url: Optional[str] = None,
    check_muxed: bool = False,
) -> List[VideoFormat]:
    """Build deduplicated VideoFormat list from only the resolutions actually present."""
    by_tier: Dict[int, List[Dict[str, Any]]] = {}
    unsized: List[Dict[str, Any]] = []

    for f in video_candidates:
        if not f.get("url"):
            continue
        w = f.get("width") or 0
        h = f.get("height") or 0
        tier = min(w, h) if (w and h) else h
        if tier and tier > 0:
            by_tier.setdefault(int(tier), []).append(f)
        else:
            unsized.append(f)

    video_formats: List[VideoFormat] = []
    for tier in sorted(by_tier.keys(), reverse=True):
        best = max(
            by_tier[tier],
            key=lambda f: (
                1 if f.get("ext") == "mp4" else 0,
                1 if (check_muxed and f.get("acodec") not in (None, "none")) else 0,
                f.get("tbr") or f.get("filesize") or f.get("filesize_approx") or 0,
            ),
        )
        w = best.get("width")
        h = best.get("height")
        has_muxed = check_muxed and (best.get("acodec") not in (None, "none"))
        video_formats.append(
            VideoFormat(
                formatId=f"{tier}p",
                label=_QUALITY_LABELS.get(tier, f"{tier}p"),
                ext="mp4",
                resolution=f"{w}x{h}" if (w and h) else None,
                filesizeApprox=best.get("filesize") or best.get("filesize_approx"),
                isDefault=False,
                rawVideoUrl=best.get("url"),
                rawAudioUrl=None if has_muxed else best_audio_url,
            )
        )

    if not video_formats and unsized:
        best = max(unsized, key=lambda f: f.get("tbr") or f.get("filesize") or 0)
        has_muxed = check_muxed and (best.get("acodec") not in (None, "none"))
        video_formats.append(
            VideoFormat(
                formatId="best",
                label="Original Quality (MP4)",
                ext="mp4",
                filesizeApprox=best.get("filesize") or best.get("filesize_approx"),
                isDefault=True,
                rawVideoUrl=best.get("url"),
                rawAudioUrl=None if has_muxed else best_audio_url,
            )
        )

    # Default to 1080p if available, else highest resolution <= 1080p, else first
    default_idx = next((i for i, vf in enumerate(video_formats) if vf.formatId == "1080p"), None)
    if default_idx is None and video_formats:
        under_1080 = next(
            (i for i, vf in enumerate(video_formats) if vf.formatId.endswith("p") and vf.formatId[:-1].isdigit() and int(vf.formatId[:-1]) <= 1080),
            0,
        )
        default_idx = under_1080
    if default_idx is not None and video_formats:
        video_formats[default_idx].isDefault = True

    return video_formats
