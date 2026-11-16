"""Pinterest Platform Extractor.

Resolves pin.it shortlinks and extracts:
- Video pins (MP4)
- Original uncompressed photos (JPG/PNG via images.orig)
- Animated GIF pins (.gif)
- Multi-slide Idea pins / carousels (packaged as album for ZIP download)
"""

from __future__ import annotations

import asyncio
import json
import re
import urllib.parse
from typing import Any, Dict, List, Optional
import httpx
import yt_dlp

from server.config import settings
from server.extractors.base import (
    AlbumItem,
    AudioFormat,
    BaseExtractor,
    ExtractionResponse,
    StreamTarget,
    URL_PATTERNS,
    VideoFormat,
)

PINTEREST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.pinterest.com/",
}


class PinterestExtractor(BaseExtractor):
    platform_name = "pinterest"

    def can_handle(self, url: str) -> bool:
        return bool(URL_PATTERNS["pinterest"].search(url))

    async def resolve_url(self, url: str) -> str:
        """Resolve pin.it shortlinks and international domains to canonical URL."""
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=12.0,
                headers=PINTEREST_HEADERS,
            ) as client:
                resp = await client.get(url)
                return str(resp.url)
        except Exception:
            return url

    def _extract_pin_id(self, url: str) -> Optional[str]:
        match = re.search(r"/pin/(\d+)", url)
        return match.group(1) if match else None

    async def _fetch_pin_resource(self, pin_id: str) -> Optional[dict[str, Any]]:
        """Fetch pin data from Pinterest's internal PinResource API."""
        endpoint = "https://www.pinterest.com/resource/PinResource/get/"
        payload = {
            "options": {
                "id": pin_id,
                "field_set_key": "detailed",
            },
            "context": {},
        }
        params = {"data": json.dumps(payload)}
        try:
            headers = {
                **PINTEREST_HEADERS,
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json",
            }
            async with httpx.AsyncClient(timeout=12.0, headers=headers) as client:
                resp = await client.get(endpoint, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    resource_data = data.get("resource_response", {}).get("data")
                    if resource_data:
                        return resource_data
        except Exception:
            pass
        return None

    def _extract_pws_data(self, html: str) -> Optional[dict[str, Any]]:
        """Extract __PWS_DATA__ from pin HTML page."""
        match = re.search(r'<script id="__PWS_DATA__"[^>]*>([\s\S]*?)</script>', html)
        if match:
            try:
                data = json.loads(match.group(1))
                props = data.get("props", {}).get("initialReduxState", {})
                pins = props.get("pins", {})
                if pins:
                    first_pin = next(iter(pins.values()))
                    return first_pin
            except Exception:
                pass
        return None

    def _extract_via_ytdlp(self, url: str) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": False,
            "noplaylist": True,
        }
        if settings.cookies_file:
            opts["cookiefile"] = settings.cookies_file
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False) or {}

    async def extract(self, url: str) -> ExtractionResponse:
        canonical_url = await self.resolve_url(url)
        pin_id = self._extract_pin_id(canonical_url) or "pin"

        # 1. Fetch via Resource API or page HTML
        pin_data = await self._fetch_pin_resource(pin_id) if pin_id.isdigit() else None

        if not pin_data:
            # Try fetching HTML
            try:
                async with httpx.AsyncClient(
                    follow_redirects=True,
                    timeout=12.0,
                    headers=PINTEREST_HEADERS,
                ) as client:
                    resp = await client.get(canonical_url)
                    pin_data = self._extract_pws_data(resp.text)
            except Exception:
                pass

        # 2. Check if Pin contains videos
        videos_dict = (pin_data or {}).get("videos", {})
        video_list = videos_dict.get("video_list") if isinstance(videos_dict, dict) else None

        # If it's a video pin or yt-dlp can handle it
        if video_list or not pin_data:
            try:
                ytdl_info = await asyncio.to_thread(self._extract_via_ytdlp, canonical_url)
                if ytdl_info and ytdl_info.get("formats"):
                    return self._build_video_response(ytdl_info, pin_data, pin_id)
            except Exception:
                pass

        if video_list:
            return self._build_resource_video_response(video_list, pin_data, pin_id)

        # 3. Check for Idea Pin / Multi-Slide Carousel
        story_data = (pin_data or {}).get("story_pin_data") or {}
        pages = story_data.get("pages") or []
        if pages:
            return self._build_idea_pin_response(pages, pin_data, pin_id)

        # 4. Image or Animated GIF pin
        return self._build_image_or_gif_response(pin_data, pin_id, canonical_url)

    def _build_video_response(
        self,
        info: dict[str, Any],
        pin_data: Optional[dict[str, Any]],
        pin_id: str,
    ) -> ExtractionResponse:
        title = str(info.get("title") or (pin_data or {}).get("grid_title") or "Pinterest Video")
        author = str(info.get("uploader") or (pin_data or {}).get("pinner", {}).get("username") or "Pinterest Creator")
        duration = int(info.get("duration") or 0)
        thumbnail = info.get("thumbnail")

        formats = info.get("formats") or []
        mp4_formats = [f for f in formats if f.get("ext") == "mp4" and f.get("url")]

        best_video = max(mp4_formats, key=lambda f: (f.get("height") or 0)) if mp4_formats else formats[0]
        v_url = best_video.get("url")
        h = best_video.get("height") or 720

        video_formats = [
            VideoFormat(
                formatId="video-hd",
                label=f"Pinterest Video ({h}p MP4)",
                ext="mp4",
                resolution=f"{best_video.get('width') or 720}x{h}",
                filesizeApprox=best_video.get("filesize") or best_video.get("filesize_approx"),
                isDefault=True,
                rawVideoUrl=v_url,
            )
        ]

        audio_formats = [
            AudioFormat(
                formatId="mp3-320",
                label="Audio Track (MP3)",
                bitrate=320,
                ext="mp3",
                hasCoverArt=True,
                rawAudioUrl=v_url,
            )
        ]

        return ExtractionResponse(
            success=True,
            platform="pinterest",
            id=pin_id,
            title=title,
            author=author,
            duration=duration,
            thumbnail=thumbnail,
            previewUrl=v_url,
            mediaType="video",
            formats={"video": video_formats, "audio": audio_formats},
            subtitles=None,
            items=None,
            canDownloadAsZip=False,
            directStreams={
                "title": title,
                "author": author,
                "thumbnail": thumbnail,
                "video-hd": {"video_url": v_url},
                "best_audio_url": v_url,
            },
        )

    def _build_resource_video_response(
        self,
        video_list: dict[str, Any],
        pin_data: Optional[dict[str, Any]],
        pin_id: str,
    ) -> ExtractionResponse:
        title = str((pin_data or {}).get("grid_title") or (pin_data or {}).get("title") or "Pinterest Video")
        author = str((pin_data or {}).get("pinner", {}).get("username") or "Pinterest Creator")
        thumbnail = (pin_data or {}).get("images", {}).get("orig", {}).get("url")

        # video_list has keys like V_720P, V_EXP7 with { url, width, height }
        sorted_streams = sorted(
            video_list.values(),
            key=lambda x: (x.get("height") or 0),
            reverse=True,
        )
        best_v = sorted_streams[0] if sorted_streams else {}
        v_url = best_v.get("url")
        h = best_v.get("height") or 720

        video_formats = [
            VideoFormat(
                formatId="video-hd",
                label=f"Pinterest Video ({h}p MP4)",
                ext="mp4",
                resolution=f"{best_v.get('width') or 720}x{h}",
                isDefault=True,
                rawVideoUrl=v_url,
            )
        ]

        return ExtractionResponse(
            success=True,
            platform="pinterest",
            id=pin_id,
            title=title,
            author=author,
            duration=int((pin_data or {}).get("videos", {}).get("duration") or 0),
            thumbnail=thumbnail,
            previewUrl=v_url,
            mediaType="video",
            formats={"video": video_formats, "audio": []},
            items=None,
            canDownloadAsZip=False,
            directStreams={
                "title": title,
                "author": author,
                "thumbnail": thumbnail,
                "video-hd": {"video_url": v_url},
            },
        )

    def _build_idea_pin_response(
        self,
        pages: list[dict[str, Any]],
        pin_data: Optional[dict[str, Any]],
        pin_id: str,
    ) -> ExtractionResponse:
        title = str((pin_data or {}).get("grid_title") or (pin_data or {}).get("title") or "Pinterest Idea Pin")
        author = str((pin_data or {}).get("pinner", {}).get("username") or "Pinterest Creator")

        items: List[AlbumItem] = []
        for idx, page in enumerate(pages, start=1):
            # Check for images.orig in blocks or page
            blocks = page.get("blocks") or []
            item_url = None
            width = None
            height = None

            for block in blocks:
                # Video or image block
                block_video = block.get("video", {}).get("video_list")
                if block_video:
                    best = next(iter(block_video.values()), {})
                    item_url = best.get("url")
                    break
                block_img = block.get("image", {}).get("images", {}).get("orig")
                if block_img:
                    item_url = block_img.get("url")
                    width = block_img.get("width")
                    height = block_img.get("height")
                    break

            if not item_url:
                # Direct page image
                orig = page.get("images", {}).get("orig", {})
                item_url = orig.get("url")
                width = orig.get("width")
                height = orig.get("height")

            if item_url:
                ext = "mp4" if ".mp4" in item_url else "jpg"
                items.append(
                    AlbumItem(
                        index=idx,
                        url=item_url,
                        width=width,
                        height=height,
                        ext=ext,
                        filename=f"pin_slide_{idx:02d}.{ext}",
                    )
                )

        thumbnail = items[0].url if items else None

        return ExtractionResponse(
            success=True,
            platform="pinterest",
            id=pin_id,
            title=title,
            author=author,
            duration=0,
            thumbnail=thumbnail,
            mediaType="album",
            formats={"video": [], "audio": []},
            subtitles=None,
            items=items,
            canDownloadAsZip=True,
            directStreams={
                "title": title,
                "author": author,
                "thumbnail": thumbnail,
            },
        )

    def _build_image_or_gif_response(
        self,
        pin_data: Optional[dict[str, Any]],
        pin_id: str,
        canonical_url: str,
    ) -> ExtractionResponse:
        title = str((pin_data or {}).get("grid_title") or (pin_data or {}).get("title") or "Pinterest Pin")
        author = str((pin_data or {}).get("pinner", {}).get("username") or "Pinterest Creator")

        orig_img = (pin_data or {}).get("images", {}).get("orig", {})
        img_url = orig_img.get("url")
        w = orig_img.get("width")
        h = orig_img.get("height")

        # Fallback if orig not in pin_data: inspect other image fields or construct originals URL
        if not img_url:
            for key in ("736x", "474x", "236x"):
                fallback_obj = (pin_data or {}).get("images", {}).get(key)
                if fallback_obj and fallback_obj.get("url"):
                    # Transform e.g. /736x/ to /originals/
                    img_url = fallback_obj["url"].replace(f"/{key}/", "/originals/")
                    w = fallback_obj.get("width")
                    h = fallback_obj.get("height")
                    break

        if not img_url:
            img_url = (pin_data or {}).get("image_medium_url") or f"https://www.pinterest.com/pin/{pin_id}/"

        # Detect animated GIF
        is_gif = (
            img_url.lower().endswith(".gif")
            or (pin_data or {}).get("is_animated") is True
            or "gif" in str((pin_data or {}).get("type", "")).lower()
        )

        media_ext = "gif" if is_gif else "jpg"
        media_type = "photo"

        # Provide selectable photo formats
        photo_item = AlbumItem(
            index=1,
            url=img_url,
            width=w,
            height=h,
            ext=media_ext,
            filename=f"pinterest_{pin_id}.{media_ext}",
        )

        return ExtractionResponse(
            success=True,
            platform="pinterest",
            id=pin_id,
            title=title,
            author=author,
            duration=0,
            thumbnail=img_url,
            mediaType=media_type,
            formats={
                "video": [],
                "audio": [],
                "photo": [
                    {
                        "formatId": "orig",
                        "label": "Original Quality (GIF)" if is_gif else "Original High-Res Photo (JPG)",
                        "ext": media_ext,
                        "url": img_url,
                        "resolution": f"{w}x{h}" if w and h else "Original",
                        "isDefault": True,
                    }
                ],
            },
            subtitles=None,
            items=[photo_item],
            canDownloadAsZip=False,
            directStreams={
                "title": title,
                "author": author,
                "thumbnail": img_url,
                "orig": {"direct_url": img_url, "ext": media_ext},
            },
        )

    async def get_stream_target(
        self,
        url: str,
        format_id: str,
        media_type: str,
    ) -> StreamTarget:
        extract_res = await self.extract(url)

        if media_type in ("photo", "thumbnail") or format_id in ("orig", "thumbnail", "photo", "gif", "original"):
            target_url = extract_res.thumbnail
            ext = "jpg"
            if extract_res.items:
                target_url = extract_res.items[0].url
                ext = extract_res.items[0].ext

            return StreamTarget(
                mediaType="photo",
                title=extract_res.title,
                author=extract_res.author,
                directUrl=target_url,
                ext=ext,
            )

        if media_type == "audio":
            best_audio = extract_res.directStreams.get("best_audio_url") or (extract_res.directStreams.get("video-hd") or {}).get("video_url")
            return StreamTarget(
                mediaType="audio",
                title=extract_res.title,
                author=extract_res.author,
                thumbnailUrl=extract_res.thumbnail,
                audioUrl=best_audio,
                ext="mp3" if "mp3" in format_id else "m4a",
                needsTranscode=True,
                targetBitrate=320 if "320" in format_id else 160,
            )

        v_info = extract_res.directStreams.get(format_id) or extract_res.directStreams.get("video-hd")
        v_url = v_info.get("video_url") if v_info else None

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
