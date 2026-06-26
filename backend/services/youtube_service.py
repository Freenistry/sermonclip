import asyncio
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Callable, Optional


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

    @staticmethod
    async def validate_and_get_metadata(url: str) -> YouTubeMetadata:
        """Fetch video metadata without downloading."""
        if not YouTubeService.is_valid_url(url):
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
                msg = str(e).lower()
                if "private" in msg:
                    raise ValueError("This video is private")
                if "unavailable" in msg or "not available" in msg:
                    raise ValueError("This video is unavailable")
                if "age" in msg:
                    raise ValueError("This video is age-restricted")
                raise ValueError(f"Could not fetch video info: {e}")

        return await asyncio.to_thread(_fetch)

    @staticmethod
    async def download_video(
        url: str,
        output_path: str,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> None:
        """Download best quality video to output_path.

        Downloads the highest resolution adaptive video + best audio stream
        and merges them with FFmpeg for maximum quality.
        """
        def _download():
            from pytubefix import YouTube

            yt = YouTube(url)
            output_dir = os.path.dirname(output_path)

            # Get best adaptive video (highest resolution mp4)
            video_stream = (
                yt.streams
                .filter(adaptive=True, file_extension="mp4")
                .order_by("resolution")
                .desc()
                .first()
            )
            # Get best audio stream
            audio_stream = (
                yt.streams
                .filter(adaptive=True, only_audio=True)
                .order_by("abr")
                .desc()
                .first()
            )

            if not video_stream or not audio_stream:
                # Fallback to progressive (combined but lower quality)
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

                progressive.download(output_path=output_dir, filename=os.path.basename(output_path))
                return

            if is_cancelled and is_cancelled():
                raise InterruptedError("Download cancelled")

            # Download video and audio separately
            video_tmp = os.path.join(output_dir, "_video_tmp.mp4")
            audio_tmp = os.path.join(output_dir, "_audio_tmp.mp4")

            try:
                video_stream.download(output_path=output_dir, filename="_video_tmp.mp4")

                if is_cancelled and is_cancelled():
                    raise InterruptedError("Download cancelled")

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
                    raise ValueError(f"Failed to merge video and audio: {result.stderr.strip()}")
            finally:
                # Clean up temp files
                for f in [video_tmp, audio_tmp]:
                    if os.path.exists(f):
                        os.remove(f)

        await asyncio.to_thread(_download)
