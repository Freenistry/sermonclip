import logging
import re
import tempfile
import os

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import select

from database import get_session, get_data_dir
from models import Project

from services.ffmpeg_service import FFmpegService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/video", tags=["video"])


class ExtractAudioRequest(BaseModel):
    video_url: str
    project_id: str


class ExtractAudioResponse(BaseModel):
    audio_path: str
    duration_seconds: float


@router.get("/ffmpeg-status")
async def ffmpeg_status():
    """Check if FFmpeg is available."""
    available = FFmpegService.is_ffmpeg_available()
    return {"ffmpeg_available": available}


@router.post("/extract-audio", response_model=ExtractAudioResponse)
async def extract_audio(request: ExtractAudioRequest):
    """
    Download video and extract audio.

    Downloads video from URL, extracts audio as WAV for transcription.
    """
    if not FFmpegService.is_ffmpeg_available():
        raise HTTPException(status_code=500, detail="FFmpeg is not installed")

    # Create temp directory for this project
    temp_dir = tempfile.mkdtemp(prefix=f"sermonclip_{request.project_id}_")
    video_path = os.path.join(temp_dir, "video.mp4")
    audio_path = os.path.join(temp_dir, "audio.wav")

    try:
        # Download video
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.get(request.video_url, follow_redirects=True)
            if response.status_code != 200:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to download video: {response.status_code}"
                )

            with open(video_path, "wb") as f:
                f.write(response.content)

        # Get video duration
        duration = FFmpegService.get_video_duration(video_path)

        # Extract audio
        FFmpegService.extract_audio(video_path, audio_path)

        # Clean up video file (keep audio for transcription)
        os.remove(video_path)

        return ExtractAudioResponse(
            audio_path=audio_path,
            duration_seconds=duration,
        )

    except Exception as e:
        # Clean up on error
        if os.path.exists(temp_dir):
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/signed-url/{project_id}")
async def get_signed_url(project_id: str):
    """Return the local video URL for a project's uploaded video."""
    with get_session() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.source_type == "youtube":
            raise HTTPException(
                status_code=400, detail="YouTube projects don't use signed URLs"
            )

        video_url = project.video_url or ""
        if not video_url:
            raise HTTPException(status_code=404, detail="No video URL found")

        # Return the local file path or URL directly
        return {"signed_url": video_url}
