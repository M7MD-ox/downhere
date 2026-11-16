"""TikTok Platform Extractor.

Extracts watermark-free MP4 videos via direct CDN streams and extracts
full-resolution watermark-free photos from multi-photo slideshows/albums
using a hybrid rehydration JSON parser (itemStruct.imagePost).
"""

from __future__ import annotations

import asyncio
import json
import re
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

TIKTOK_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Version/17.4 Mobile/15E148 Safari/604.1"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
}


class TikTokExtractor(BaseExtractor):
    platform_name = "tiktok"

    def can_handle(self, url: str) -> bool:
        return bool(URL_PATTERNS["tiktok"].search(url))

    async def resolve_url(self, url: str) -> str:
        """Resolve vm.tiktok.com, vt.tiktok.com, or tiktok.com/t/ shortlinks."""
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=12.0,
                headers=TIKTOK_HEADERS,
            ) as client:
                resp = await client.get(url)
                return str(resp.url)
        except Exception:
            return url

    def _parse_rehydration_json(self, html: str) -> Optional[dict[str, Any]]:
        """Extract itemStruct from __UNIVERSAL_DATA_FOR_REHYDRATION__ or SIGI_STATE."""
        # 1. Try __UNIVERSAL_DATA_FOR_REHYDRATION__
        univ_match = re.search(
            r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)</script>',
            html,
        )
        if univ_match:
            try:
                data = json.loads(univ_match.group(1))
                scope = data.get("__DEFAULT_SCOPE__", {})
                detail = (
                    scope.get("webapp.reflow.video.detail")
                    or scope.get("webapp.video-detail")
                    or scope.get("webapp.photo-detail")
                    or {}
                )
                item = detail.get("itemInfo", {}).get("itemStruct")
                if item:
                    return item
            except Exception:
                pass

        # 2. Try SIGI_STATE
        sigi_match = re.search(
            r'<script id="SIGI_STATE"[^>]*>([\s\S]*?)</script>',
            html,
        )
        if sigi_match:
            try:
                data = json.loads(sigi_match.group(1))
                item_module = data.get("ItemModule", {})
                if item_module:
                    # Pick first item
                    first_key = next(iter(item_module))
                    return item_module[first_key]
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

    async def _extract_via_tikwm(self, url: str) -> Optional[ExtractionResponse]:
        """Fast watermark-free TikTok extraction via TikWM API."""
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                resp = await client.get("https://www.tikwm.com/api/", params={"url": url, "hd": 1})
                if resp.status_code != 200:
                    return None
                payload = resp.json()
                if payload.get("code") != 0 or not payload.get("data"):
                    return None
                d = payload["data"]

            def _abs(u: Optional[str]) -> Optional[str]:
                if not u:
                    return None
                return f"https://www.tikwm.com{u}" if u.startswith("/") else u

            post_id = str(d.get("id") or "tiktok_media")
            title = str(d.get("title") or "TikTok Media")
            author_obj = d.get("author") or {}
            author = str(author_obj.get("nickname") or author_obj.get("unique_id") or "TikTok Creator")
            thumbnail = _abs(d.get("origin_cover") or d.get("cover"))
            music_url = _abs(d.get("music"))
            music_title = (d.get("music_info") or {}).get("title") or "Original Sound"

            # Photo slideshow / album
            images = d.get("images") or []
            if images:
                album_items = [
                    AlbumItem(index=i + 1, url=_abs(img_url), ext="jpg", filename=f"photo_{i+1:02d}.jpg")
                    for i, img_url in enumerate(images)
                    if img_url
                ]
                audio_formats = []
                if music_url:
                    audio_formats.append(
                        AudioFormat(
                            formatId="mp3-320",
                            label=f"MP3 - {music_title}",
                            bitrate=320,
                            ext="mp3",
                            hasCoverArt=True,
                            rawAudioUrl=music_url,
                        )
                    )
                return ExtractionResponse(
                    success=True,
                    platform="tiktok",
                    id=post_id,
                    title=title,
                    author=author,
                    duration=0,
                    thumbnail=thumbnail or (album_items[0].url if album_items else None),
                    previewUrl=music_url,
                    mediaType="album",
                    formats={"video": [], "audio": audio_formats},
                    subtitles=None,
                    items=album_items,
                    canDownloadAsZip=len(album_items) > 1,
                    directStreams={
                        "title": title,
                        "author": author,
                        "thumbnail": thumbnail,
                        "best_audio_url": music_url,
                    },
                )

            # Watermark-free video streams only (never wmplay)
            hd_url = _abs(d.get("hdplay"))
            sd_url = _abs(d.get("play"))
            if not hd_url and not sd_url:
                return None

            video_formats: List[VideoFormat] = []
            direct_streams: dict[str, Any] = {
                "title": title,
                "author": author,
                "thumbnail": thumbnail,
                "best_audio_url": music_url or hd_url or sd_url,
            }

            if hd_url:
                video_formats.append(
                    VideoFormat(
                        formatId="1080p",
                        label="1080p Full HD (No Watermark)",
                        ext="mp4",
                        filesizeApprox=d.get("hd_size"),
                        isDefault=True,
                        rawVideoUrl=hd_url,
                    )
                )
                direct_streams["1080p"] = {"video_url": hd_url}
                direct_streams["nowatermark"] = {"video_url": hd_url}

            if sd_url and sd_url != hd_url:
                video_formats.append(
                    VideoFormat(
                        formatId="720p" if hd_url else "1080p",
                        label="HD (No Watermark)" if hd_url else "Original (No Watermark)",
                        ext="mp4",
                        filesizeApprox=d.get("size"),
                        isDefault=not hd_url,
                        rawVideoUrl=sd_url,
                    )
                )
                direct_streams["720p" if hd_url else "1080p"] = {"video_url": sd_url}
                if "nowatermark" not in direct_streams:
                    direct_streams["nowatermark"] = {"video_url": sd_url}

            audio_src = music_url or hd_url or sd_url
            audio_formats = []
            if audio_src:
                audio_formats = [
                    AudioFormat(
                        formatId="mp3-320",
                        label="MP3 High Quality (320 kbps)",
                        bitrate=320,
                        ext="mp3",
                        hasCoverArt=True,
                        rawAudioUrl=audio_src,
                    ),
                    AudioFormat(
                        formatId="m4a-aac",
                        label="M4A / AAC (Apple Native)",
                        bitrate=160,
                        ext="m4a",
                        hasCoverArt=True,
                        rawAudioUrl=audio_src,
                    ),
                ]

            return ExtractionResponse(
                success=True,
                platform="tiktok",
                id=post_id,
                title=title,
                author=author,
                duration=int(d.get("duration") or 0),
                thumbnail=thumbnail,
                previewUrl=sd_url or hd_url,
                mediaType="video",
                formats={"video": video_formats, "audio": audio_formats},
                subtitles=None,
                items=None,
                canDownloadAsZip=False,
                directStreams=direct_streams,
            )
        except Exception:
            return None

    async def extract(self, url: str) -> ExtractionResponse:
        canonical_url = await self.resolve_url(url)

        # Primary: Fast watermark-free TikWM extractor
        tikwm_res = await self._extract_via_tikwm(canonical_url)
        if tikwm_res:
            return tikwm_res

        # Fallback: Web scrape for rehydration data (detects photo slideshows)
        html = ""
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=15.0,
                headers=TIKTOK_HEADERS,
            ) as client:
                resp = await client.get(canonical_url)
                html = resp.text
        except Exception:
            pass

        item_struct = self._parse_rehydration_json(html) if html else None

        # Check if this is a photo slideshow / album post
        if item_struct and item_struct.get("imagePost"):
            return self._build_photo_album_response(item_struct, canonical_url)

        # Video post: Extract using yt-dlp for best CDN streams and reliability
        ytdl_info: Optional[dict[str, Any]] = None
        try:
            ytdl_info = await asyncio.to_thread(self._extract_via_ytdlp, canonical_url)
        except Exception:
            pass

        if ytdl_info:
            return self._build_ytdl_video_response(ytdl_info, canonical_url)

        # If yt-dlp failed but itemStruct exists from HTML:
        if item_struct:
            return self._build_itemstruct_video_response(item_struct, canonical_url)

        raise ValueError(f"Could not extract TikTok media from URL: {url}")

    def _build_photo_album_response(
        self,
        item: dict[str, Any],
        canonical_url: str,
    ) -> ExtractionResponse:
        """Construct response for TikTok multi-photo slideshows."""
        post_id = str(item.get("id") or "tiktok_album")
        desc = str(item.get("desc") or "TikTok Photos")
        author_info = item.get("author") or {}
        author = str(author_info.get("nickname") or author_info.get("uniqueId") or "TikTok Creator")

        image_posts = item.get("imagePost", {}).get("images", [])
        album_items: List[AlbumItem] = []

        for idx, img in enumerate(image_posts, start=1):
            url_list = img.get("imageURL", {}).get("urlList") or []
            if url_list:
                # Pick the highest quality / longest URL or first available
                img_url = url_list[0]
                w = img.get("imageWidth")
                h = img.get("imageHeight")
                album_items.append(
                    AlbumItem(
                        index=idx,
                        url=img_url,
                        width=w,
                        height=h,
                        ext="jpg",
                        filename=f"photo_{idx:02d}.jpg",
                    )
                )

        # Background music
        music = item.get("music") or {}
        music_url = music.get("playUrl")
        audio_formats: List[AudioFormat] = []
        if music_url:
            audio_formats.append(
                AudioFormat(
                    formatId="audio-original",
                    label=f"Background Music - {music.get('title', 'Original Sound')} (MP3)",
                    bitrate=192,
                    ext="mp3",
                    hasCoverArt=True,
                    rawAudioUrl=music_url,
                )
            )

        thumbnail = album_items[0].url if album_items else None

        return ExtractionResponse(
            success=True,
            platform="tiktok",
            id=post_id,
            title=desc,
            author=author,
            duration=0,
            thumbnail=thumbnail,
            mediaType="album",
            formats={"video": [], "audio": audio_formats},
            subtitles=None,
            items=album_items,
            canDownloadAsZip=True,
            directStreams={
                "title": desc,
                "author": author,
                "thumbnail": thumbnail,
                "best_audio_url": music_url,
            },
        )

    def _build_ytdl_video_response(
        self,
        info: dict[str, Any],
        canonical_url: str,
    ) -> ExtractionResponse:
        """Construct response for watermark-free TikTok video from yt-dlp metadata."""
        video_id = str(info.get("id") or "tiktok_video")
        title = str(info.get("title") or info.get("description") or "TikTok Video")
        author = str(info.get("uploader") or info.get("creator") or "TikTok Creator")
        duration = int(info.get("duration") or 0)
        thumbnail = info.get("thumbnail")

        formats = info.get("formats") or []
        # Filter progressive mp4 formats excluding watermarked ones
        valid_formats = [
            f for f in formats
            if f.get("url")
            and (f.get("ext") == "mp4" or "video" in str(f.get("format_note", "")))
            and not (
                "watermark" in str(f.get("format_note", "")).lower()
                and "no" not in str(f.get("format_note", "")).lower()
                and "free" not in str(f.get("format_note", "")).lower()
            )
            and str(f.get("format_id", "")).lower() != "download"
        ]
        if not valid_formats:
            valid_formats = [f for f in formats if f.get("url") and f.get("ext") == "mp4"]

        # In yt-dlp for TikTok, the best format or format_note "watermark-free" is ideal
        best_video = None
        if valid_formats:
            best_video = max(
                valid_formats,
                key=lambda f: (
                    1 if "no watermark" in str(f.get("format_note", "")).lower() else 0,
                    f.get("height") or 0,
                    f.get("tbr") or 0,
                ),
            )
        else:
            best_video = {"url": info.get("url"), "height": 1080, "ext": "mp4"}

        v_url = best_video.get("url") or info.get("url")
        w = best_video.get("width") or 0
        h = best_video.get("height") or 0
        tier = min(w, h) if (w and h) else h
        q_label = f"MP4 Watermark-Free ({tier}p)" if tier else "MP4 Watermark-Free (Original)"

        video_formats: List[VideoFormat] = [
            VideoFormat(
                formatId="nowatermark",
                label=q_label,
                ext="mp4",
                resolution=f"{w}x{h}" if (w and h) else None,
                filesizeApprox=best_video.get("filesize") or best_video.get("filesize_approx"),
                isDefault=True,
                rawVideoUrl=v_url,
            )
        ]

        # Audio formats
        audio_formats: List[AudioFormat] = [
            AudioFormat(
                formatId="mp3-320",
                label="MP3 High Quality (320 kbps)",
                bitrate=320,
                ext="mp3",
                hasCoverArt=True,
                rawAudioUrl=v_url,
            ),
            AudioFormat(
                formatId="m4a-aac",
                label="M4A / AAC (Apple Native)",
                bitrate=160,
                ext="m4a",
                hasCoverArt=True,
                rawAudioUrl=v_url,
            ),
        ]

        direct_streams = {
            "title": title,
            "author": author,
            "thumbnail": thumbnail,
            "nowatermark": {"video_url": v_url},
            "best_audio_url": v_url,
        }

        return ExtractionResponse(
            success=True,
            platform="tiktok",
            id=video_id,
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
            directStreams=direct_streams,
        )

    def _build_itemstruct_video_response(
        self,
        item: dict[str, Any],
        canonical_url: str,
    ) -> ExtractionResponse:
        """Fallback builder using itemStruct directly."""
        video_id = str(item.get("id") or "tiktok_video")
        desc = str(item.get("desc") or "TikTok Video")
        author_info = item.get("author") or {}
        author = str(author_info.get("nickname") or "TikTok Creator")

        video = item.get("video") or {}
        # Try playAddr or bitrateInfo for unwatermarked video
        v_url = video.get("playAddr") or video.get("downloadAddr")
        bitrates = video.get("bitrateInfo") or []
        if bitrates:
            play_addrs = bitrates[0].get("PlayAddr", {}).get("UrlList") or []
            if play_addrs:
                v_url = play_addrs[0]

        h = video.get("height") or 1080
        thumbnail = video.get("cover")

        video_formats = [
            VideoFormat(
                formatId="nowatermark",
                label=f"MP4 Watermark-Free ({h}p HD)",
                ext="mp4",
                resolution=f"{video.get('width') or 1080}x{h}",
                isDefault=True,
                rawVideoUrl=v_url,
            )
        ]

        audio_formats = [
            AudioFormat(
                formatId="mp3-320",
                label="MP3 High Quality (320 kbps)",
                bitrate=320,
                ext="mp3",
                hasCoverArt=True,
                rawAudioUrl=v_url,
            )
        ]

        direct_streams = {
            "title": desc,
            "author": author,
            "thumbnail": thumbnail,
            "nowatermark": {"video_url": v_url},
            "best_audio_url": v_url,
        }

        return ExtractionResponse(
            success=True,
            platform="tiktok",
            id=video_id,
            title=desc,
            author=author,
            duration=int(video.get("duration") or 0),
            thumbnail=thumbnail,
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

        v_info = extract_res.directStreams.get(format_id) or extract_res.directStreams.get("nowatermark")
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
