"""DownMe Configuration and System Environment Service.

Detects available external tools (ffmpeg, node, yt-dlp) and environment settings.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from pydantic import BaseModel


class SystemPaths(BaseModel):
    ffmpeg_path: str
    ffprobe_path: Optional[str] = None
    node_path: Optional[str] = None
    yt_dlp_version: str = "unknown"
    ffmpeg_version: str = "unknown"
    node_version: str = "unknown"


class Settings(BaseModel):
    host: str = os.getenv("DOWNME_HOST", "0.0.0.0")
    port: int = int(os.getenv("DOWNME_PORT", "3000"))
    debug: bool = os.getenv("DOWNME_DEBUG", "false").lower() in ("true", "1", "yes")
    cookies_file: Optional[str] = os.getenv("DOWNME_COOKIES_FILE", None)
    base_dir: Path = Path(__file__).resolve().parent.parent
    public_dir: Path = base_dir / "public"
    src_dir: Path = base_dir / "src"
    cache_ttl_seconds: int = int(os.getenv("DOWNME_CACHE_TTL", "180"))


def _detect_tool_version(cmd: list[str]) -> str:
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        output = (proc.stdout or proc.stderr).strip()
        first_line = output.splitlines()[0] if output else "unknown"
        return first_line.strip()
    except Exception:
        return "unknown"


def detect_system_paths() -> SystemPaths:
    """Find system executables and versions for ffmpeg, node, and yt-dlp."""
    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"
    ffprobe_bin = shutil.which("ffprobe")
    node_bin = shutil.which("node")

    # Detect versions
    ffmpeg_ver = _detect_tool_version([ffmpeg_bin, "-version"])
    node_ver = _detect_tool_version([node_bin, "-v"]) if node_bin else "not found"

    # yt-dlp version
    try:
        import yt_dlp.version

        yt_ver = yt_dlp.version.__version__
    except Exception:
        yt_ver = "unknown"

    return SystemPaths(
        ffmpeg_path=ffmpeg_bin,
        ffprobe_path=ffprobe_bin,
        node_path=node_bin,
        yt_dlp_version=yt_ver,
        ffmpeg_version=ffmpeg_ver,
        node_version=node_ver,
    )


settings = Settings()
system_paths = detect_system_paths()
