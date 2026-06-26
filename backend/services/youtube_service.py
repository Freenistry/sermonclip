import asyncio
import json
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
        if not YouTubeService.is_valid_url(url):
            raise ValueError("Invalid YouTube URL format")

        try:
            result = await asyncio.to_thread(
                subprocess.run,
                [sys.executable, "-m", "yt_dlp", "--dump-json", "--no-download", url],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            raise ValueError("Timed out fetching video info")

        if result.returncode != 0:
            stderr = result.stderr.lower()
            if "private" in stderr:
                raise ValueError("This video is private")
            if "unavailable" in stderr or "not available" in stderr:
                raise ValueError("This video is unavailable")
            if "age" in stderr:
                raise ValueError("This video is age-restricted")
            raise ValueError(f"Could not fetch video info: {result.stderr.strip()}")

        try:
            info = json.loads(result.stdout)
        except (json.JSONDecodeError, TypeError):
            raise ValueError("Could not parse video info from YouTube")
        return YouTubeMetadata(
            title=info.get("title", "Untitled"),
            thumbnail_url=info.get("thumbnail", ""),
            duration_seconds=int(info.get("duration", 0)),
        )

    @staticmethod
    async def download_video(
        url: str,
        output_path: str,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> None:
        """Download video with optional cancellation support.

        Args:
            url: YouTube video URL
            output_path: Path to save the video
            is_cancelled: Optional callback that returns True if download should stop
        """
        def _run_download():
            process = subprocess.Popen(
                [
                    sys.executable, "-m", "yt_dlp",
                    "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                    "--merge-output-format", "mp4",
                    "-o", output_path,
                    url,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            # Poll process every 2 seconds to check for cancellation
            while process.poll() is None:
                if is_cancelled and is_cancelled():
                    process.kill()
                    process.wait()
                    raise InterruptedError("Download cancelled")
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass
            if process.returncode != 0:
                stderr = process.stderr.read() if process.stderr else ""
                raise ValueError(f"Failed to download video: {stderr.strip()}")

        await asyncio.to_thread(_run_download)
