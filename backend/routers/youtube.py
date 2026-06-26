from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.youtube_service import YouTubeService

router = APIRouter(prefix="/youtube", tags=["youtube"])


class ValidateRequest(BaseModel):
    url: str


class ValidateResponse(BaseModel):
    title: str
    thumbnail_url: str
    duration_seconds: int


@router.post("/validate", response_model=ValidateResponse)
async def validate_youtube_url(request: ValidateRequest):
    """Validate a YouTube URL and return video metadata."""
    try:
        metadata = await YouTubeService.validate_and_get_metadata(request.url)
        return ValidateResponse(
            title=metadata.title,
            thumbnail_url=metadata.thumbnail_url,
            duration_seconds=metadata.duration_seconds,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
