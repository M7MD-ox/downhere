#!/usr/bin/env python3
"""DownMe Unified Application Runner.

Launch DownMe personal media downloader and PWA with a single command:
    uv run python run_app.py
    or
    npm start
"""

import sys
import uvicorn

from server.config import settings, system_paths


def print_banner():
    banner = f"""
======================================================================
  DownMe - Personal Media Downloader & PWA
  Unified Full-Stack Server
======================================================================
  Server Address:    http://{settings.host if settings.host != '0.0.0.0' else 'localhost'}:{settings.port}
  Local Network:     http://{settings.host}:{settings.port}
  API Docs (Swagger):http://localhost:{settings.port}/docs
  FastAPI Backend:   server/main.py
  Static PWA Client: src/ (Index, CSS, JS) & public/ (Fonts, Icons)
----------------------------------------------------------------------
  Runtime Environment:
    Python:          {sys.version.split()[0]}
    Node.js:         {system_paths.node_version}
    FFmpeg:          {system_paths.ffmpeg_version}
    yt-dlp:          {system_paths.yt_dlp_version}
======================================================================
"""
    print(banner, flush=True)


def main():
    print_banner()
    uvicorn.run(
        "server.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level="info",
    )


if __name__ == "__main__":
    main()
