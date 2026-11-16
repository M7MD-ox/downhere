"""DownMe FastAPI Application & Route Dispatcher.

Handles:
- POST /api/extract
- GET  /api/download
- POST /api/download/zip
- GET  /api/health
- POST /api/system/update
- Static file serving on / (PWA client & Thmanyah fonts)
"""

from __future__ import annotations

import io
import logging
import mimetypes
import os
from pathlib import Path
from typing import Optional
import httpx
from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

# Explicitly register modern web & font MIME types in Python registry
mimetypes.add_type("font/otf", ".otf")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")

# MIME mapping for FileResponse overrides
MIME_MAP = {
    ".otf": "font/otf",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".shortcut": "application/octet-stream",
}


def create_static_file_response(path: Path) -> FileResponse:
    """Build a FileResponse with strict MIME type and PWA headers."""
    suffix = path.suffix.lower()
    media_type = MIME_MAP.get(suffix) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    headers: dict[str, str] = {}
    if path.name == "sw.js":
        headers["Service-Worker-Allowed"] = "/"
        headers["Cache-Control"] = "no-cache"
    return FileResponse(path, media_type=media_type, headers=headers if headers else None)

from server.config import settings, system_paths
from server.extractors import get_extractor
from server.extractors.base import ExtractionResponse
from server.services.ffmpeg import ffmpeg_service
from server.services.health_service import health_service
from server.services.updater_service import updater_service
from server.services.zip_service import ZipAlbumRequest, validate_url_ssrf, zip_service
from server.utils.sanitizer import build_content_disposition, sanitize_filename


# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("downme.main")

app = FastAPI(
    title="DownMe Media Extraction API",
    description="Apple-minimalist media extraction and streaming service",
    version="1.0.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request schemas
class ExtractRequest(BaseModel):
    url: str


def parse_trim_timestamp(val: str) -> float:
    """Parse and validate trimmer timestamp (HH:MM:SS, MM:SS, or seconds).

    Rejects negative, non-numeric, or malformed time ranges with ValueError.
    """
    if not val or not isinstance(val, str):
        raise ValueError("Timestamp string cannot be empty")

    s = val.strip()
    if not s:
        raise ValueError("Timestamp string cannot be empty")

    # Reject negative signs or command injection attempts
    if "-" in s:
        raise ValueError(f"Negative or invalid timestamp not allowed: {val}")

    if ":" in s:
        parts = s.split(":")
        if len(parts) not in (2, 3):
            raise ValueError(f"Malformed timecode: {val}")
        try:
            num_parts = [float(p) for p in parts]
        except ValueError as e:
            raise ValueError(f"Non-numeric component in timecode: {val}") from e

        if any(p < 0 for p in num_parts):
            raise ValueError(f"Negative component in timecode: {val}")

        if len(num_parts) == 2:
            mins, secs = num_parts
            return mins * 60.0 + secs
        else:
            hrs, mins, secs = num_parts
            return hrs * 3600.0 + mins * 60.0 + secs
    else:
        try:
            secs = float(s)
        except ValueError as e:
            raise ValueError(f"Non-numeric timestamp: {val}") from e

        if secs < 0:
            raise ValueError(f"Negative timestamp not allowed: {val}")
        return secs


# API Routes
@app.post("/api/extract", response_model=ExtractionResponse)
async def extract_media(req: ExtractRequest):
    """Extract media metadata and stream options from a supported media URL."""
    if "\x00" in req.url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid URL: contains null bytes",
        )

    url = req.url.strip()
    if not url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Media URL is required",
        )

    try:
        extractor = get_extractor(url)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    try:
        response = await extractor.extract(url)
        return response
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        logger.exception("Extraction failed for URL: %s", url)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Media extraction failed: {str(e)}",
        )


@app.get("/api/download")
async def download_media(
    url: str = Query(..., description="Target media URL"),
    formatId: str = Query("1080p", description="Requested format identifier"),
    mediaType: str = Query("video", description="Media type: video, audio, photo, or thumbnail"),
    trimStart: Optional[str] = Query(None, description="Trimming start timestamp (HH:MM:SS or seconds)"),
    trimEnd: Optional[str] = Query(None, description="Trimming end timestamp (HH:MM:SS or seconds)"),
    embedCover: bool = Query(True, description="Whether to embed cover art in audio files"),
    filename: Optional[str] = Query(None, description="Optional custom filename override"),
):
    """Stream media directly to client with real-time FFmpeg processing,

    RFC 5987 Content-Disposition header, and format transcoding.
    """
    if "\x00" in url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid URL: contains null bytes",
        )

    # Validate trimmer timestamps
    start_sec: Optional[float] = None
    end_sec: Optional[float] = None

    if trimStart is not None and trimStart.strip() != "":
        try:
            start_sec = parse_trim_timestamp(trimStart)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid trimmer time range: {str(e)}",
            )

    if trimEnd is not None and trimEnd.strip() != "":
        try:
            end_sec = parse_trim_timestamp(trimEnd)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid trimmer time range: {str(e)}",
            )

    if start_sec is not None and end_sec is not None:
        if start_sec >= end_sec:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid trimmer time range: trimStart must be strictly less than trimEnd",
            )

    clean_url = url.strip()
    try:
        extractor = get_extractor(clean_url)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    try:
        target = await extractor.get_stream_target(clean_url, formatId, mediaType)
    except Exception as e:
        logger.exception("Failed to resolve stream target for %s", clean_url)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to resolve media stream: {str(e)}",
        )

    file_title = filename or target.title or "media"

    # 0. Subtitles download
    if target.mediaType == "subtitles" or mediaType == "subtitles":
        sub_url = target.directUrl
        if not sub_url:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subtitle track not found")

        ext = target.ext or "srt"
        clean_filename = sanitize_filename(file_title, ext=ext)
        content_disp = build_content_disposition(clean_filename)

        async def _stream_subtitles():
            async with httpx.AsyncClient(follow_redirects=True) as client:
                resp = await client.get(sub_url, timeout=20.0)
                if resp.status_code != 200:
                    raise HTTPException(status_code=404, detail="Subtitle track could not be retrieved")
                yield resp.content

        return StreamingResponse(
            _stream_subtitles(),
            media_type="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": content_disp,
            },
        )

    # 1. Photo / Thumbnail download
    if target.mediaType == "photo" or mediaType in ("photo", "thumbnail"):
        direct_url = target.directUrl or target.thumbnailUrl
        if not direct_url:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo URL not found")

        ext = target.ext or "jpg"
        clean_filename = sanitize_filename(file_title, ext=ext)
        content_disp = build_content_disposition(clean_filename)

        content_type_map = {
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
            "webp": "image/webp",
            "gif": "image/gif",
        }
        content_type = content_type_map.get(ext.lower(), "image/jpeg")

        async def _stream_direct_image():
            urls_to_try = [direct_url]
            if "maxresdefault" in direct_url:
                urls_to_try.append(direct_url.replace("maxresdefault.jpg", "hqdefault.jpg").replace("maxresdefault.webp", "hqdefault.jpg"))

            async with httpx.AsyncClient(follow_redirects=True) as client:
                for target_fetch_url in urls_to_try:
                    try:
                        async with client.stream("GET", target_fetch_url, timeout=30.0) as resp:
                            if resp.status_code == 200:
                                async for chunk in resp.aiter_bytes(chunk_size=64 * 1024):
                                    yield chunk
                                return
                    except Exception:
                        continue
                raise HTTPException(status_code=404, detail="Image could not be retrieved")

        return StreamingResponse(
            _stream_direct_image(),
            media_type=content_type,
            headers={
                "Content-Disposition": content_disp,
                "Transfer-Encoding": "chunked",
            },
        )

    # 2. Audio extraction / transcoding
    if target.mediaType == "audio" or mediaType == "audio":
        audio_stream_url = target.audioUrl or target.directUrl or target.videoUrl
        if not audio_stream_url:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio stream not found")

        ext = target.ext or ("mp3" if "mp3" in formatId else "m4a")
        clean_filename = sanitize_filename(file_title, ext=ext)
        content_disp = build_content_disposition(clean_filename)
        content_type = "audio/mpeg" if ext == "mp3" else "audio/mp4"

        stream_gen = ffmpeg_service.stream_audio_transcode(
            audio_url=audio_stream_url,
            ext=ext,
            bitrate=target.targetBitrate or 320,
            title=target.title,
            author=target.author,
            thumbnail_url=target.thumbnailUrl,
            embed_cover=embedCover,
            trim_start=trimStart,
            trim_end=trimEnd,
        )

        return StreamingResponse(
            stream_gen,
            media_type=content_type,
            headers={
                "Content-Disposition": content_disp,
                "Transfer-Encoding": "chunked",
            },
        )

    # 3. Video streaming (DASH merge or cut)
    ext = "mp4"
    clean_filename = sanitize_filename(file_title, ext=ext)
    content_disp = build_content_disposition(clean_filename)

    if target.isDashMerge and target.videoUrl and target.audioUrl:
        # Merge separate DASH video + audio
        stream_gen = ffmpeg_service.stream_dash_merge(
            video_url=target.videoUrl,
            audio_url=target.audioUrl,
            trim_start=trimStart,
            trim_end=trimEnd,
        )
    elif target.videoUrl:
        # Stream progressive video with optional cut
        stream_gen = ffmpeg_service.stream_video_cut(
            video_url=target.videoUrl,
            trim_start=trimStart,
            trim_end=trimEnd,
        )
    elif target.directUrl:
        stream_gen = ffmpeg_service.stream_video_cut(
            video_url=target.directUrl,
            trim_start=trimStart,
            trim_end=trimEnd,
        )
    else:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video stream not available")

    return StreamingResponse(
        stream_gen,
        media_type="video/mp4",
        headers={
            "Content-Disposition": content_disp,
            "Transfer-Encoding": "chunked",
            "Accept-Ranges": "bytes",
        },
    )


@app.post("/api/download/zip")
async def download_album_zip(req: ZipAlbumRequest):
    """Bundle multi-photo slideshows or albums into an in-memory streaming ZIP archive."""
    if not req.items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Album items list cannot be empty",
        )

    for item in req.items:
        if "\x00" in item.url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid URL: contains null bytes",
            )
        try:
            validate_url_ssrf(item.url)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )

    clean_filename = sanitize_filename(req.albumTitle, ext="zip", default_name="album.zip")
    content_disp = build_content_disposition(clean_filename)

    try:
        zip_bytes = await zip_service.build_album_zip_bytes(req.items)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No media files could be retrieved",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    async def _stream_zip():
        buf = io.BytesIO(zip_bytes)
        while True:
            chunk = buf.read(64 * 1024)
            if not chunk:
                break
            yield chunk

    return StreamingResponse(
        _stream_zip(),
        media_type="application/zip",
        headers={
            "Content-Disposition": content_disp,
            "Transfer-Encoding": "chunked",
        },
    )


@app.get("/api/health")
async def get_health():
    """Live platform probe and engine latency monitor."""
    return await health_service.check_health()


@app.post("/api/system/update")
async def trigger_update():
    """1-Click self-healing trigger to update yt-dlp."""
    return await updater_service.update_ytdlp()


# Root SPA route
@app.get("/", response_class=FileResponse)
@app.head("/")
async def serve_root():
    """Serve the primary SPA index.html on root /."""
    src_index = settings.src_dir / "index.html"
    if src_index.is_file():
        return create_static_file_response(src_index)
    public_index = settings.public_dir / "index.html"
    if public_index.is_file():
        return create_static_file_response(public_index)
    return JSONResponse(
        status_code=200,
        content={"service": "DownMe Backend Service", "status": "running"},
    )


# Static file fallback / SPA client serving
@app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
async def serve_static_or_spa(full_path: str):
    """Serve PWA client, Thmanyah font assets, icons, or SPA index.html."""
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")

    clean_path = full_path.strip("/")
    if not clean_path or clean_path == "index.html":
        src_index = settings.src_dir / "index.html"
        if src_index.is_file():
            return create_static_file_response(src_index)

    # 1. Check in public/
    try:
        public_dir = settings.public_dir.resolve()
        public_file = (public_dir / clean_path).resolve()
        if public_file.is_file() and public_file.is_relative_to(public_dir):
            return create_static_file_response(public_file)
    except Exception:
        pass

    # 2. Check in src/
    try:
        src_dir = settings.src_dir.resolve()
        src_file = (src_dir / clean_path).resolve()
        if src_file.is_file() and src_file.is_relative_to(src_dir):
            return create_static_file_response(src_file)
    except Exception:
        pass


    # 3. SPA fallback to src/index.html or public/index.html
    src_index = settings.src_dir / "index.html"
    if src_index.is_file():
        return create_static_file_response(src_index)

    public_index = settings.public_dir / "index.html"
    if public_index.is_file():
        return create_static_file_response(public_index)

    return JSONResponse(
        status_code=200,
        content={"service": "DownMe Backend Service", "status": "running"},
    )
