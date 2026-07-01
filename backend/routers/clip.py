import os
import uuid
import asyncio
import base64
import re
import logging
import subprocess
import tempfile
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from supabase import create_client, Client

from services.ffmpeg_path import get_ffmpeg_path
from services.clip_service import ClipService
from services.ffmpeg_service import FFmpegService
from services.video_resolver import resolve_video

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


class SavedClipResponse(BaseModel):
    id: str
    church_id: str
    project_id: str
    highlight_id: str
    title: str
    filename: str
    video_path: str
    thumbnail_path: Optional[str] = None
    duration_seconds: Optional[float] = None
    quote_text: Optional[str] = None
    created_at: str


def extract_thumbnail(mp4_bytes: bytes) -> Optional[bytes]:
    """Extract a JPEG thumbnail from MP4 bytes at 1 second in."""
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_in:
            tmp_in.write(mp4_bytes)
            tmp_in_path = tmp_in.name

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp_out:
            tmp_out_path = tmp_out.name

        subprocess.run(
            [
                get_ffmpeg_path(), "-y", "-i", tmp_in_path,
                "-ss", "1", "-vframes", "1",
                "-vf", "scale=480:-2",
                "-q:v", "4",
                tmp_out_path,
            ],
            capture_output=True,
            check=True,
        )

        with open(tmp_out_path, "rb") as f:
            return f.read()
    except Exception as e:
        logger.warning(f"Thumbnail extraction failed: {e}")
        return None
    finally:
        for p in [tmp_in_path, tmp_out_path]:
            try:
                os.unlink(p)
            except Exception:
                pass


def slugify(text: str, max_length: int = 30) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = text.strip("-")
    return text[:max_length]


@router.post("/quote/{quote_id}", response_model=ClipResponse)
async def generate_quote_clip(quote_id: str, smart: bool = True):
    """Generate a video clip for a quote.

    Args:
        quote_id: The quote ID to generate clip for
        smart: If True, use LLM to find optimal 30-60s boundaries (default: True)
    """
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
    project_result = supabase.table("projects").select("id, video_url, source_type, youtube_url").eq("id", quote["project_id"]).single().execute()
    if not project_result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_result.data

    # Fetch transcript segments if smart mode enabled (get latest transcript)
    segments = []
    if smart:
        transcript_result = supabase.table("transcripts").select("segments").eq("project_id", quote["project_id"]).order("created_at", desc=True).limit(1).execute()
        if transcript_result.data and len(transcript_result.data) > 0:
            segments = transcript_result.data[0].get("segments", [])

    start_time = float(quote.get("start_time", 0))
    end_time = float(quote.get("end_time", 0))

    # Use smart boundary detection if enabled
    clip_service = ClipService()
    if smart and segments:
        start_time, end_time = clip_service.get_smart_boundaries(
            quote_text=quote["text"],
            quote_start=start_time,
            quote_end=end_time,
            segments=segments,
        )

    duration = end_time - start_time

    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid quote time range")

    # Generate clip
    try:
        async with resolve_video(project) as video_path:
            mp4_bytes = clip_service.generate_quote_clip(
                video_url=video_path,
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


@router.post("/highlight/{highlight_id}", response_model=ClipResponse)
async def generate_highlight_clip(highlight_id: str):
    """Generate a video clip for a sermon highlight."""
    if not FFmpegService.is_ffmpeg_available():
        raise HTTPException(status_code=500, detail="FFmpeg is not installed")

    supabase = get_supabase()

    # Fetch highlight
    highlight_result = supabase.table("sermon_highlights").select("*").eq("id", highlight_id).single().execute()
    if not highlight_result.data:
        raise HTTPException(status_code=404, detail="Highlight not found")

    highlight = highlight_result.data

    # Fetch project for video URL
    project_result = supabase.table("projects").select("id, video_url, source_type, youtube_url").eq("id", highlight["project_id"]).single().execute()
    if not project_result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_result.data

    start_time = float(highlight["start_time"])
    end_time = float(highlight["end_time"])
    time_ranges = highlight.get("time_ranges")

    # Calculate duration based on time_ranges if present
    if time_ranges and len(time_ranges) >= 2:
        duration = sum(float(r["end"]) - float(r["start"]) for r in time_ranges)
    else:
        duration = end_time - start_time

    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid highlight time range")

    try:
        clip_service = ClipService()
        async with resolve_video(project) as video_path:
            if time_ranges and len(time_ranges) >= 2:
                mp4_bytes = clip_service.generate_merged_clip(
                    video_url=video_path,
                    time_ranges=time_ranges,
                    quote_text=highlight["quote_text"],
                )
            else:
                mp4_bytes = clip_service.generate_quote_clip(
                    video_url=video_path,
                    start_time=start_time,
                    end_time=end_time,
                    quote_text=highlight["quote_text"],
                )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Clip generation failed for highlight {highlight_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Clip generation failed")

    base64_video = base64.b64encode(mp4_bytes).decode("utf-8")
    data_url = f"data:video/mp4;base64,{base64_video}"

    slug = slugify(highlight["title"][:50])
    filename = f"clip-{slug}.mp4"

    return ClipResponse(
        video=data_url,
        quote_id=highlight_id,
        filename=filename,
        duration=duration,
    )


class SaveClipRequest(BaseModel):
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    aspect_ratio: str = "16:9"
    subtitle_style: str = "none"
    font_color: Optional[str] = None
    font_size: Optional[int] = None
    font_weight: Optional[str] = None
    bg_music: Optional[str] = None
    bg_music_volume: float = 0.15
    bg_music_segments: Optional[list[dict]] = None


@router.post("/highlight/{highlight_id}/save", response_model=SavedClipResponse)
async def save_highlight_clip(highlight_id: str, req: SaveClipRequest = SaveClipRequest()):
    """Generate a clip for a highlight and save it to the library.

    Uses the same editor clip generation as Export when editor settings are provided.
    """
    if not FFmpegService.is_ffmpeg_available():
        raise HTTPException(status_code=500, detail="FFmpeg is not installed")

    # Import editor helpers for music resolution and word filtering
    from routers.editor import _resolve_music_path, _filter_words

    supabase = get_supabase()

    # Fetch highlight
    highlight_result = supabase.table("sermon_highlights").select("*").eq("id", highlight_id).single().execute()
    if not highlight_result.data:
        raise HTTPException(status_code=404, detail="Highlight not found")

    highlight = highlight_result.data

    # Fetch project
    project_result = supabase.table("projects").select("*, church_id").eq("id", highlight["project_id"]).single().execute()
    if not project_result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_result.data
    church_id = project.get("church_id") or highlight.get("church_id")
    if not church_id:
        raise HTTPException(status_code=400, detail="No church_id found for this project")

    # Use request times if provided, otherwise fall back to highlight times
    start_time = req.start_time if req.start_time is not None else float(highlight["start_time"])
    end_time = req.end_time if req.end_time is not None else float(highlight["end_time"])
    time_ranges = highlight.get("time_ranges")

    if time_ranges and len(time_ranges) >= 2 and req.start_time is None:
        duration = sum(float(r["end"]) - float(r["start"]) for r in time_ranges)
    else:
        duration = end_time - start_time

    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid highlight time range")

    # Generate the clip using the same editor pipeline as Export
    try:
        clip_service = ClipService()

        # Get transcript words for subtitle rendering
        t_result = supabase.table("transcripts").select("segments").eq("project_id", highlight["project_id"]).limit(1).execute()
        words = []
        if t_result.data:
            segments = t_result.data[0].get("segments", [])
            words = _filter_words(segments, start_time, end_time)

        # Resolve background music
        bg_music_path = await _resolve_music_path(req.bg_music) if req.bg_music else None

        async with resolve_video(project) as video_path:
            # Use editor clip generation (with subtitles, aspect ratio, music)
            mp4_bytes = await asyncio.to_thread(
                clip_service.generate_editor_clip,
                video_path,
                start_time,
                end_time,
                words,
                req.subtitle_style,
                req.aspect_ratio,
                req.font_color,
                req.font_size,
                req.font_weight,
                bg_music_path,
                req.bg_music_volume,
                req.bg_music_segments,
            )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Clip generation failed for highlight {highlight_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Clip generation failed")

    # Upload to Supabase Storage
    clip_id = str(uuid.uuid4())
    slug = slugify(highlight["title"][:50])
    filename = f"clip-{slug}.mp4"
    storage_path = f"{church_id}/{clip_id}.mp4"
    thumbnail_storage_path = f"{church_id}/{clip_id}.jpg"

    try:
        supabase.storage.from_("clips").upload(
            storage_path,
            mp4_bytes,
            {"content-type": "video/mp4"},
        )
    except Exception as e:
        logger.error(f"Storage upload failed for clip {clip_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save clip to storage")

    # Generate and upload thumbnail
    thumbnail_bytes = extract_thumbnail(mp4_bytes)
    if thumbnail_bytes:
        try:
            supabase.storage.from_("clips").upload(
                thumbnail_storage_path,
                thumbnail_bytes,
                {"content-type": "image/jpeg"},
            )
        except Exception as e:
            logger.warning(f"Thumbnail upload failed for clip {clip_id}: {e}")
            thumbnail_storage_path = None
    else:
        thumbnail_storage_path = None

    # Insert into saved_clips table
    row = {
        "id": clip_id,
        "church_id": church_id,
        "project_id": highlight["project_id"],
        "highlight_id": highlight_id,
        "title": highlight["title"],
        "filename": filename,
        "video_path": storage_path,
        "thumbnail_path": thumbnail_storage_path,
        "duration_seconds": round(duration, 2),
        "quote_text": highlight.get("quote_text"),
    }

    try:
        result = supabase.table("saved_clips").insert(row).execute()
    except Exception as e:
        # Clean up storage on DB failure
        try:
            supabase.storage.from_("clips").remove([storage_path])
        except Exception:
            pass
        logger.error(f"DB insert failed for clip {clip_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save clip record")

    return SavedClipResponse(**result.data[0])


@router.get("/saved")
async def list_saved_clips(church_id: str = Query(...)):
    """List saved clips for a church."""
    supabase = get_supabase()

    result = supabase.table("saved_clips").select(
        "*, projects(title)"
    ).eq("church_id", church_id).order("created_at", desc=True).execute()

    clips = []
    for row in result.data or []:
        project_info = row.pop("projects", None)
        row["project_title"] = project_info["title"] if project_info else None

        # Generate signed URLs for playback and thumbnail
        try:
            signed = supabase.storage.from_("clips").create_signed_url(
                row["video_path"], 60 * 60 * 24  # 24 hours
            )
            row["signed_url"] = signed.get("signedURL") or signed.get("signedUrl")
        except Exception:
            row["signed_url"] = None

        if row.get("thumbnail_path"):
            try:
                thumb_signed = supabase.storage.from_("clips").create_signed_url(
                    row["thumbnail_path"], 60 * 60 * 24
                )
                row["thumbnail_url"] = thumb_signed.get("signedURL") or thumb_signed.get("signedUrl")
            except Exception:
                row["thumbnail_url"] = None
        else:
            row["thumbnail_url"] = None

        clips.append(row)

    return {"clips": clips}


@router.delete("/saved/{clip_id}")
async def delete_saved_clip(clip_id: str):
    """Delete a saved clip from storage and database."""
    supabase = get_supabase()

    # Fetch clip to get storage path
    clip_result = supabase.table("saved_clips").select("*").eq("id", clip_id).single().execute()
    if not clip_result.data:
        raise HTTPException(status_code=404, detail="Saved clip not found")

    clip = clip_result.data

    # Delete from storage
    paths_to_delete = [clip["video_path"]]
    if clip.get("thumbnail_path"):
        paths_to_delete.append(clip["thumbnail_path"])
    try:
        supabase.storage.from_("clips").remove(paths_to_delete)
    except Exception as e:
        logger.warning(f"Failed to delete clip from storage: {str(e)}")

    # Delete from database
    supabase.table("saved_clips").delete().eq("id", clip_id).execute()

    return {"success": True}
