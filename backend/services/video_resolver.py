import os
import tempfile
import shutil
from contextlib import contextmanager

import httpx

from services.youtube_service import YouTubeService


@contextmanager
def resolve_video(project: dict):
    """Context manager that yields a local video file path for a project.

    For upload projects: downloads from signed URL to a temp file.
    For YouTube projects: downloads from YouTube via pytubefix.

    Usage:
        with resolve_video(project) as video_path:
            # video_path is a local file path to the video
            ffmpeg_command(video_path)
        # temp files cleaned up automatically
    """
    source_type = project.get("source_type", "upload")
    temp_dir = tempfile.mkdtemp(prefix="sermonclip_resolve_")

    try:
        video_path = os.path.join(temp_dir, "video.mp4")

        if source_type == "youtube":
            youtube_url = project.get("youtube_url")
            if not youtube_url:
                raise ValueError("No YouTube URL for project")

            import asyncio
            # Run async download in sync context
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop and loop.is_running():
                # Already in an async context — run in thread
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(
                        asyncio.run,
                        YouTubeService.download_video(youtube_url, video_path),
                    )
                    future.result()
            else:
                asyncio.run(YouTubeService.download_video(youtube_url, video_path))
        else:
            video_url = project.get("video_url")
            if not video_url:
                raise ValueError("No video URL for project")
            # For upload projects, FFmpeg can read the URL directly
            # Just yield the URL instead of downloading
            yield video_url
            return

        yield video_path
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
