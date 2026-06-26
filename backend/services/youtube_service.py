import asyncio
import json
import re
import subprocess
from dataclasses import dataclass


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
                ["yt-dlp", "--dump-json", "--no-download", url],
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

        info = json.loads(result.stdout)
        return YouTubeMetadata(
            title=info.get("title", "Untitled"),
            thumbnail_url=info.get("thumbnail", ""),
            duration_seconds=int(info.get("duration", 0)),
        )

    @staticmethod
    async def download_video(url: str, output_path: str) -> None:
        result = await asyncio.to_thread(
            subprocess.run,
            [
                "yt-dlp",
                "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "--merge-output-format", "mp4",
                "-o", output_path,
                url,
            ],
            capture_output=True,
            text=True,
            timeout=1800,
        )
        if result.returncode != 0:
            raise ValueError(f"Failed to download video: {result.stderr.strip()}")
