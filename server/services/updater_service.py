"""Self-Healing 1-Click yt-dlp Package Updater Service.

Enables automated background updates to prevent upstream extractor breakage.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
import subprocess
import sys
from typing import Optional
from pydantic import BaseModel

logger = logging.getLogger("downme.updater")


class UpdateResponse(BaseModel):
    success: bool
    previousVersion: str
    currentVersion: str
    message: str


class UpdaterService:
    @staticmethod
    def get_current_version() -> str:
        try:
            import yt_dlp.version
            importlib.reload(yt_dlp.version)
            return yt_dlp.version.__version__
        except Exception:
            return "unknown"

    async def update_ytdlp(self) -> UpdateResponse:
        prev_ver = self.get_current_version()
        logger.info("Starting yt-dlp update check. Current version: %s", prev_ver)

        # Run uv pip install -U yt-dlp or python -m pip install -U yt-dlp
        cmd = ["uv", "pip", "install", "-U", "yt-dlp"]

        def _run_cmd():
            try:
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    check=False,
                )
                return proc.returncode, proc.stdout + proc.stderr
            except FileNotFoundError:
                # Fallback to python -m pip install -U yt-dlp
                proc = subprocess.run(
                    [sys.executable, "-m", "pip", "install", "-U", "yt-dlp"],
                    capture_output=True,
                    text=True,
                    timeout=60,
                    check=False,
                )
                return proc.returncode, proc.stdout + proc.stderr
            except Exception as e:
                return -1, str(e)

        code, output = await asyncio.to_thread(_run_cmd)

        curr_ver = self.get_current_version()

        if code == 0:
            if prev_ver != curr_ver:
                msg = f"yt-dlp updated successfully from {prev_ver} to {curr_ver}"
            else:
                msg = "yt-dlp is up to date"
            return UpdateResponse(
                success=True,
                previousVersion=prev_ver,
                currentVersion=curr_ver,
                message=msg,
            )
        else:
            return UpdateResponse(
                success=False,
                previousVersion=prev_ver,
                currentVersion=curr_ver,
                message=f"Update failed with code {code}: {output.strip()[:200]}",
            )


updater_service = UpdaterService()
