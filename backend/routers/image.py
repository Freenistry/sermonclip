import os
import base64
import re
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import select

from database import get_session, get_data_dir
from models import Project, Quote, SermonHighlight, Settings

from services.image_service import ImageService
from services.video_resolver import resolve_video

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/image", tags=["image"])


class ImageResponse(BaseModel):
    image: str  # base64 data URL
    quote_id: str
    filename: str


def slugify(text: str, max_length: int = 30) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = text.strip("-")
    return text[:max_length]


@router.post("/quote/{quote_id}", response_model=ImageResponse)
async def generate_quote_image(quote_id: str):
    """Generate a shareable image for a quote."""
    with get_session() as session:
        quote = session.get(Quote, quote_id)
        if not quote:
            raise HTTPException(status_code=404, detail="Quote not found")

        project = session.get(Project, quote.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Get church name from Settings
        settings = session.get(Settings, 1)
        church_name = settings.church_name if settings and settings.church_name else "SermonClip"

        # Extract data before closing session
        quote_text = quote.text
        quote_start_time = float(quote.start_time or 0)
        project_dict = project.model_dump()

    # Generate image
    try:
        image_service = ImageService()
        async with resolve_video(project_dict) as video_path:
            png_bytes = image_service.generate_quote_image(
                quote_text=quote_text,
                video_url=video_path,
                timestamp=quote_start_time,
                church_name=church_name,
            )
    except Exception as e:
        logger.error(f"Image generation failed for quote {quote_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Image generation failed")

    # Encode as base64 data URL
    base64_image = base64.b64encode(png_bytes).decode("utf-8")
    data_url = f"data:image/png;base64,{base64_image}"

    # Generate filename
    slug = slugify(quote_text[:50])
    filename = f"quote-{slug}.png"

    return ImageResponse(
        image=data_url,
        quote_id=quote_id,
        filename=filename,
    )


@router.post("/highlight/{highlight_id}", response_model=ImageResponse)
async def generate_highlight_image(highlight_id: str):
    """Generate a shareable image for a sermon highlight."""
    with get_session() as session:
        highlight = session.get(SermonHighlight, highlight_id)
        if not highlight:
            raise HTTPException(status_code=404, detail="Highlight not found")

        project = session.get(Project, highlight.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Get church name from Settings
        settings = session.get(Settings, 1)
        church_name = settings.church_name if settings and settings.church_name else "SermonClip"

        # Extract data before closing session
        h_quote_text = highlight.quote_text
        h_start_time = float(highlight.start_time or 0)
        h_title = highlight.title
        project_dict = project.model_dump()

    # Generate image using the highlight's punchline quote
    try:
        image_service = ImageService()
        async with resolve_video(project_dict) as video_path:
            png_bytes = image_service.generate_quote_image(
                quote_text=h_quote_text,
                video_url=video_path,
                timestamp=h_start_time,
                church_name=church_name,
            )
    except Exception as e:
        logger.error(f"Image generation failed for highlight {highlight_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Image generation failed")

    base64_image = base64.b64encode(png_bytes).decode("utf-8")
    data_url = f"data:image/png;base64,{base64_image}"

    slug = slugify(h_title[:50])
    filename = f"highlight-{slug}.png"

    return ImageResponse(
        image=data_url,
        quote_id=highlight_id,
        filename=filename,
    )
