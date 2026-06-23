import os
import base64
import re
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

from services.clip_service import ClipService
from services.ffmpeg_service import FFmpegService

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/clip", tags=["clip"])


def get_supabase() -> Client:
    """Get Supabase client."""
    url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54421")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return create_client(url, key)


class ClipResponse(BaseModel):
    video: str  # base64 data URL
    quote_id: str
    filename: str
    duration: float


def slugify(text: str, max_length: int = 30) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = text.strip("-")
    return text[:max_length]


@router.post("/quote/{quote_id}", response_model=ClipResponse)
async def generate_quote_clip(quote_id: str):
    """Generate a video clip for a quote."""
    # Check if FFmpeg is available
    if not FFmpegService.is_ffmpeg_available():
        raise HTTPException(status_code=500, detail="FFmpeg is not installed")

    supabase = get_supabase()

    # Fetch quote
    quote_result = supabase.table("quotes").select("*").eq("id", quote_id).single().execute()
    if not quote_result.data:
        raise HTTPException(status_code=404, detail="Quote not found")

    quote = quote_result.data

    # Fetch project for video URL
    project_result = supabase.table("projects").select("video_url").eq("id", quote["project_id"]).single().execute()
    if not project_result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_result.data
    video_url = project.get("video_url", "")

    if not video_url:
        raise HTTPException(status_code=500, detail="Video unavailable")

    start_time = float(quote.get("start_time", 0))
    end_time = float(quote.get("end_time", 0))
    duration = end_time - start_time

    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid quote time range")

    # Generate clip
    try:
        clip_service = ClipService()
        mp4_bytes = clip_service.generate_quote_clip(
            video_url=video_url,
            start_time=start_time,
            end_time=end_time,
            quote_text=quote["text"],
        )
    except ValueError as e:
        logger.error(f"Clip generation validation error for quote {quote_id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Clip generation failed for quote {quote_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Clip generation failed")

    # Encode as base64 data URL
    base64_video = base64.b64encode(mp4_bytes).decode("utf-8")
    data_url = f"data:video/mp4;base64,{base64_video}"

    # Generate filename
    slug = slugify(quote["text"][:50])
    filename = f"clip-{slug}.mp4"

    return ClipResponse(
        video=data_url,
        quote_id=quote_id,
        filename=filename,
        duration=duration,
    )
