from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os

from services.whisper_mlx_service import WhisperMLXService, MLX_AVAILABLE

router = APIRouter(prefix="/transcribe", tags=["transcribe"])


class TranscribeRequest(BaseModel):
    audio_path: str
    project_id: str


class SegmentResponse(BaseModel):
    start: float
    end: float
    text: str


class TranscribeResponse(BaseModel):
    full_text: str
    segments: list[SegmentResponse]


@router.get("/whisper-status")
async def whisper_status():
    """Check if Whisper MLX is available."""
    return {
        "whisper_available": MLX_AVAILABLE,
        "model": os.getenv("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo") if MLX_AVAILABLE else None,
    }


@router.post("/audio", response_model=TranscribeResponse)
async def transcribe_audio(request: TranscribeRequest):
    """
    Transcribe audio file to text with timestamps.

    Returns full transcript text and timestamped segments.
    """
    if not MLX_AVAILABLE:
        raise HTTPException(
            status_code=500,
            detail="Whisper MLX is not available. Requires Apple Silicon Mac."
        )

    if not os.path.exists(request.audio_path):
        raise HTTPException(
            status_code=400,
            detail=f"Audio file not found: {request.audio_path}"
        )

    try:
        service = WhisperMLXService()
        transcript = service.transcribe(request.audio_path)

        return TranscribeResponse(
            full_text=transcript.full_text,
            segments=[
                SegmentResponse(
                    start=s.start,
                    end=s.end,
                    text=s.text,
                )
                for s in transcript.segments
            ],
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
