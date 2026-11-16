"""YouTube Platform Extractor.

Extracts multi-resolution video streams (defaulting to 1080p),
high-fidelity audio streams (MP3/M4A), max resolution thumbnails (JPG),
and subtitles (.srt/.vtt) using in-memory yt-dlp with Node.js challenge solving.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional
import yt_dlp

from server.config import settings, system_paths
from server.extractors.base import (
    AlbumItem,
    AudioFormat,
    BaseExtractor,
    ExtractionResponse,
    StreamTarget,
    Subtitle,
    URL_PATTERNS,
    VideoFormat,
    build_real_video_formats,
)

TARGET_RESOLUTIONS = [
    (2160, "4k", "4K Ultra HD"),
    (1440, "1440p", "1440p Quad HD"),
    (1080, "1080p", "1080p Full HD"),
    (720, "720p", "720p HD"),
    (480, "480p", "480p SD"),
    (360, "360p", "360p"),
    (240, "240p", "240p"),
]


class YouTubeExtractor(BaseExtractor):
    platform_name = "youtube"

    def can_handle(self, url: str) -> bool:
        return bool(URL_PATTERNS["youtube"].search(url))

    def _get_ydl_opts(self) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": False,
            "noplaylist": True,
        }
        if system_paths.node_path:
            opts["js_runtimes"] = {"node": {}}
        if settings.cookies_file:
            opts["cookiefile"] = settings.cookies_file
        return opts

    def _extract_sync(self, url: str) -> dict[str, Any]:
        with yt_dlp.YoutubeDL(self._get_ydl_opts()) as ydl:
            return ydl.extract_info(url, download=False) or {}

    async def extract(self, url: str) -> ExtractionResponse:
        resolved_url = await self.resolve_url(url)
        info = await asyncio.to_thread(self._extract_sync, resolved_url)

        if not info:
            raise ValueError(f"Could not extract info from YouTube URL: {url}")

        video_id = str(info.get("id") or "")
        title = str(info.get("title") or "YouTube Video")
        author = str(info.get("uploader") or info.get("channel") or "YouTube Creator")
        duration = int(info.get("duration") or 0)

        # 1. Thumbnails: Find highest resolution JPG thumbnail (maxresdefault with fallback to hqdefault)
        thumbnail_url = None
        thumbnails = info.get("thumbnails") or []
        # Filter for JPG/JPEG thumbnails
        jpg_thumbs = [t for t in thumbnails if t.get("url") and ".webp" not in t["url"].lower()]

        for t in reversed(jpg_thumbs):
            if "maxresdefault.jpg" in t["url"]:
                thumbnail_url = t["url"]
                break

        if not thumbnail_url and jpg_thumbs:
            best_thumb = max(
                jpg_thumbs,
                key=lambda x: (x.get("width") or 0) * (x.get("height") or 0),
            )
            thumbnail_url = best_thumb.get("url")

        if not thumbnail_url:
            thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg" if video_id else None

        # 2. Formats: Separate video and audio streams
        all_formats = info.get("formats") or []

        # Find best audio stream
        best_audio = None
        audio_candidates = [
            f for f in all_formats
            if f.get("acodec") != "none" and (f.get("vcodec") == "none" or not f.get("vcodec"))
        ]
        if audio_candidates:
            # Sort by audio bitrate (abr)
            best_audio = max(audio_candidates, key=lambda f: (f.get("abr") or 0))
        elif all_formats:
            # Fallback to any format containing audio
            with_audio = [f for f in all_formats if f.get("acodec") != "none"]
            if with_audio:
                best_audio = max(with_audio, key=lambda f: (f.get("abr") or 0))

        # Build Video Formats list from only actual available resolutions
        video_candidates = [f for f in all_formats if f.get("vcodec") != "none"]
        video_formats = build_real_video_formats(
            video_candidates,
            best_audio_url=best_audio.get("url") if best_audio else None,
            check_muxed=True,
        )

        # Build Audio Formats
        audio_formats: List[AudioFormat] = [
            AudioFormat(
                formatId="mp3-320",
                label="MP3 High Quality (320 kbps)",
                bitrate=320,
                ext="mp3",
                hasCoverArt=True,
                rawAudioUrl=best_audio.get("url") if best_audio else None,
            ),
            AudioFormat(
                formatId="mp3-192",
                label="MP3 Standard (192 kbps)",
                bitrate=192,
                ext="mp3",
                hasCoverArt=True,
                rawAudioUrl=best_audio.get("url") if best_audio else None,
            ),
            AudioFormat(
                formatId="m4a-aac",
                label="M4A / AAC (Apple Native)",
                bitrate=160,
                ext="m4a",
                hasCoverArt=True,
                rawAudioUrl=best_audio.get("url") if best_audio else None,
            ),
        ]

        # 3. Subtitles
        subtitles_list: List[Subtitle] = []
        raw_subs = info.get("subtitles") or {}
        raw_auto = info.get("automatic_captions") or {}

        # Combine manual and auto subtitles (prioritizing manual)
        combined_subs: dict[str, Any] = {**raw_auto, **raw_subs}
        for lang_code, formats in combined_subs.items():
            if not isinstance(formats, list):
                continue
            # Look for srt or vtt
            srt_vtt = next(
                (sf for sf in formats if sf.get("ext") in ("srt", "vtt")),
                None,
            )
            if srt_vtt and srt_vtt.get("url"):
                lang_label = lang_code.upper()
                if lang_code == "en":
                    lang_label = "English"
                elif lang_code == "ar":
                    lang_label = "Arabic (العربية)"
                subtitles_list.append(
                    Subtitle(
                        lang=lang_code,
                        label=lang_label,
                        ext=srt_vtt.get("ext", "srt"),
                        url=srt_vtt.get("url"),
                    )
                )

        # Pick best muxed progressive MP4 for instant in-app preview & trim preview
        progressive_mp4s = [
            f for f in all_formats
            if f.get("url") and f.get("vcodec") != "none" and f.get("acodec") != "none" and f.get("ext") == "mp4"
        ]
        preview_url = (
            max(progressive_mp4s, key=lambda f: f.get("height") or 0).get("url")
            if progressive_mp4s
            else (video_formats[0].rawVideoUrl if video_formats and not video_formats[0].rawAudioUrl else None)
        )

        # Store direct URLs in hidden directStreams map for instant retrieval during download
        direct_streams: dict[str, Any] = {
            "title": title,
            "author": author,
            "thumbnail": thumbnail_url,
            "preview_url": preview_url,
            "best_audio_url": best_audio.get("url") if best_audio else None,
        }
        for vf in video_formats:
            direct_streams[vf.formatId] = {
                "video_url": vf.rawVideoUrl,
                "audio_url": vf.rawAudioUrl,
            }

        return ExtractionResponse(
            success=True,
            platform="youtube",
            id=video_id,
            title=title,
            author=author,
            duration=duration,
            thumbnail=thumbnail_url,
            previewUrl=preview_url,
            mediaType="video",
            formats={"video": video_formats, "audio": audio_formats},
            subtitles=subtitles_list if subtitles_list else None,
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
        """Resolve direct stream URLs for YouTube video/audio/thumbnail/subtitles."""
        extract_res = await self.extract(url)

        if media_type in ("photo", "thumbnail") or format_id in ("thumbnail", "photo", "original", "orig"):
            return StreamTarget(
                mediaType="photo",
                title=extract_res.title,
                author=extract_res.author,
                directUrl=extract_res.thumbnail,
                ext="jpg",
            )

        if media_type == "subtitles":
            subs = extract_res.subtitles or []
            matched = next((s for s in subs if s.lang == format_id), subs[0] if subs else None)
            if not matched or not matched.url:
                raise ValueError(f"Subtitle language '{format_id}' not found")
            return StreamTarget(
                mediaType="subtitles",
                title=extract_res.title,
                author=extract_res.author,
                directUrl=matched.url,
                ext=matched.ext or "srt",
            )

        best_audio_url = extract_res.directStreams.get("best_audio_url")

        if media_type == "audio":
            bitrate = 320
            ext = "mp3"
            if "192" in format_id:
                bitrate = 192
            elif "m4a" in format_id or "aac" in format_id:
                ext = "m4a"
                bitrate = 160

            return StreamTarget(
                mediaType="audio",
                title=extract_res.title,
                author=extract_res.author,
                thumbnailUrl=extract_res.thumbnail,
                audioUrl=best_audio_url,
                ext=ext,
                needsTranscode=True,
                targetBitrate=bitrate,
            )

        # Video stream
        video_info = extract_res.directStreams.get(format_id)
        if not video_info:
            # Fallback to first available video format
            vf_list = extract_res.formats.get("video") or []
            if vf_list:
                format_id = vf_list[0].formatId
                video_info = extract_res.directStreams.get(format_id)

        v_url = video_info.get("video_url") if video_info else None
        a_url = video_info.get("audio_url") if video_info else best_audio_url

        return StreamTarget(
            mediaType="video",
            title=extract_res.title,
            author=extract_res.author,
            thumbnailUrl=extract_res.thumbnail,
            videoUrl=v_url,
            audioUrl=a_url,
            ext="mp4",
            isDashMerge=bool(v_url and a_url and v_url != a_url),
            directUrl=v_url if not a_url or v_url == a_url else None,
        )
