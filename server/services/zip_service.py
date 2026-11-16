"""In-Memory Streaming ZIP Archive Service.

Downloads multi-photo albums (from TikTok, Pinterest, etc.) in-memory
and streams a fully standard, uncorrupted ZIP archive directly to the client.
"""

from __future__ import annotations

import asyncio
import io
import ipaddress
import logging
from pathlib import Path
import socket
from typing import Any, AsyncGenerator, List, Optional
import urllib.parse
import zipfile
import httpx
from pydantic import BaseModel


from server.utils.sanitizer import sanitize_filename

logger = logging.getLogger("downme.zip")

CHUNK_SIZE = 64 * 1024


def validate_url_ssrf(url: str) -> None:
    """Pre-flight validate URL to prevent Server-Side Request Forgery (SSRF).

    Enforces http/https scheme, resolves hostname to IP addresses via socket.getaddrinfo,
    and blocks private, loopback, link-local (cloud metadata), and reserved IP ranges.
    """
    if not url or "\x00" in url:
        raise ValueError("Invalid URL: empty or contains null bytes")

    parsed = urllib.parse.urlsplit(url.strip())
    if parsed.scheme.lower() not in ("http", "https"):
        raise ValueError(f"Invalid URL scheme '{parsed.scheme}': only http and https are allowed")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Invalid URL: missing hostname")

    # Reject obvious local hostnames
    if hostname.lower() in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
        raise ValueError(f"SSRF blocked: loopback address '{hostname}' is not allowed")

    try:
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        logger.warning("DNS resolution failed for hostname '%s': %s", hostname, e)
        raise ValueError(f"Cannot resolve hostname '{hostname}'") from e

    for addr in addr_infos:
        ip_str = addr[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue

        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_unspecified
            or ip.is_multicast
        ):
            logger.warning("SSRF blocked: '%s' resolved to forbidden IP '%s'", url, ip_str)
            raise ValueError(f"SSRF blocked: IP {ip_str} is a private, loopback, or metadata address")


def sanitize_zip_entry_filename(raw_filename: Optional[str], index: int) -> str:
    """Sanitize client-supplied ZIP entry filenames to prevent Zip Slip path traversal."""
    default_name = f"photo_{index:02d}.jpg"
    if not raw_filename or not raw_filename.strip():
        return default_name

    # Normalize backslashes to forward slashes and take filename component only
    norm = raw_filename.replace("\\", "/")
    pure_name = Path(norm).name

    # Remove any traversal segments and illegal directory delimiters
    pure_name = pure_name.replace("..", "").replace("/", "").replace("\\", "").strip(". ")
    clean = sanitize_filename(pure_name, default_name=default_name)
    clean = clean.replace("..", "").replace("/", "").replace("\\", "").strip(". ")
    return clean or default_name


class ZipAlbumItem(BaseModel):
    index: int
    url: str
    filename: Optional[str] = None


class ZipAlbumRequest(BaseModel):
    albumTitle: str = "album"
    items: List[ZipAlbumItem]


class ZipService:
    def __init__(self, max_concurrent: int = 5):
        self.semaphore = asyncio.Semaphore(max_concurrent)

    async def _fetch_item_bytes(
        self,
        client: httpx.AsyncClient,
        item: ZipAlbumItem,
    ) -> tuple[str, bytes]:
        """Download single album item into memory with filename sanitization and SSRF validation."""
        filename = sanitize_zip_entry_filename(item.filename, item.index)
        try:
            validate_url_ssrf(item.url)
        except ValueError as e:
            logger.warning("Skipping SSRF/invalid item %s: %s", item.url, e)
            return filename, b""

        async with self.semaphore:
            try:
                resp = await client.get(item.url, timeout=20.0)
                resp.raise_for_status()
                return filename, resp.content
            except Exception as e:
                logger.warning("Failed to fetch image %s: %s", item.url, e)
                return filename, b""

    async def build_album_zip_bytes(
        self,
        items: List[ZipAlbumItem],
    ) -> bytes:
        """Download all album items and build a compressed ZIP archive in memory.

        Raises FileNotFoundError if no valid items could be downloaded.
        """
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/128.0.0.0 Safari/537.36"
            ),
        }

        async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
            tasks = [self._fetch_item_bytes(client, item) for item in items]
            downloaded = await asyncio.gather(*tasks)

        successful_items = [(fn, content) for fn, content in downloaded if content]
        if not successful_items:
            raise FileNotFoundError("No media files could be retrieved")

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for filename, content in successful_items:
                zf.writestr(filename, content)

        return zip_buffer.getvalue()

    async def create_album_zip_stream(
        self,
        items: List[ZipAlbumItem],
    ) -> AsyncGenerator[bytes, None]:
        """Download all album items and stream the resulting ZIP archive in chunks."""
        zip_bytes = await self.build_album_zip_bytes(items)
        zip_buffer = io.BytesIO(zip_bytes)
        while True:
            chunk = zip_buffer.read(CHUNK_SIZE)
            if not chunk:
                break
            yield chunk


zip_service = ZipService()

