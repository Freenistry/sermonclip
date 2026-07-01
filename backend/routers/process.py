import logging
import os
import tempfile
import shutil
import asyncio
import time
from typing import Optional, Set, Dict, Any
from fastapi import APIRouter, HTTPException, BackgroundTasks, Form, File, UploadFile
from pydantic import BaseModel
from sqlmodel import select

from database import get_session, get_data_dir
from models import Project, Transcript as TranscriptModel, Quote, SermonHighlight, MergeSuggestion, SavedClip

from services.ffmpeg_service import FFmpegService
from services.whisper_mlx_service import WhisperMLXService, MLX_AVAILABLE, is_mlx_whisper_installed
from services.ollama_service import OllamaService
from services.highlight_service import HighlightService, MergeSuggestion as MergeSuggestionDTO
from services.youtube_service import YouTubeService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/process", tags=["process"])

# Track cancelled projects
cancelled_projects: Set[str] = set()

# Track transcription progress: {project_id: {start_time, duration, status_message}}
transcription_progress: Dict[str, Dict[str, Any]] = {}


def _update_project_status(project_id: str, status: str, **extra_fields):
    """Helper to update project status in a short-lived session."""
    with get_session() as session:
        project = session.get(Project, project_id)
        if project:
            project.status = status
            for k, v in extra_fields.items():
                setattr(project, k, v)
            session.add(project)
            session.commit()


class ProcessResponse(BaseModel):
    project_id: str
    status: str
    message: str


def check_cancelled(project_id: str, temp_dir: Optional[str] = None):
    """Check if project was cancelled and clean up if so."""
    if project_id in cancelled_projects:
        cancelled_projects.discard(project_id)
        _update_project_status(project_id, "cancelled")
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise InterruptedError("Processing cancelled by user")


class StatusResponse(BaseModel):
    project_id: str
    status: str
    video_url: Optional[str] = None
    transcript_id: Optional[str] = None
    quotes_count: int = 0
    highlights_count: int = 0
    progress_percent: Optional[int] = None
    progress_message: Optional[str] = None


async def process_project_pipeline(project_id: str):
    """
    Resumable processing pipeline for a project.

    Checks for existing transcript/quotes in the database and skips
    already-completed steps. This means a retry after a server restart
    won't redo expensive work (transcription, quote extraction).
    """
    temp_dir = None

    try:
        # Get project and check existing work in a single session block
        with get_session() as session:
            project = session.get(Project, project_id)
            if not project:
                raise ValueError(f"Project not found: {project_id}")

            source_type = project.source_type or "upload"
            sermon_language = project.sermon_language

            # Check what work has already been done (for resume after restart)
            existing_transcript = session.exec(
                select(TranscriptModel)
                .where(TranscriptModel.project_id == project_id)
                .order_by(TranscriptModel.created_at.desc())
                .limit(1)
            ).first()
            has_transcript = existing_transcript is not None

            existing_quotes = session.exec(
                select(Quote).where(Quote.project_id == project_id)
            ).all()
            has_quotes = bool(existing_quotes)

            existing_highlights = session.exec(
                select(SermonHighlight).where(SermonHighlight.project_id == project_id)
            ).all()
            has_highlights = bool(existing_highlights)

            # Grab data we need from existing records before session closes
            if has_transcript:
                existing_transcript_id = existing_transcript.id
                existing_transcript_full_text = existing_transcript.full_text
                existing_transcript_segments = existing_transcript.segments
            if has_quotes:
                existing_quotes_data = [
                    {"text": q.text, "start_time": q.start_time, "end_time": q.end_time}
                    for q in existing_quotes
                ]

            project_video_url = project.video_url
            project_youtube_url = project.youtube_url
            duration = project.video_duration_seconds

        if has_transcript and has_quotes and has_highlights:
            logger.info(f"Project {project_id}: all steps already complete, marking completed")
            _update_project_status(project_id, "completed")
            return

        # Set status to the correct resumption point
        if has_transcript and has_quotes:
            resume_status = "extracting_highlights"
        elif has_transcript:
            resume_status = "analyzing"
        else:
            resume_status = "processing"

        _update_project_status(project_id, resume_status)
        logger.info(f"Project {project_id}: resuming from {resume_status}")

        # Check for cancellation
        check_cancelled(project_id, temp_dir)

        # --- STEP 1-3: Download, extract audio, transcribe (skip if transcript exists) ---
        if not has_transcript:
            temp_dir = tempfile.mkdtemp(prefix=f"sermonclip_{project_id}_")
            video_path = os.path.join(temp_dir, "video.mp4")
            audio_path = os.path.join(temp_dir, "audio.wav")

            # Update status: downloading
            _update_project_status(project_id, "downloading")

            check_cancelled(project_id, temp_dir)

            if source_type == "youtube":
                if not project_youtube_url:
                    raise ValueError("No YouTube URL for project")
                await YouTubeService.download_video(
                    project_youtube_url,
                    video_path,
                    is_cancelled=lambda: project_id in cancelled_projects,
                )
            else:
                if not project_video_url:
                    raise ValueError("No video URL for project")

                # Check if video_url is a local path that already exists
                if os.path.isfile(project_video_url):
                    shutil.copy2(project_video_url, video_path)
                else:
                    import httpx
                    async with httpx.AsyncClient(timeout=300.0) as client:
                        async with client.stream("GET", project_video_url, follow_redirects=True) as response:
                            if response.status_code != 200:
                                raise ValueError(f"Failed to download video: {response.status_code}")

                            with open(video_path, "wb") as f:
                                async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                                    if project_id in cancelled_projects:
                                        check_cancelled(project_id, temp_dir)
                                    f.write(chunk)

            check_cancelled(project_id, temp_dir)

            # Update status: extracting audio
            _update_project_status(project_id, "extracting_audio")

            await asyncio.to_thread(FFmpegService.extract_audio, video_path, audio_path)
            duration = await asyncio.to_thread(FFmpegService.get_video_duration, video_path)

            # Save video to local storage
            data_dir = get_data_dir()
            video_dir = os.path.join(data_dir, "videos", project_id)
            os.makedirs(video_dir, exist_ok=True)
            local_video_path = os.path.join(video_dir, "video.mp4")
            shutil.copy2(video_path, local_video_path)

            # Update project with local video path
            with get_session() as session:
                proj = session.get(Project, project_id)
                if proj:
                    proj.video_url = local_video_path
                    session.add(proj)
                    session.commit()

            os.remove(video_path)

            check_cancelled(project_id, temp_dir)

            # Update status: transcribing
            _update_project_status(project_id, "transcribing")

            if not is_mlx_whisper_installed():
                raise RuntimeError("Whisper MLX not available")

            transcription_progress[project_id] = {
                "start_time": time.time(),
                "duration": duration or 0,
                "estimated_factor": 0.4,
            }

            whisper_service = WhisperMLXService()
            transcript = await asyncio.to_thread(whisper_service.transcribe, audio_path)

            transcription_progress.pop(project_id, None)

            check_cancelled(project_id, temp_dir)

            # Save transcript to database
            segment_dicts = [
                {
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text,
                    "words": [
                        {"word": w.word, "start": w.start, "end": w.end}
                        for w in seg.words
                    ],
                }
                for seg in transcript.segments
            ]

            with get_session() as session:
                db_transcript = TranscriptModel(
                    project_id=project_id,
                    full_text=transcript.full_text,
                    segments=segment_dicts,
                )
                session.add(db_transcript)
                session.commit()
                session.refresh(db_transcript)
                transcript_id = db_transcript.id
        else:
            # Resume: use existing transcript
            logger.info(f"Project {project_id}: transcript exists, skipping download/transcribe")
            transcript_id = existing_transcript_id
            segments = existing_transcript_segments
            segment_dicts = [
                {"start": s["start"], "end": s["end"], "text": s["text"],
                 "words": s.get("words", [])}
                for s in segments
            ]

        # --- STEP 4: Extract quotes (skip if quotes exist) ---
        if not has_quotes:
            _update_project_status(project_id, "analyzing")

            ollama_service = OllamaService()
            if ollama_service.is_available():
                # Need transcript object for quote extraction
                if has_transcript:
                    # Build a minimal Transcript-like object from DB data
                    from services.whisper_mlx_service import Transcript, TranscriptSegment, WordTimestamp
                    segments_data = existing_transcript_segments
                    full_text = existing_transcript_full_text
                    transcript_segments = [
                        TranscriptSegment(
                            start=s["start"], end=s["end"], text=s["text"],
                            words=[WordTimestamp(word=w["word"], start=w["start"], end=w["end"]) for w in s.get("words", [])]
                        )
                        for s in segments_data
                    ]
                    transcript = Transcript(full_text=full_text, segments=transcript_segments)

                quotes = await asyncio.to_thread(ollama_service.extract_quotes, transcript, sermon_language)

                with get_session() as session:
                    for quote in quotes:
                        session.add(Quote(
                            project_id=project_id,
                            transcript_id=transcript_id,
                            text=quote.text,
                            start_time=quote.start_time,
                            end_time=quote.end_time,
                            context=quote.context,
                            status="pending",
                        ))
                    session.commit()

                quote_dicts = [
                    {"text": q.text, "start_time": q.start_time, "end_time": q.end_time}
                    for q in quotes
                ]
            else:
                quote_dicts = []
        else:
            logger.info(f"Project {project_id}: quotes exist, skipping quote extraction")
            quote_dicts = existing_quotes_data

        # --- STEP 5: Extract highlights (skip if highlights exist) ---
        if not has_highlights:
            check_cancelled(project_id, temp_dir)

            _update_project_status(project_id, "extracting_highlights")

            highlight_service = HighlightService()
            highlights = await asyncio.to_thread(
                highlight_service.extract_highlights, segment_dicts, quote_dicts, sermon_language
            )

            with get_session() as session:
                for highlight in highlights:
                    session.add(SermonHighlight(
                        project_id=project_id,
                        title=highlight.title,
                        transcript_excerpt=highlight.transcript_excerpt,
                        quote_text=highlight.quote_text,
                        start_time=highlight.start_time,
                        end_time=highlight.end_time,
                        duration_tier=highlight.duration_tier,
                    ))
                session.commit()

            # Generate merge suggestions
            await _generate_merge_suggestions(highlight_service, highlights, project_id)
        else:
            logger.info(f"Project {project_id}: highlights exist, skipping highlight extraction")

        # Update project status to completed
        _update_project_status(project_id, "completed", video_duration_seconds=int(duration) if duration else None)

    except InterruptedError:
        # Cancelled by user - status already updated in check_cancelled
        pass

    except Exception as e:
        _update_project_status(project_id, "failed", error_message=str(e))
        raise

    finally:
        # Clean up temp directory
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/project/{project_id}", response_model=ProcessResponse)
async def start_processing(project_id: str, background_tasks: BackgroundTasks):
    """
    Start the full processing pipeline for a project.

    This triggers background processing that:
    1. Downloads the video
    2. Extracts audio
    3. Transcribes with Whisper
    4. Extracts quotes with Ollama
    5. Saves results to database
    """
    # Verify services are available
    if not FFmpegService.is_ffmpeg_available():
        raise HTTPException(
            status_code=503,
            detail="FFmpeg is not available"
        )

    if not is_mlx_whisper_installed():
        raise HTTPException(
            status_code=503,
            detail="Whisper MLX is not available"
        )

    # Add processing task to background
    background_tasks.add_task(process_project_pipeline, project_id)

    return ProcessResponse(
        project_id=project_id,
        status="started",
        message="Processing pipeline started. Check status endpoint for progress."
    )


@router.post("/project/{project_id}/reprocess-highlights", response_model=ProcessResponse)
async def reprocess_highlights(project_id: str, background_tasks: BackgroundTasks):
    """Re-extract highlights from existing transcript without reprocessing the full pipeline."""
    with get_session() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.status != "completed":
            raise HTTPException(status_code=400, detail="Project must be completed before reprocessing highlights")

        # Verify transcript exists
        transcript = session.exec(
            select(TranscriptModel).where(TranscriptModel.project_id == project_id).limit(1)
        ).first()
        if not transcript:
            raise HTTPException(status_code=400, detail="No transcript found -- run full processing first")

        sermon_language = project.sermon_language

    background_tasks.add_task(_reprocess_highlights_task, project_id, sermon_language)

    return ProcessResponse(
        project_id=project_id,
        status="started",
        message="Highlight re-extraction started.",
    )


async def _generate_merge_suggestions(
    highlight_service: HighlightService,
    highlights: list,
    project_id: str,
):
    """Generate and save merge suggestions for a set of highlights."""
    try:
        merge_suggestions = await asyncio.to_thread(highlight_service.suggest_merges, highlights)
        if not merge_suggestions:
            return

        # Fetch saved highlights to get their UUIDs (ordered by start_time to match indices)
        with get_session() as session:
            saved_highlights = session.exec(
                select(SermonHighlight)
                .where(SermonHighlight.project_id == project_id)
                .order_by(SermonHighlight.start_time)
            ).all()

            if len(saved_highlights) != len(highlights):
                logger.warning("Saved highlight count mismatch -- skipping merge suggestions")
                return

            for suggestion in merge_suggestions:
                highlight_uuids = [saved_highlights[i].id for i in suggestion.highlight_indices]
                min_start = min(highlights[i].start_time for i in suggestion.highlight_indices)
                max_end = max(highlights[i].end_time for i in suggestion.highlight_indices)

                session.add(MergeSuggestion(
                    project_id=project_id,
                    highlight_ids=highlight_uuids,
                    reason=suggestion.reason,
                    merged_title=suggestion.merged_title,
                    merged_start_time=min_start,
                    merged_end_time=max_end,
                    confidence=suggestion.confidence,
                ))
            session.commit()

        logger.info(f"Saved {len(merge_suggestions)} merge suggestions for project {project_id}")

    except Exception as e:
        logger.warning(f"Merge suggestion generation failed (non-fatal): {e}")


async def _reprocess_highlights_task(project_id: str, sermon_language: str = None):
    """Background task to re-extract highlights from existing transcript."""
    try:
        _update_project_status(project_id, "extracting_highlights")

        # Get transcript segments
        with get_session() as session:
            transcript = session.exec(
                select(TranscriptModel)
                .where(TranscriptModel.project_id == project_id)
                .order_by(TranscriptModel.created_at.desc())
                .limit(1)
            ).first()
            segments = transcript.segments
            segment_dicts = [
                {"start": s["start"], "end": s["end"], "text": s["text"], "words": s.get("words", [])}
                for s in segments
            ]

            # Get quotes
            quotes = session.exec(
                select(Quote).where(Quote.project_id == project_id)
            ).all()
            quote_dicts = [
                {"text": q.text, "start_time": q.start_time, "end_time": q.end_time}
                for q in quotes
            ]

        # Re-extract highlights
        highlight_service = HighlightService()
        highlights = await asyncio.to_thread(
            highlight_service.extract_highlights, segment_dicts, quote_dicts, sermon_language
        )

        # Delete old highlights and merge suggestions, then insert new ones
        with get_session() as session:
            old_merge_suggestions = session.exec(
                select(MergeSuggestion).where(MergeSuggestion.project_id == project_id)
            ).all()
            for ms in old_merge_suggestions:
                session.delete(ms)

            old_highlights = session.exec(
                select(SermonHighlight).where(SermonHighlight.project_id == project_id)
            ).all()
            for h in old_highlights:
                session.delete(h)

            session.commit()

        with get_session() as session:
            for h in highlights:
                session.add(SermonHighlight(
                    project_id=project_id,
                    title=h.title,
                    transcript_excerpt=h.transcript_excerpt,
                    quote_text=h.quote_text,
                    start_time=h.start_time,
                    end_time=h.end_time,
                    duration_tier=h.duration_tier,
                ))
            session.commit()

        # Generate merge suggestions
        await _generate_merge_suggestions(highlight_service, highlights, project_id)

        _update_project_status(project_id, "completed")

    except Exception as e:
        logger.error(f"Highlight reprocessing failed: {e}")
        _update_project_status(project_id, "completed", error_message=f"Highlight reprocessing failed: {e}")


@router.get("/project/{project_id}/status", response_model=StatusResponse)
async def get_processing_status(project_id: str, restart_if_stuck: bool = False, background_tasks: BackgroundTasks = None):
    """Get the current processing status for a project.

    Args:
        project_id: The project ID
        restart_if_stuck: If True and project is in a stuck processing state, restart it
        background_tasks: FastAPI background tasks (injected)
    """
    with get_session() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        status = project.status or "unknown"

        # Check for stuck processing jobs and restart if requested
        stuck_statuses = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights"]
        if restart_if_stuck and background_tasks and status in stuck_statuses:
            background_tasks.add_task(process_project_pipeline, project_id)
            status = "restarting"

        # Get quote count
        quotes_count = len(session.exec(
            select(Quote.id).where(Quote.project_id == project_id)
        ).all())

        # Get highlight count
        highlights_count = len(session.exec(
            select(SermonHighlight.id).where(SermonHighlight.project_id == project_id)
        ).all())

        # Get transcript ID if available
        transcript = session.exec(
            select(TranscriptModel).where(TranscriptModel.project_id == project_id)
        ).first()
        transcript_id = transcript.id if transcript else None

        video_url = project.video_url

    # Calculate transcription progress if in transcribing state
    progress_percent = None
    progress_message = None
    if status == "transcribing" and project_id in transcription_progress:
        progress_info = transcription_progress[project_id]
        elapsed = time.time() - progress_info["start_time"]
        duration = progress_info["duration"]
        factor = progress_info["estimated_factor"]

        if duration > 0:
            # Estimate progress based on elapsed time vs expected duration
            expected_time = duration * factor
            progress_percent = min(int((elapsed / expected_time) * 100), 99)
            remaining = max(0, expected_time - elapsed)
            if remaining > 60:
                progress_message = f"~{int(remaining / 60)} minutes remaining"
            else:
                progress_message = f"~{int(remaining)} seconds remaining"

    return StatusResponse(
        project_id=project_id,
        status=status,
        video_url=video_url,
        transcript_id=transcript_id,
        quotes_count=quotes_count,
        highlights_count=highlights_count,
        progress_percent=progress_percent,
        progress_message=progress_message,
    )


@router.post("/project/{project_id}/cancel", response_model=ProcessResponse)
async def cancel_processing(project_id: str):
    """
    Cancel an ongoing processing job.

    The cancellation is cooperative - it will stop at the next checkpoint.
    """
    try:
        with get_session() as session:
            project = session.get(Project, project_id)
            if not project:
                raise HTTPException(status_code=404, detail="Project not found")

            current_status = project.status
            processing_statuses = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing"]

            if current_status not in processing_statuses:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot cancel project with status: {current_status}"
                )

            # Mark for cancellation
            cancelled_projects.add(project_id)

            # Immediately update status to show cancellation is pending
            project.status = "cancelling"
            session.add(project)
            session.commit()

        return ProcessResponse(
            project_id=project_id,
            status="cancelling",
            message="Cancellation requested. Processing will stop at the next checkpoint."
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/youtube")
async def create_youtube_project(body: dict):
    """Create a project from a YouTube URL (does NOT start processing)."""
    title = body.get("title")
    youtube_url = body.get("youtube_url")
    sermon_language = body.get("sermon_language")

    if not title or not youtube_url:
        raise HTTPException(status_code=400, detail="title and youtube_url are required")

    with get_session() as session:
        project = Project(
            title=title,
            youtube_url=youtube_url,
            source_type="youtube",
            sermon_language=sermon_language,
            status="pending",
        )
        session.add(project)
        session.commit()
        session.refresh(project)
        return project.model_dump()


@router.post("/upload")
async def create_upload_project(title: str = Form(...), video: UploadFile = File(...), sermon_language: Optional[str] = Form(None)):
    """Create a project from a video file upload (does NOT start processing)."""
    with get_session() as session:
        project = Project(
            title=title,
            source_type="upload",
            sermon_language=sermon_language,
            status="pending",
        )
        session.add(project)
        session.commit()
        session.refresh(project)

        # Save video file locally
        data_dir = get_data_dir()
        video_dir = os.path.join(data_dir, "videos", project.id)
        os.makedirs(video_dir, exist_ok=True)

        # Preserve original extension
        ext = os.path.splitext(video.filename or "video.mp4")[1] or ".mp4"
        video_path = os.path.join(video_dir, f"video{ext}")

        with open(video_path, "wb") as f:
            while chunk := await video.read(1024 * 1024):
                f.write(chunk)

        project.video_url = video_path
        session.add(project)
        session.commit()
        session.refresh(project)
        return project.model_dump()


@router.get("/projects")
async def list_projects():
    """List all projects."""
    with get_session() as session:
        projects = session.exec(
            select(Project).order_by(Project.created_at.desc())
        ).all()
        result = []
        for p in projects:
            # Count highlights
            highlights = session.exec(
                select(SermonHighlight).where(SermonHighlight.project_id == p.id)
            ).all()
            data = p.model_dump()
            data["highlight_count"] = len(highlights)
            result.append(data)
        return result


@router.get("/project/{project_id}/detail")
async def get_project_detail(project_id: str):
    """Get full project detail including transcript, highlights, quotes."""
    with get_session() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(404, "Project not found")

        transcript = session.exec(
            select(TranscriptModel).where(TranscriptModel.project_id == project_id)
            .order_by(TranscriptModel.created_at.desc()).limit(1)
        ).first()

        highlights = session.exec(
            select(SermonHighlight).where(SermonHighlight.project_id == project_id)
            .order_by(SermonHighlight.start_time)
        ).all()

        quotes = session.exec(
            select(Quote).where(Quote.project_id == project_id)
            .order_by(Quote.start_time)
        ).all()

        merge_suggestions = session.exec(
            select(MergeSuggestion).where(
                MergeSuggestion.project_id == project_id,
                MergeSuggestion.status == "pending"
            )
        ).all()

        return {
            "project": project.model_dump(),
            "transcript": transcript.model_dump() if transcript else None,
            "highlights": [h.model_dump() for h in highlights],
            "quotes": [q.model_dump() for q in quotes],
            "merge_suggestions": [m.model_dump() for m in merge_suggestions],
        }


@router.delete("/project/{project_id}")
async def delete_project(project_id: str):
    """Delete a project and all associated data."""
    with get_session() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(404, "Project not found")

        # Delete associated data
        for model in [Quote, SermonHighlight, MergeSuggestion, TranscriptModel, SavedClip]:
            items = session.exec(select(model).where(model.project_id == project_id)).all()
            for item in items:
                session.delete(item)

        session.delete(project)
        session.commit()

    # Clean up local files
    video_dir = os.path.join(get_data_dir(), "videos", project_id)
    if os.path.isdir(video_dir):
        shutil.rmtree(video_dir)

    return {"status": "deleted"}
