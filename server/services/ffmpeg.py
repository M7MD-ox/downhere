"""FFmpeg 8.1.2 Real-time Streaming, Transcoding and Trimming Engine.

Pipelines implemented:
- 1080p DASH Video + Audio Stream Merger (-movflags frag_keyframe+empty_moov)
- High-fidelity Audio Transcoder (up to 320kbps MP3 or M4A/AAC) with embedded cover art & ID3v2 tags
- Server-side Video & Audio Trimmer (fast copy mode & accurate re-encode mode)
"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator, Optional

from server.config import system_paths

logger = logging.getLogger("downme.ffmpeg")

CHUNK_SIZE = 64 * 1024  # 64 KB streaming chunks


class FFmpegService:
    def __init__(self, ffmpeg_bin: Optional[str] = None):
        self.ffmpeg_bin = ffmpeg_bin or system_paths.ffmpeg_path

    async def _execute_ffmpeg_stream(
        self,
        args: list[str],
    ) -> AsyncGenerator[bytes, None]:
        """Spawn FFmpeg subprocess and yield binary chunks from stdout directly to client."""
        cmd = [self.ffmpeg_bin, "-hide_banner", "-loglevel", "error"] + args
        logger.debug("Spawning FFmpeg stream: %s", " ".join(cmd))

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Drain stderr concurrently in an asynchronous background task to prevent pipe buffer deadlock
        stderr_task = asyncio.create_task(proc.stderr.read()) if proc.stderr else None

        try:
            assert proc.stdout is not None
            while True:
                chunk = await proc.stdout.read(CHUNK_SIZE)
                if not chunk:
                    break
                yield chunk

            await proc.wait()
            stderr_output = b""
            if stderr_task:
                try:
                    stderr_output = await stderr_task
                except Exception:
                    pass

            if proc.returncode != 0:
                logger.error(
                    "FFmpeg exited with code %s: %s",
                    proc.returncode,
                    stderr_output.decode(errors="ignore"),
                )
        except (GeneratorExit, asyncio.CancelledError):
            logger.info("Client disconnected, terminating FFmpeg stream")
        finally:
            if stderr_task and not stderr_task.done():
                stderr_task.cancel()
            if proc.returncode is None:
                try:
                    proc.kill()
                    await proc.wait()
                except Exception:
                    pass


    def _build_base_args(self) -> list[str]:
        return [
            "-user_agent", (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/128.0.0.0 Safari/537.36"
            ),
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
        ]

    async def stream_dash_merge(
        self,
        video_url: str,
        audio_url: str,
        trim_start: Optional[str] = None,
        trim_end: Optional[str] = None,
        accurate_reencode: bool = False,
    ) -> AsyncGenerator[bytes, None]:
        """Merge separate DASH video and audio streams into a fragmented MP4 stream."""
        args: list[str] = self._build_base_args()

        if trim_start:
            args.extend(["-ss", trim_start])
        if trim_end:
            args.extend(["-to", trim_end])
        args.extend(["-i", video_url])

        if trim_start:
            args.extend(["-ss", trim_start])
        if trim_end:
            args.extend(["-to", trim_end])
        args.extend(["-i", audio_url])

        if accurate_reencode:
            args.extend([
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "22",
                "-c:a", "aac",
                "-b:a", "192k",
                "-avoid_negative_ts", "make_zero",
            ])
        else:
            args.extend([
                "-c:v", "copy",
                "-c:a", "aac",
            ])

        args.extend([
            "-movflags", "frag_keyframe+empty_moov",
            "-f", "mp4",
            "pipe:1",
        ])

        async for chunk in self._execute_ffmpeg_stream(args):
            yield chunk

    async def stream_video_cut(
        self,
        video_url: str,
        trim_start: Optional[str] = None,
        trim_end: Optional[str] = None,
        accurate_reencode: bool = False,
    ) -> AsyncGenerator[bytes, None]:
        """Stream or trim a single progressive MP4 video."""
        args: list[str] = self._build_base_args()

        if trim_start:
            args.extend(["-ss", trim_start])
        if trim_end:
            args.extend(["-to", trim_end])
        args.extend(["-i", video_url])

        if accurate_reencode:
            args.extend([
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "22",
                "-c:a", "aac",
                "-b:a", "192k",
                "-avoid_negative_ts", "make_zero",
            ])
        else:
            args.extend([
                "-c", "copy",
            ])

        args.extend([
            "-movflags", "frag_keyframe+empty_moov",
            "-f", "mp4",
            "pipe:1",
        ])

        async for chunk in self._execute_ffmpeg_stream(args):
            yield chunk

    async def stream_audio_transcode(
        self,
        audio_url: str,
        ext: str = "mp3",
        bitrate: int = 320,
        title: Optional[str] = None,
        author: Optional[str] = None,
        thumbnail_url: Optional[str] = None,
        embed_cover: bool = True,
        trim_start: Optional[str] = None,
        trim_end: Optional[str] = None,
    ) -> AsyncGenerator[bytes, None]:
        """Transcode audio stream to high quality MP3 (libmp3lame) or Apple M4A/AAC with cover art."""
        args: list[str] = self._build_base_args()

        if trim_start:
            args.extend(["-ss", trim_start])
        if trim_end:
            args.extend(["-to", trim_end])
        args.extend(["-i", audio_url])

        has_cover = bool(embed_cover and thumbnail_url)
        if has_cover:
            args.extend(["-i", thumbnail_url])

        if ext == "mp3":
            if has_cover:
                args.extend([
                    "-map", "0:a",
                    "-map", "1:v",
                    "-c:a", "libmp3lame",
                    "-b:a", f"{bitrate}k",
                    "-id3v2_version", "3",
                    "-metadata:s:v", "title=Album cover",
                    "-metadata:s:v", "comment=Cover (front)",
                ])
            else:
                args.extend([
                    "-c:a", "libmp3lame",
                    "-b:a", f"{bitrate}k",
                    "-id3v2_version", "3",
                ])

            if title:
                args.extend(["-metadata", f"title={title}"])
            if author:
                args.extend(["-metadata", f"artist={author}"])

            args.extend(["-f", "mp3", "pipe:1"])

        else:
            # M4A / AAC (Apple Native)
            if has_cover:
                args.extend([
                    "-map", "0:a",
                    "-map", "1:v",
                    "-c:a", "aac",
                    "-b:a", f"{bitrate}k",
                    "-disposition:v:0", "attached_pic",
                ])
            else:
                args.extend([
                    "-c:a", "aac",
                    "-b:a", f"{bitrate}k",
                ])

            if title:
                args.extend(["-metadata", f"title={title}"])
            if author:
                args.extend(["-metadata", f"artist={author}"])

            args.extend([
                "-movflags", "frag_keyframe+empty_moov",
                "-f", "mp4",
                "pipe:1",
            ])

        async for chunk in self._execute_ffmpeg_stream(args):
            yield chunk


ffmpeg_service = FFmpegService()
