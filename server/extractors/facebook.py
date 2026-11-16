"""Facebook Platform Extractor.

Extracts public Facebook videos, Reels, and resolves fb.watch shortlinks.
Delivers HD/SD MP4 streams with audio extraction capabilities.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List, Optional
import httpx
import yt_dlp

from server.config import settings
from server.extractors.base import (
    AudioFormat,
    BaseExtractor,
    ExtractionResponse,
    StreamTarget,
    URL_PATTERNS,
    VideoFormat,
)


class FacebookExtractor(BaseExtractor):
    platform_name = "facebook"

    def can_handle(self, url: str) -> bool:
        return bool(URL_PATTERNS["facebook"].search(url))

    async def resolve_url(self, url: str) -> str:
        """Resolve fb.watch and m.facebook shortlinks to canonical URLs."""
        try:
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/128.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            }
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=12.0,
                headers=headers,
            ) as client:
                resp = await client.get(url)
                return str(resp.url)
        except Exception:
            return url

    def _get_ydl_opts(self) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": False,
            "noplaylist": True,
        }
        if settings.cookies_file:
            opts["cookiefile"] = settings.cookies_file
        return opts

    def _extract_sync(self, url: str) -> dict[str, Any]:
        with yt_dlp.YoutubeDL(self._get_ydl_opts()) as ydl:
            return ydl.extract_info(url, download=False) or {}

    async def _fallback_html_extract(self, url: str) -> Optional[dict[str, Any]]:
        """Scrape public video streams directly from Facebook page HTML if available."""
        try:
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/128.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Sec-Fetch-Mode": "navigate",
            }
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=15.0,
                headers=headers,
            ) as client:
                resp = await client.get(url)
                html = resp.text

            hd_match = re.search(r'["\']playable_url_quality_hd["\']:\s*["\']([^"\']+)["\']', html)
            sd_match = re.search(r'["\']playable_url["\']:\s*["\']([^"\']+)["\']', html)
            thumb_match = re.search(r'["\']preferred_thumbnail["\']:\s*\{["\']image["\']:\s*\{["\']uri["\']:\s*["\']([^"\']+)["\']', html)

            hd_url = hd_match.group(1).replace(r"\/", "/") if hd_match else None
            sd_url = sd_match.group(1).replace(r"\/", "/") if sd_match else None
            thumb_url = thumb_match.group(1).replace(r"\/", "/") if thumb_match else None

            if hd_url or sd_url:
                title_match = re.search(r'<title id="pageTitle">([^<]+)</title>', html)
                title = title_match.group(1).replace(" | Facebook", "").strip() if title_match else "Facebook Video"
                return {
                    "id": "fb_video",
                    "title": title,
                    "uploader": "Facebook Creator",
                    "thumbnail": thumb_url,
                    "formats": [
                        {"format_id": "hd", "url": hd_url, "height": 720, "ext": "mp4"} if hd_url else None,
                        {"format_id": "sd", "url": sd_url, "height": 360, "ext": "mp4"} if sd_url else None,
                    ],
                }
        except Exception:
            pass
        return None

    async def extract(self, url: str) -> ExtractionResponse:
        canonical_url = await self.resolve_url(url)

        info: Optional[dict[str, Any]] = None
        try:
            info = await asyncio.to_thread(self._extract_sync, canonical_url)
        except Exception:
            info = await self._fallback_html_extract(canonical_url)

        if not info:
            raise ValueError(f"Could not extract info from Facebook URL: {url}")

        video_id = str(info.get("id") or "fb_video")
        title = str(info.get("title") or "Facebook Video")
        author = str(info.get("uploader") or "Facebook Creator")
        duration = int(info.get("duration") or 0)
        thumbnail_url = info.get("thumbnail")

        all_formats = [f for f in (info.get("formats") or []) if f]

        video_formats: List[VideoFormat] = []
        direct_streams: dict[str, Any] = {
            "title": title,
            "author": author,
            "thumbnail": thumbnail_url,
        }

        # HD format
        hd_format = next(
            (f for f in all_formats if f.get("format_id") == "hd" or (f.get("height") and f["height"] >= 720)),
            None,
        )
        # SD format
        sd_format = next(
            (f for f in all_formats if f.get("format_id") == "sd" or (f.get("height") and f["height"] < 720)),
            None,
        )

        if hd_format and hd_format.get("url"):
            hw, hh = hd_format.get("width"), hd_format.get("height")
            htier = min(hw, hh) if (hw and hh) else hh
            hlabel = f"{htier}p HD" if htier else "HD Quality"
            video_formats.append(
                VideoFormat(
                    formatId="hd",
                    label=hlabel,
                    ext="mp4",
                    resolution=f"{hw}x{hh}" if (hw and hh) else None,
                    filesizeApprox=hd_format.get("filesize") or hd_format.get("filesize_approx"),
                    isDefault=True,
                    rawVideoUrl=hd_format["url"],
                )
            )
            direct_streams["hd"] = {"video_url": hd_format["url"]}

        if sd_format and sd_format.get("url"):
            sw, sh = sd_format.get("width"), sd_format.get("height")
            stier = min(sw, sh) if (sw and sh) else sh
            slabel = f"{stier}p SD" if stier else "SD Quality"
            is_default = len(video_formats) == 0
            video_formats.append(
                VideoFormat(
                    formatId="sd",
                    label=slabel,
                    ext="mp4",
                    resolution=f"{sw}x{sh}" if (sw and sh) else None,
                    filesizeApprox=sd_format.get("filesize") or sd_format.get("filesize_approx"),
                    isDefault=is_default,
                    rawVideoUrl=sd_format["url"],
                )
            )
            direct_streams["sd"] = {"video_url": sd_format["url"]}

        # If neither hd nor sd named formats found, take best available MP4 formats
        if not video_formats and all_formats:
            mp4_candidates = [f for f in all_formats if f.get("url") and f.get("ext") == "mp4"]
            sorted_candidates = sorted(
                mp4_candidates,
                key=lambda f: (f.get("height") or 0, f.get("tbr") or 0),
                reverse=True,
            )
            for idx, cand in enumerate(sorted_candidates[:2]):
                fid = f"quality_{idx+1}"
                h = cand.get("height") or 720
                label = f"{h}p HD" if h >= 720 else f"{h}p SD"
                video_formats.append(
                    VideoFormat(
                        formatId=fid,
                        label=label,
                        ext="mp4",
                        resolution=f"{cand.get('width') or h*16//9}x{h}",
                        isDefault=(idx == 0),
                        rawVideoUrl=cand["url"],
                    )
                )
                direct_streams[fid] = {"video_url": cand["url"]}

        # Audio formats
        best_audio_url = None
        if video_formats:
            # Facebook progressive streams have embedded audio
            best_audio_url = video_formats[0].rawVideoUrl

        audio_formats: List[AudioFormat] = [
            AudioFormat(
                formatId="mp3-320",
                label="MP3 High Quality (320 kbps)",
                bitrate=320,
                ext="mp3",
                hasCoverArt=True,
                rawAudioUrl=best_audio_url,
            ),
            AudioFormat(
                formatId="m4a-aac",
                label="M4A / AAC (Apple Native)",
                bitrate=160,
                ext="m4a",
                hasCoverArt=True,
                rawAudioUrl=best_audio_url,
            ),
        ]
        direct_streams["best_audio_url"] = best_audio_url

        return ExtractionResponse(
            success=True,
            platform="facebook",
            id=video_id,
            title=title,
            author=author,
            duration=duration,
            thumbnail=thumbnail_url,
            previewUrl=video_formats[0].rawVideoUrl if video_formats else None,
            mediaType="video",
            formats={"video": video_formats, "audio": audio_formats},
            subtitles=None,
            items=None,
            canDownloadAsZip=False,
            directStreams=direct_streams,
        )

    async def get_stream_target(
        self,
        url: str,
        format_id: str,
        media_type: str,
    ) -> StreamTarget:
        extract_res = await self.extract(url)

        if media_type in ("photo", "thumbnail") or format_id in ("thumbnail", "photo", "original", "orig"):
            return StreamTarget(
                mediaType="photo",
                title=extract_res.title,
                author=extract_res.author,
                directUrl=extract_res.thumbnail,
                ext="jpg",
            )

        best_audio_url = extract_res.directStreams.get("best_audio_url")

        if media_type == "audio":
            return StreamTarget(
                mediaType="audio",
                title=extract_res.title,
                author=extract_res.author,
                thumbnailUrl=extract_res.thumbnail,
                audioUrl=best_audio_url,
                ext="mp3" if "mp3" in format_id else "m4a",
                needsTranscode=True,
                targetBitrate=320 if "320" in format_id else 160,
            )

        video_info = extract_res.directStreams.get(format_id)
        if not video_info:
            vf_list = extract_res.formats.get("video") or []
            if vf_list:
                format_id = vf_list[0].formatId
                video_info = extract_res.directStreams.get(format_id)

        v_url = video_info.get("video_url") if video_info else None

        return StreamTarget(
            mediaType="video",
            title=extract_res.title,
            author=extract_res.author,
            thumbnailUrl=extract_res.thumbnail,
            videoUrl=v_url,
            directUrl=v_url,
            ext="mp4",
            isDashMerge=False,
        )
