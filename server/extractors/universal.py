"""Universal Fallback Platform Extractor (yt-dlp + Direct Media).

Supports 1,800+ platforms supported by yt-dlp (Instagram, Twitter/X, Vimeo,
SoundCloud, Reddit, Twitch, Dailymotion, Threads, etc.) as well as direct
media/file URLs (.mp4, .mp3, .jpg, .png, .gif, .webp, .pdf, .zip).
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
import httpx
import yt_dlp

from server.config import settings, system_paths
from server.extractors.base import (
    AudioFormat,
    BaseExtractor,
    ExtractionResponse,
    StreamTarget,
    Subtitle,
    VideoFormat,
    build_real_video_formats,
)
from server.services.zip_service import validate_url_ssrf

TARGET_RESOLUTIONS = [
    (2160, "4k", "4K Ultra HD"),
    (1440, "1440p", "1440p Quad HD"),
    (1080, "1080p", "1080p Full HD"),
    (720, "720p", "720p HD"),
    (480, "480p", "480p SD"),
    (360, "360p", "360p"),
    (240, "240p", "240p"),
]

HTTP_URL_RE = re.compile(r"^https?://[^\s/$.?#].[^\s]*$", re.IGNORECASE)


class UniversalExtractor(BaseExtractor):
    platform_name = "universal"

    def can_handle(self, url: str) -> bool:
        return bool(HTTP_URL_RE.match(url.strip()))

    def _get_ydl_opts(self) -> dict[str, Any]:
        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": False,
            "noplaylist": True,
            "socket_timeout": 20,
        }
        if system_paths.node_path:
            opts["js_runtimes"] = {"node": {}}
        if settings.cookies_file:
            opts["cookiefile"] = settings.cookies_file
        return opts

    def _extract_sync(self, url: str) -> dict[str, Any]:
        with yt_dlp.YoutubeDL(self._get_ydl_opts()) as ydl:
            return ydl.extract_info(url, download=False) or {}

    def _detect_platform_label(self, info: dict[str, Any], url: str) -> str:
        key = str(info.get("extractor_key") or info.get("extractor") or "").lower()
        if "instagram" in key:
            return "instagram"
        if "twitter" in key or "x.com" in url.lower():
            return "twitter"
        if "soundcloud" in key:
            return "soundcloud"
        if "vimeo" in key:
            return "vimeo"
        if "reddit" in key:
            return "reddit"
        if "twitch" in key:
            return "twitch"
        if key and key != "generic":
            return key.split(":")[0]
        host = (urlparse(url).hostname or "web").replace("www.", "")
        return host.split(".")[0] or "web"

    async def _probe_direct_media(self, url: str) -> Optional[ExtractionResponse]:
        """Fallback probe for direct media/file links (MP4, MP3, JPG, PNG, GIF, PDF, ZIP)."""
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=10.0,
                headers={"User-Agent": "Mozilla/5.0"},
            ) as client:
                resp = await client.head(url)
                if resp.status_code >= 400:
                    return None
                ctype = (resp.headers.get("content-type") or "").lower()
                clen_raw = resp.headers.get("content-length")
                clen = int(clen_raw) if clen_raw and clen_raw.isdigit() else None
        except Exception:
            return None

        parsed = urlparse(url)
        path_name = parsed.path.rstrip("/").split("/")[-1] or "media_file"
        ext = path_name.split(".")[-1].lower() if "." in path_name else ""
        host = (parsed.hostname or "web").replace("www.", "")

        if ctype.startswith("video/"):
            ext = ext or ctype.split("/")[-1].split(";")[0]
            vf = VideoFormat(
                formatId="original",
                label=f"Original Video ({ext.upper()})",
                ext=ext,
                filesizeApprox=clen,
                isDefault=True,
                rawVideoUrl=url,
            )
            return ExtractionResponse(
                success=True,
                platform=host.split(".")[0] or "web",
                id=path_name,
                title=path_name,
                author=host,
                previewUrl=url,
                mediaType="video",
                formats={"video": [vf], "audio": []},
                directStreams={"original": {"video_url": url, "audio_url": None}, "title": path_name, "author": host},
            )

        if ctype.startswith("audio/"):
            ext = ext or "mp3"
            af = AudioFormat(
                formatId="original",
                label=f"Original Audio ({ext.upper()})",
                bitrate=192,
                ext=ext,
                hasCoverArt=False,
                rawAudioUrl=url,
            )
            return ExtractionResponse(
                success=True,
                platform=host.split(".")[0] or "web",
                id=path_name,
                title=path_name,
                author=host,
                mediaType="audio",
                formats={"video": [], "audio": [af]},
                directStreams={"best_audio_url": url, "title": path_name, "author": host},
            )

        if ctype.startswith("image/"):
            ext = ext or ctype.split("/")[-1].split(";")[0]
            if ext == "jpeg":
                ext = "jpg"
            return ExtractionResponse(
                success=True,
                platform=host.split(".")[0] or "web",
                id=path_name,
                title=path_name,
                author=host,
                thumbnail=url,
                mediaType="photo",
                formats={"video": [], "audio": []},
                directStreams={"direct_photo_url": url, "photo_ext": ext, "title": path_name, "author": host},
            )

        return None

    async def extract(self, url: str) -> ExtractionResponse:
        clean_url = url.strip()
        validate_url_ssrf(clean_url)

        info: dict[str, Any] = {}
        yt_error: Optional[Exception] = None
        try:
            info = await asyncio.to_thread(self._extract_sync, clean_url)
        except Exception as exc:
            yt_error = exc

        if not info:
            direct = await self._probe_direct_media(clean_url)
            if direct:
                return direct
            msg = str(yt_error) if yt_error else "No media found at URL."
            raise ValueError(f"Could not extract media from URL: {msg}")

        # If yt-dlp returned a playlist/carousel wrapper, unwrap first item
        if info.get("_type") == "playlist" and info.get("entries"):
            entries = [e for e in info["entries"] if e]
            if entries:
                info = entries[0]

        platform_label = self._detect_platform_label(info, clean_url)
        video_id = str(info.get("id") or "media")
        title = str(info.get("title") or f"{platform_label.capitalize()} Media")
        author = str(info.get("uploader") or info.get("channel") or info.get("artist") or platform_label.capitalize())
        duration = int(info.get("duration") or 0)
        thumbnail_url = info.get("thumbnail")

        # Handle direct image/media URLs matched as GenericIE (including unknown_video)
        raw_ext = str(info.get("ext") or "").lower()
        if raw_ext in ("jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"):
            photo_ext = "jpg" if raw_ext == "jpeg" else raw_ext
            photo_url = info.get("url") or clean_url
            return ExtractionResponse(
                success=True,
                platform=platform_label,
                id=video_id,
                title=title,
                author=author,
                thumbnail=photo_url,
                mediaType="photo",
                formats={"video": [], "audio": []},
                directStreams={"direct_photo_url": photo_url, "photo_ext": photo_ext, "title": title, "author": author},
            )

        if raw_ext == "unknown_video" or (not info.get("formats") and info.get("extractor_key") == "Generic"):
            direct = await self._probe_direct_media(clean_url)
            if direct:
                return direct

        if not thumbnail_url and info.get("thumbnails"):
            thumbs = [t for t in info["thumbnails"] if t.get("url")]
            if thumbs:
                thumbnail_url = thumbs[-1]["url"]

        all_formats = info.get("formats") or []
        direct_url = info.get("url")

        # Identify best audio
        best_audio = None
        audio_candidates = [
            f for f in all_formats
            if f.get("acodec") != "none" and (f.get("vcodec") == "none" or not f.get("vcodec"))
        ]
        if audio_candidates:
            best_audio = max(audio_candidates, key=lambda f: (f.get("abr") or 0))
        elif all_formats:
            with_audio = [f for f in all_formats if f.get("acodec") != "none"]
            if with_audio:
                best_audio = max(with_audio, key=lambda f: (f.get("abr") or 0))

        # Build Video Formats from only actual available resolutions
        video_candidates = [f for f in all_formats if f.get("vcodec") != "none" and f.get("url")]
        video_formats = build_real_video_formats(
            video_candidates,
            best_audio_url=best_audio.get("url") if best_audio else None,
            check_muxed=True,
        )
        if not video_formats and direct_url and info.get("ext") in ("mp4", "mov", "webm", "mkv"):
            video_formats.append(
                VideoFormat(
                    formatId="best",
                    label="Original Quality (MP4)",
                    ext="mp4",
                    isDefault=True,
                    rawVideoUrl=direct_url,
                )
            )

        # Audio formats
        audio_source_url = (best_audio.get("url") if best_audio else None) or (
            direct_url if not video_formats else None
        )
        audio_formats: List[AudioFormat] = []
        if audio_source_url or video_formats:
            fallback_src = audio_source_url or (video_formats[0].rawVideoUrl if video_formats else None)
            audio_formats = [
                AudioFormat(
                    formatId="mp3-320",
                    label="MP3 High Quality (320 kbps)",
                    bitrate=320,
                    ext="mp3",
                    hasCoverArt=bool(thumbnail_url),
                    rawAudioUrl=fallback_src,
                ),
                AudioFormat(
                    formatId="mp3-192",
                    label="MP3 Standard (192 kbps)",
                    bitrate=192,
                    ext="mp3",
                    hasCoverArt=bool(thumbnail_url),
                    rawAudioUrl=fallback_src,
                ),
                AudioFormat(
                    formatId="m4a-aac",
                    label="M4A / AAC (Apple Native)",
                    bitrate=160,
                    ext="m4a",
                    hasCoverArt=bool(thumbnail_url),
                    rawAudioUrl=fallback_src,
                ),
            ]

        # Subtitles
        subtitles_list: List[Subtitle] = []
        raw_subs = info.get("subtitles") or {}
        for lang_code, formats in raw_subs.items():
            if not isinstance(formats, list):
                continue
            srt_vtt = next((sf for sf in formats if sf.get("ext") in ("srt", "vtt")), None)
            if srt_vtt and srt_vtt.get("url"):
                subtitles_list.append(
                    Subtitle(
                        lang=lang_code,
                        label=lang_code.upper(),
                        ext=srt_vtt.get("ext", "srt"),
                        url=srt_vtt.get("url"),
                    )
                )

        direct_streams: dict[str, Any] = {
            "title": title,
            "author": author,
            "thumbnail": thumbnail_url,
            "best_audio_url": audio_source_url or (video_formats[0].rawVideoUrl if video_formats else None),
        }
        for vf in video_formats:
            direct_streams[vf.formatId] = {
                "video_url": vf.rawVideoUrl,
                "audio_url": vf.rawAudioUrl,
            }

        muxed_mp4s = [
            f for f in all_formats
            if f.get("url") and f.get("vcodec") != "none" and f.get("acodec") != "none" and f.get("ext") == "mp4"
        ]
        preview_url = (
            max(muxed_mp4s, key=lambda f: f.get("height") or 0).get("url")
            if muxed_mp4s
            else (video_formats[0].rawVideoUrl if video_formats and not video_formats[0].rawAudioUrl else None)
        )

        media_type = "video" if video_formats else "audio"

        return ExtractionResponse(
            success=True,
            platform=platform_label,
            id=video_id,
            title=title,
            author=author,
            duration=duration,
            thumbnail=thumbnail_url,
            previewUrl=preview_url,
            mediaType=media_type,
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
        extract_res = await self.extract(url)

        if extract_res.mediaType == "photo" and extract_res.directStreams.get("direct_photo_url"):
            return StreamTarget(
                mediaType="photo",
                title=extract_res.title,
                author=extract_res.author,
                directUrl=extract_res.directStreams["direct_photo_url"],
                ext=extract_res.directStreams.get("photo_ext", "jpg"),
            )

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

        video_info = extract_res.directStreams.get(format_id)
        if not video_info:
            vf_list = extract_res.formats.get("video") or []
            if vf_list:
                format_id = vf_list[0].formatId
                video_info = extract_res.directStreams.get(format_id)

        v_url = video_info.get("video_url") if video_info else None
        a_url = video_info.get("audio_url") if video_info else None

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
