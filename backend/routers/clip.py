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
from sqlmodel import select

from database import get_session, get_data_dir
from models import Project, Transcript, Quote, SermonHighlight, SavedClip

from services.ffmpeg_path import get_ffmpeg_path
from services.clip_service import ClipService
from services.ffmpeg_service import FFmpegService
from services.video_resolver import resolve_video

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/clip", tags=["clip"])


class ClipResponse(BaseModel):
    video: str  # base64 data URL
    quote_id: str
    filename: str
    duration: float


class SavedClipResponse(BaseModel):
    id: str
    project_id: str
    highlight_id: Optional[str] = None
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

    with get_session() as session:
        quote = session.get(Quote, quote_id)
        if not quote:
            raise HTTPException(status_code=404, detail="Quote not found")

        project = session.get(Project, quote.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Fetch transcript segments if smart mode enabled (get latest transcript)
        segments = []
        if smart:
            transcript = session.exec(
                select(Transcript)
                .where(Transcript.project_id == quote.project_id)
                .order_by(Transcript.created_at.desc())  # type: ignore[union-attr]
                .limit(1)
            ).first()
            if transcript and transcript.segments:
                segments = transcript.segments

        # Extract data before closing session
        quote_text = quote.text
        start_time = float(quote.start_time or 0)
        end_time = float(quote.end_time or 0)
        project_dict = project.model_dump()

    # Use smart boundary detection if enabled
    clip_service = ClipService()
    if smart and segments:
        start_time, end_time = clip_service.get_smart_boundaries(
            quote_text=quote_text,
            quote_start=start_time,
            quote_end=end_time,
            segments=segments,
        )

    duration = end_time - start_time

    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid quote time range")

    # Generate clip
    try:
        async with resolve_video(project_dict) as video_path:
            mp4_bytes = clip_service.generate_quote_clip(
                video_url=video_path,
                start_time=start_time,
                end_time=end_time,
                quote_text=quote_text,
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
    slug = slugify(quote_text[:50])
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

    with get_session() as session:
        highlight = session.get(SermonHighlight, highlight_id)
        if not highlight:
            raise HTTPException(status_code=404, detail="Highlight not found")

        project = session.get(Project, highlight.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Extract data before closing session
        h_start = float(highlight.start_time)
        h_end = float(highlight.end_time)
        h_time_ranges = highlight.time_ranges
        h_quote_text = highlight.quote_text
        h_title = highlight.title
        project_dict = project.model_dump()

    start_time = h_start
    end_time = h_end
    time_ranges = h_time_ranges

    # Calculate duration based on time_ranges if present
    if time_ranges and len(time_ranges) >= 2:
        duration = sum(float(r["end"]) - float(r["start"]) for r in time_ranges)
    else:
        duration = end_time - start_time

    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid highlight time range")

    try:
        clip_service = ClipService()
        async with resolve_video(project_dict) as video_path:
            if time_ranges and len(time_ranges) >= 2:
                mp4_bytes = clip_service.generate_merged_clip(
                    video_url=video_path,
                    time_ranges=time_ranges,
                    quote_text=h_quote_text,
                )
            else:
                mp4_bytes = clip_service.generate_quote_clip(
                    video_url=video_path,
                    start_time=start_time,
                    end_time=end_time,
                    quote_text=h_quote_text,
                )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Clip generation failed for highlight {highlight_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Clip generation failed")

    base64_video = base64.b64encode(mp4_bytes).decode("utf-8")
    data_url = f"data:video/mp4;base64,{base64_video}"

    slug = slugify(h_title[:50])
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

    with get_session() as session:
        highlight = session.get(SermonHighlight, highlight_id)
        if not highlight:
            raise HTTPException(status_code=404, detail="Highlight not found")

        project = session.get(Project, highlight.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Get transcript segments
        transcript = session.exec(
            select(Transcript)
            .where(Transcript.project_id == highlight.project_id)
            .limit(1)
        ).first()
        transcript_segments = transcript.segments if transcript and transcript.segments else []

        # Extract data before closing session
        h_start = float(highlight.start_time)
        h_end = float(highlight.end_time)
        h_time_ranges = highlight.time_ranges
        h_title = highlight.title
        h_quote_text = highlight.quote_text
        h_project_id = highlight.project_id
        project_dict = project.model_dump()

    # Use request times if provided, otherwise fall back to highlight times
    start_time = req.start_time if req.start_time is not None else h_start
    end_time = req.end_time if req.end_time is not None else h_end
    time_ranges = h_time_ranges

    if time_ranges and len(time_ranges) >= 2 and req.start_time is None:
        duration = sum(float(r["end"]) - float(r["start"]) for r in time_ranges)
    else:
        duration = end_time - start_time

    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid highlight time range")

    # Generate the clip using the same editor pipeline as Export
    try:
        clip_service = ClipService()

        words = _filter_words(transcript_segments, start_time, end_time)

        # Resolve background music
        bg_music_path = await _resolve_music_path(req.bg_music) if req.bg_music else None

        async with resolve_video(project_dict) as video_path:
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

    # Save to local file storage
    clip_id = str(uuid.uuid4())
    slug = slugify(h_title[:50])
    filename = f"clip-{slug}.mp4"

    clips_dir = os.path.join(get_data_dir(), "clips")
    os.makedirs(clips_dir, exist_ok=True)

    video_filename = f"{clip_id}.mp4"
    video_local_path = os.path.join(clips_dir, video_filename)
    thumbnail_filename = f"{clip_id}.jpg"
    thumbnail_local_path = os.path.join(clips_dir, thumbnail_filename)

    try:
        with open(video_local_path, "wb") as f:
            f.write(mp4_bytes)
    except Exception as e:
        logger.error(f"Storage write failed for clip {clip_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save clip to storage")

    # Generate and save thumbnail
    thumbnail_path_value = None
    thumbnail_bytes = extract_thumbnail(mp4_bytes)
    if thumbnail_bytes:
        try:
            with open(thumbnail_local_path, "wb") as f:
                f.write(thumbnail_bytes)
            thumbnail_path_value = thumbnail_filename
        except Exception as e:
            logger.warning(f"Thumbnail write failed for clip {clip_id}: {e}")

    # Insert into saved_clips table
    saved_clip = SavedClip(
        id=clip_id,
        project_id=h_project_id,
        highlight_id=highlight_id,
        title=h_title,
        filename=filename,
        video_path=video_filename,
        thumbnail_path=thumbnail_path_value,
        duration_seconds=round(duration, 2),
        quote_text=h_quote_text,
    )

    try:
        with get_session() as session:
            session.add(saved_clip)
            session.commit()
            session.refresh(saved_clip)
            return SavedClipResponse(
                id=saved_clip.id,
                project_id=saved_clip.project_id,
                highlight_id=saved_clip.highlight_id or "",
                title=saved_clip.title or "",
                filename=saved_clip.filename or "",
                video_path=saved_clip.video_path or "",
                thumbnail_path=saved_clip.thumbnail_path,
                duration_seconds=saved_clip.duration_seconds,
                quote_text=saved_clip.quote_text,
                created_at=saved_clip.created_at.isoformat(),
            )
    except Exception as e:
        # Clean up local file on DB failure
        try:
            os.remove(video_local_path)
        except Exception:
            pass
        logger.error(f"DB insert failed for clip {clip_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save clip record")


class ProjectSaveClipRequest(BaseModel):
    title: str = "Custom Clip"
    start_time: float
    end_time: float
    aspect_ratio: str = "16:9"
    subtitle_style: str = "none"
    font_color: Optional[str] = None
    font_size: Optional[int] = None
    font_weight: Optional[str] = None
    bg_music: Optional[str] = None
    bg_music_volume: float = 0.15
    bg_music_segments: Optional[list[dict]] = None


@router.post("/project/{project_id}/save", response_model=SavedClipResponse)
async def save_project_clip(project_id: str, req: ProjectSaveClipRequest):
    """Save a custom clip from the full video editor (no highlight required)."""
    if not FFmpegService.is_ffmpeg_available():
        raise HTTPException(status_code=500, detail="FFmpeg is not installed")

    from routers.editor import _resolve_music_path, _filter_words

    with get_session() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        transcript = session.exec(
            select(Transcript)
            .where(Transcript.project_id == project_id)
            .limit(1)
        ).first()
        transcript_segments = transcript.segments if transcript and transcript.segments else []

        project_dict = project.model_dump()
        project_title = project.title or "Custom Clip"

    duration = req.end_time - req.start_time
    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid time range")

    try:
        clip_service = ClipService()
        words = _filter_words(transcript_segments, req.start_time, req.end_time)
        bg_music_path = await _resolve_music_path(req.bg_music) if req.bg_music else None

        async with resolve_video(project_dict) as video_path:
            mp4_bytes = await asyncio.to_thread(
                clip_service.generate_editor_clip,
                video_path,
                req.start_time,
                req.end_time,
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
        logger.error(f"Clip generation failed for project {project_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Clip generation failed")

    clip_id = str(uuid.uuid4())
    slug = slugify(req.title[:50])
    filename = f"clip-{slug}.mp4"

    clips_dir = os.path.join(get_data_dir(), "clips")
    os.makedirs(clips_dir, exist_ok=True)

    video_filename = f"{clip_id}.mp4"
    video_local_path = os.path.join(clips_dir, video_filename)
    thumbnail_filename = f"{clip_id}.jpg"
    thumbnail_local_path = os.path.join(clips_dir, thumbnail_filename)

    try:
        with open(video_local_path, "wb") as f:
            f.write(mp4_bytes)
    except Exception as e:
        logger.error(f"Storage write failed for clip {clip_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save clip to storage")

    thumbnail_path_value = None
    thumbnail_bytes = extract_thumbnail(mp4_bytes)
    if thumbnail_bytes:
        try:
            with open(thumbnail_local_path, "wb") as f:
                f.write(thumbnail_bytes)
            thumbnail_path_value = thumbnail_filename
        except Exception as e:
            logger.warning(f"Thumbnail write failed for clip {clip_id}: {e}")

    saved_clip = SavedClip(
        id=clip_id,
        project_id=project_id,
        highlight_id=None,
        title=req.title,
        filename=filename,
        video_path=video_filename,
        thumbnail_path=thumbnail_path_value,
        duration_seconds=round(duration, 2),
        quote_text=None,
    )

    try:
        with get_session() as session:
            session.add(saved_clip)
            session.commit()
            session.refresh(saved_clip)
            return SavedClipResponse(
                id=saved_clip.id,
                project_id=saved_clip.project_id,
                highlight_id=saved_clip.highlight_id,
                title=saved_clip.title or "",
                filename=saved_clip.filename or "",
                video_path=saved_clip.video_path or "",
                thumbnail_path=saved_clip.thumbnail_path,
                duration_seconds=saved_clip.duration_seconds,
                quote_text=saved_clip.quote_text,
                created_at=saved_clip.created_at.isoformat(),
            )
    except Exception as e:
        try:
            os.remove(video_local_path)
        except Exception:
            pass
        logger.error(f"DB insert failed for clip {clip_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save clip record")


@router.get("/saved")
async def list_saved_clips():
    """List all saved clips."""
    with get_session() as session:
        clips = session.exec(
            select(SavedClip).order_by(SavedClip.created_at.desc())  # type: ignore[union-attr]
        ).all()

        result = []
        for clip in clips:
            # Look up project title
            project = session.get(Project, clip.project_id)
            project_title = project.title if project else None

            # Build local URLs
            signed_url = f"/files/clip/{clip.video_path}" if clip.video_path else None
            thumbnail_url = f"/files/clip/{clip.thumbnail_path}" if clip.thumbnail_path else None

            result.append({
                "id": clip.id,
                "project_id": clip.project_id,
                "highlight_id": clip.highlight_id,
                "title": clip.title,
                "filename": clip.filename,
                "video_path": clip.video_path,
                "thumbnail_path": clip.thumbnail_path,
                "duration_seconds": clip.duration_seconds,
                "quote_text": clip.quote_text,
                "created_at": clip.created_at.isoformat(),
                "project_title": project_title,
                "signed_url": signed_url,
                "thumbnail_url": thumbnail_url,
            })

    return {"clips": result}


@router.delete("/saved/{clip_id}")
async def delete_saved_clip(clip_id: str):
    """Delete a saved clip from storage and database."""
    with get_session() as session:
        clip = session.get(SavedClip, clip_id)
        if not clip:
            raise HTTPException(status_code=404, detail="Saved clip not found")

        # Delete local files
        clips_dir = os.path.join(get_data_dir(), "clips")
        if clip.video_path:
            video_file = os.path.join(clips_dir, clip.video_path)
            try:
                if os.path.exists(video_file):
                    os.remove(video_file)
            except Exception as e:
                logger.warning(f"Failed to delete clip video file: {str(e)}")

        if clip.thumbnail_path:
            thumb_file = os.path.join(clips_dir, clip.thumbnail_path)
            try:
                if os.path.exists(thumb_file):
                    os.remove(thumb_file)
            except Exception as e:
                logger.warning(f"Failed to delete clip thumbnail file: {str(e)}")

        # Delete from database
        session.delete(clip)
        session.commit()

    return {"success": True}
