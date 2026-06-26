import logging
import re
import tempfile
import os

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

from services.ffmpeg_service import FFmpegService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/video", tags=["video"])


def get_supabase() -> Client:
    """Get Supabase client."""
    url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54421")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return create_client(url, key)


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
    """Generate a fresh signed URL for a project's uploaded video."""
    supabase = get_supabase()

    result = (
        supabase.table("projects")
        .select("video_url, source_type")
        .eq("id", project_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    if result.data.get("source_type") == "youtube":
        raise HTTPException(
            status_code=400, detail="YouTube projects don't use signed URLs"
        )

    video_url = result.data.get("video_url", "")
    if not video_url:
        raise HTTPException(status_code=404, detail="No video URL found")

    # Extract storage path from signed URL or direct path
    # Signed URLs contain the path after /object/sign/videos/ or /object/public/videos/
    match = re.search(r"/(?:object/(?:sign|public|authenticated)/)?videos/(.+?)(?:\?|$)", video_url)
    if match:
        storage_path = match.group(1)
    else:
        # Assume video_url is already a storage path
        storage_path = video_url.removeprefix("videos/")

    try:
        signed = supabase.storage.from_("videos").create_signed_url(
            storage_path, 60 * 60 * 24 * 7  # 7 days
        )
        return {"signed_url": signed["signedURL"]}
    except Exception as e:
        logger.error(f"Failed to create signed URL for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate signed URL")
