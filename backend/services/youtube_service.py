import asyncio
import logging
import os
import re
from dataclasses import dataclass
from typing import Callable, Optional

import yt_dlp

from services.ffmpeg_path import get_ffmpeg_path

logger = logging.getLogger(__name__)

MAX_URL_LENGTH = 200


@dataclass
class YouTubeMetadata:
    title: str
    thumbnail_url: str
    duration_seconds: int


class YouTubeService:
    YOUTUBE_URL_PATTERN = re.compile(
        r"^(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w-]+"
    )

    # Use android_vr client to avoid YouTube bot detection / consent walls
    _YDL_BASE_OPTS = {
        "quiet": True,
        "no_warnings": True,
        "extractor_args": {"youtube": {"player_client": ["android_vr"]}},
        "cookiefile": None,
        "cookiesfrombrowser": None,
        "nocheckcertificate": True,
    }

    @staticmethod
    def is_valid_url(url: str) -> bool:
        return bool(YouTubeService.YOUTUBE_URL_PATTERN.match(url))

    @classmethod
    async def validate_and_get_metadata(cls, url: str) -> YouTubeMetadata:
        """Fetch video metadata without downloading using yt-dlp."""
        if len(url) > MAX_URL_LENGTH:
            raise ValueError("URL is too long")
        if not cls.is_valid_url(url):
            raise ValueError("Invalid YouTube URL format")

        def _fetch():
            opts = {**cls._YDL_BASE_OPTS, "skip_download": True}
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    return YouTubeMetadata(
                        title=info.get("title") or "Untitled",
                        thumbnail_url=info.get("thumbnail") or "",
                        duration_seconds=int(info.get("duration") or 0),
                    )
            except Exception as e:
                cls._handle_error(e)

        return await asyncio.to_thread(_fetch)

    @classmethod
    async def download_video(
        cls,
        url: str,
        output_path: str,
        is_cancelled: Optional[Callable[[], bool]] = None,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> None:
        """Download best quality video to output_path using yt-dlp.

        Downloads best video+audio and merges into mp4 via FFmpeg.
        Args:
            on_progress: callback(percent, status) called during download.
        """
        def _download():
            if is_cancelled and is_cancelled():
                raise InterruptedError("Download cancelled")

            ffmpeg_path = get_ffmpeg_path()

            opts = {
                **cls._YDL_BASE_OPTS,
                "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
                "merge_output_format": "mp4",
                "outtmpl": output_path,
                "ffmpeg_location": os.path.dirname(ffmpeg_path) or None,
            }

            def _progress_hook(d):
                if is_cancelled and is_cancelled():
                    raise InterruptedError("Download cancelled")
                if on_progress and d.get("status") == "downloading":
                    total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                    downloaded = d.get("downloaded_bytes", 0)
                    if total > 0:
                        percent = min(int((downloaded / total) * 100), 99)
                        on_progress(percent, "downloading")
                elif on_progress and d.get("status") == "finished":
                    on_progress(100, "merging")

            opts["progress_hooks"] = [_progress_hook]

            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    ydl.download([url])
                logger.info(f"Downloaded video to {output_path}")
            except InterruptedError:
                raise
            except Exception as e:
                cls._handle_error(e)

        await asyncio.to_thread(_download)

    @staticmethod
    def _handle_error(e: Exception) -> None:
        """Convert yt-dlp exceptions to descriptive ValueErrors."""
        msg = str(e).lower()
        if "private" in msg:
            raise ValueError("This video is private") from e
        if "unavailable" in msg or "not available" in msg:
            raise ValueError("This video is unavailable") from e
        if "age-restricted" in msg or "age_restricted" in msg:
            raise ValueError("This video is age-restricted") from e
        if "sign in" in msg or "bot" in msg:
            raise ValueError(
                "YouTube is blocking downloads. Try updating yt-dlp: "
                "pip3 install --upgrade yt-dlp"
            ) from e
        raise ValueError(f"Could not fetch video: {e}") from e
