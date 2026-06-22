from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.ollama_service import OllamaService, Quote
from services.whisper_mlx_service import TranscriptSegment

router = APIRouter(prefix="/analyze", tags=["analyze"])


class SegmentInput(BaseModel):
    start: float
    end: float
    text: str


class TranscriptInput(BaseModel):
    full_text: str
    segments: list[SegmentInput]


class QuoteResponse(BaseModel):
    text: str
    start_time: float
    end_time: float
    context: str


class ExtractQuotesRequest(BaseModel):
    transcript: TranscriptInput
    project_id: str


class ExtractQuotesResponse(BaseModel):
    quotes: list[QuoteResponse]


@router.get("/ollama-status")
async def ollama_status():
    """Check if Ollama is available."""
    service = OllamaService()
    available = service.is_available()
    return {
        "ollama_available": available,
        "model": service.model_name if available else None,
        "host": service.host,
    }


@router.post("/extract-quotes", response_model=ExtractQuotesResponse)
async def extract_quotes(request: ExtractQuotesRequest):
    """
    Extract inspirational quotes from a transcript.

    Uses Ollama local LLM to analyze the transcript and identify
    powerful quotes suitable for social media content.
    """
    service = OllamaService()

    if not service.is_available():
        raise HTTPException(
            status_code=503,
            detail="Ollama is not available. Ensure 'ollama serve' is running."
        )

    # Convert input to internal types
    from services.whisper_mlx_service import Transcript, TranscriptSegment

    segments = [
        TranscriptSegment(
            start=seg.start,
            end=seg.end,
            text=seg.text,
        )
        for seg in request.transcript.segments
    ]

    transcript = Transcript(
        full_text=request.transcript.full_text,
        segments=segments,
    )

    try:
        quotes = service.extract_quotes(transcript)

        return ExtractQuotesResponse(
            quotes=[
                QuoteResponse(
                    text=q.text,
                    start_time=q.start_time,
                    end_time=q.end_time,
                    context=q.context,
                )
                for q in quotes
            ]
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
