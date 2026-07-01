"""Serve local video, clip, and media files."""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from database import get_data_dir

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/video/{project_id}/{filename}")
async def serve_video(project_id: str, filename: str):
    """Serve a video file for a project."""
    path = os.path.join(get_data_dir(), "videos", project_id, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Video file not found")
    return FileResponse(path, media_type="video/mp4")


@router.get("/clip/{filename}")
async def serve_clip(filename: str):
    """Serve a generated clip or thumbnail."""
    path = os.path.join(get_data_dir(), "clips", filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Clip file not found")
    media_type = "video/mp4" if filename.endswith(".mp4") else "image/jpeg"
    return FileResponse(path, media_type=media_type)


@router.get("/cache/{path:path}")
async def serve_cache(path: str):
    """Serve a cached file (thumbnails, waveforms, etc)."""
    full_path = os.path.join(get_data_dir(), "cache", path)
    if not os.path.isfile(full_path):
        # Also try the backend's local cache directory
        full_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cache", path)
    if not os.path.isfile(full_path):
        raise HTTPException(404, "Cache file not found")
    # Guess media type
    if path.endswith(".mp4"):
        media_type = "video/mp4"
    elif path.endswith(".jpg") or path.endswith(".jpeg"):
        media_type = "image/jpeg"
    elif path.endswith(".png"):
        media_type = "image/png"
    elif path.endswith(".wav"):
        media_type = "audio/wav"
    elif path.endswith(".mp3"):
        media_type = "audio/mpeg"
    else:
        media_type = "application/octet-stream"
    return FileResponse(full_path, media_type=media_type)
