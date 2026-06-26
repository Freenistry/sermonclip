import os
import shutil
import tempfile
from contextlib import asynccontextmanager

from services.youtube_service import YouTubeService

# Cache directory for downloaded YouTube videos (persists across requests)
CACHE_DIR = os.path.join(tempfile.gettempdir(), "sermonclip_video_cache")
os.makedirs(CACHE_DIR, exist_ok=True)


def _cached_path(project_id: str) -> str:
    """Return the cache file path for a project."""
    return os.path.join(CACHE_DIR, f"{project_id}.mp4")


@asynccontextmanager
async def resolve_video(project: dict):
    """Async context manager that yields a video file path for a project.

    For upload projects: yields the signed URL directly (FFmpeg reads it).
    For YouTube projects: downloads to a cached temp file (reused across requests).

    Usage:
        async with resolve_video(project) as video_path:
            ffmpeg_command(video_path)
    """
    source_type = project.get("source_type", "upload")

    if source_type != "youtube":
        video_url = project.get("video_url")
        if not video_url:
            raise ValueError("No video URL for project")
        yield video_url
        return

    youtube_url = project.get("youtube_url")
    if not youtube_url:
        raise ValueError("No YouTube URL for project")

    project_id = project.get("id", "unknown")
    cached = _cached_path(project_id)

    # Use cached video if it exists and is non-empty
    if os.path.isfile(cached) and os.path.getsize(cached) > 0:
        yield cached
        return

    # Download to cache
    await YouTubeService.download_video(youtube_url, cached)
    yield cached
