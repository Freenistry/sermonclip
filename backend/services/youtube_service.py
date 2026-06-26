import asyncio
import logging
import os
import re
import subprocess
from dataclasses import dataclass
from typing import Callable, Optional

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

    @staticmethod
    def is_valid_url(url: str) -> bool:
        return bool(YouTubeService.YOUTUBE_URL_PATTERN.match(url))

    @classmethod
    async def validate_and_get_metadata(cls, url: str) -> YouTubeMetadata:
        """Fetch video metadata without downloading using pytubefix."""
        if len(url) > MAX_URL_LENGTH:
            raise ValueError("URL is too long")
        if not cls.is_valid_url(url):
            raise ValueError("Invalid YouTube URL format")

        def _fetch():
            from pytubefix import YouTube
            try:
                yt = YouTube(url)
                return YouTubeMetadata(
                    title=yt.title or "Untitled",
                    thumbnail_url=yt.thumbnail_url or "",
                    duration_seconds=yt.length or 0,
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
    ) -> None:
        """Download best quality video to output_path.

        Uses pytubefix (separate video+audio streams merged with FFmpeg)
        for best quality. Falls back to progressive stream if needed.
        """
        def _download():
            from pytubefix import YouTube

            if is_cancelled and is_cancelled():
                raise InterruptedError("Download cancelled")

            try:
                yt = YouTube(url)
            except Exception as e:
                cls._handle_error(e)

            output_dir = os.path.dirname(output_path)

            # Try adaptive streams first (best quality)
            video_stream = (
                yt.streams
                .filter(adaptive=True, file_extension="mp4")
                .order_by("resolution")
                .desc()
                .first()
            )
            audio_stream = (
                yt.streams
                .filter(adaptive=True, only_audio=True)
                .order_by("abr")
                .desc()
                .first()
            )

            if video_stream and audio_stream:
                if is_cancelled and is_cancelled():
                    raise InterruptedError("Download cancelled")

                video_tmp = os.path.join(output_dir, "_video_tmp.mp4")
                audio_tmp = os.path.join(output_dir, "_audio_tmp.mp4")

                try:
                    logger.info(f"Downloading video stream: {video_stream.resolution}")
                    video_stream.download(output_path=output_dir, filename="_video_tmp.mp4")

                    if is_cancelled and is_cancelled():
                        raise InterruptedError("Download cancelled")

                    logger.info(f"Downloading audio stream: {audio_stream.abr}")
                    audio_stream.download(output_path=output_dir, filename="_audio_tmp.mp4")

                    if is_cancelled and is_cancelled():
                        raise InterruptedError("Download cancelled")

                    # Merge with FFmpeg
                    result = subprocess.run(
                        [
                            "ffmpeg", "-y",
                            "-i", video_tmp,
                            "-i", audio_tmp,
                            "-c:v", "copy",
                            "-c:a", "aac",
                            output_path,
                        ],
                        capture_output=True,
                        text=True,
                        timeout=300,
                    )
                    if result.returncode != 0:
                        raise ValueError(f"FFmpeg merge failed: {result.stderr.strip()[:200]}")

                    logger.info(f"Downloaded and merged video to {output_path}")
                    return
                finally:
                    for f in [video_tmp, audio_tmp]:
                        if os.path.exists(f):
                            os.remove(f)

            # Fallback to progressive (combined but lower quality)
            logger.info("No adaptive streams, trying progressive")
            progressive = (
                yt.streams
                .filter(progressive=True, file_extension="mp4")
                .order_by("resolution")
                .desc()
                .first()
            )
            if not progressive:
                raise ValueError("No downloadable streams found for this video")

            if is_cancelled and is_cancelled():
                raise InterruptedError("Download cancelled")

            progressive.download(
                output_path=output_dir,
                filename=os.path.basename(output_path),
            )
            logger.info(f"Downloaded progressive video to {output_path}")

        await asyncio.to_thread(_download)

    @staticmethod
    def _handle_error(e: Exception) -> None:
        """Convert pytubefix exceptions to descriptive ValueErrors."""
        msg = str(e).lower()
        if "private" in msg:
            raise ValueError("This video is private") from e
        if "unavailable" in msg or "not available" in msg:
            raise ValueError("This video is unavailable") from e
        if "age" in msg:
            raise ValueError("This video is age-restricted") from e
        if "bot" in msg:
            raise ValueError(
                "YouTube is blocking downloads. Try updating pytubefix: "
                "pip3 install --upgrade pytubefix"
            ) from e
        raise ValueError(f"Could not fetch video: {e}") from e
