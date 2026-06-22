import os
import base64
import re
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

from services.image_service import ImageService

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/image", tags=["image"])


def get_supabase() -> Client:
    """Get Supabase client."""
    url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54421")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return create_client(url, key)


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
    supabase = get_supabase()

    # Fetch quote
    quote_result = supabase.table("quotes").select("*").eq("id", quote_id).single().execute()
    if not quote_result.data:
        raise HTTPException(status_code=404, detail="Quote not found")

    quote = quote_result.data

    # Fetch project for video URL
    project_result = supabase.table("projects").select("video_url, church_id").eq("id", quote["project_id"]).single().execute()
    if not project_result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_result.data

    # Fetch church for name
    church_result = supabase.table("churches").select("name").eq("id", project["church_id"]).single().execute()
    church_name = church_result.data.get("name", "SermonClip") if church_result.data else "SermonClip"

    # Generate image
    try:
        image_service = ImageService()
        png_bytes = image_service.generate_quote_image(
            quote_text=quote["text"],
            video_url=project.get("video_url", ""),
            timestamp=float(quote.get("start_time", 0)),
            church_name=church_name,
        )
    except Exception as e:
        logger.error(f"Image generation failed for quote {quote_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Image generation failed")

    # Encode as base64 data URL
    base64_image = base64.b64encode(png_bytes).decode("utf-8")
    data_url = f"data:image/png;base64,{base64_image}"

    # Generate filename
    slug = slugify(quote["text"][:50])
    filename = f"quote-{slug}.png"

    return ImageResponse(
        image=data_url,
        quote_id=quote_id,
        filename=filename,
    )
