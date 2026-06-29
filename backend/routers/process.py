import os
import tempfile
import shutil
import asyncio
import time
from typing import Optional, Set, Dict, Any
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from supabase import create_client, Client

from services.ffmpeg_service import FFmpegService
from services.whisper_mlx_service import WhisperMLXService, MLX_AVAILABLE
from services.ollama_service import OllamaService
from services.highlight_service import HighlightService, MergeSuggestion
from services.youtube_service import YouTubeService

router = APIRouter(prefix="/process", tags=["process"])

# Track cancelled projects
cancelled_projects: Set[str] = set()

# Track transcription progress: {project_id: {start_time, duration, status_message}}
transcription_progress: Dict[str, Dict[str, Any]] = {}


def get_supabase() -> Client:
    """Get Supabase client."""
    url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54421")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return create_client(url, key)


class ProcessResponse(BaseModel):
    project_id: str
    status: str
    message: str


def check_cancelled(project_id: str, supabase: Client, temp_dir: Optional[str] = None):
    """Check if project was cancelled and clean up if so."""
    if project_id in cancelled_projects:
        cancelled_projects.discard(project_id)
        supabase.table("projects").update({
            "status": "cancelled"
        }).eq("id", project_id).execute()
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
    Full processing pipeline for a project.

    Steps:
    1. Get project and video URL from database
    2. Download video to temp file
    3. Extract audio with FFmpeg
    4. Transcribe audio with Whisper MLX
    5. Extract quotes with Ollama
    6. Save transcript and quotes to database
    7. Update project status
    8. Clean up temp files
    """
    supabase = get_supabase()
    temp_dir = None

    try:
        # Update status to processing
        supabase.table("projects").update({
            "status": "processing"
        }).eq("id", project_id).execute()

        # Check for cancellation
        check_cancelled(project_id, supabase, temp_dir)

        # Get project
        result = supabase.table("projects").select("*").eq("id", project_id).single().execute()
        project = result.data

        if not project:
            raise ValueError(f"Project not found: {project_id}")

        source_type = project.get("source_type", "upload")
        church_id = project.get("church_id")

        # Create temp directory
        temp_dir = tempfile.mkdtemp(prefix=f"sermonclip_{project_id}_")
        video_path = os.path.join(temp_dir, "video.mp4")
        audio_path = os.path.join(temp_dir, "audio.wav")

        # Update status: downloading
        supabase.table("projects").update({
            "status": "downloading"
        }).eq("id", project_id).execute()

        # Check for cancellation
        check_cancelled(project_id, supabase, temp_dir)

        if source_type == "youtube":
            # Download from YouTube using yt-dlp
            youtube_url = project.get("youtube_url")
            if not youtube_url:
                raise ValueError("No YouTube URL for project")
            await YouTubeService.download_video(
                youtube_url,
                video_path,
                is_cancelled=lambda: project_id in cancelled_projects,
            )
        else:
            # Download from Supabase storage via signed URL
            video_url = project.get("video_url")
            if not video_url:
                raise ValueError("No video URL for project")
            import httpx
            async with httpx.AsyncClient(timeout=300.0) as client:
                async with client.stream("GET", video_url, follow_redirects=True) as response:
                    if response.status_code != 200:
                        raise ValueError(f"Failed to download video: {response.status_code}")

                    with open(video_path, "wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):  # 1MB chunks
                            # Check for cancellation every chunk
                            if project_id in cancelled_projects:
                                check_cancelled(project_id, supabase, temp_dir)
                            f.write(chunk)

        # Check for cancellation
        check_cancelled(project_id, supabase, temp_dir)

        # Update status: extracting audio
        supabase.table("projects").update({
            "status": "extracting_audio"
        }).eq("id", project_id).execute()

        # Extract audio - run in thread to keep event loop responsive
        await asyncio.to_thread(FFmpegService.extract_audio, video_path, audio_path)
        duration = await asyncio.to_thread(FFmpegService.get_video_duration, video_path)

        # Remove video file to save space
        os.remove(video_path)

        # Check for cancellation
        check_cancelled(project_id, supabase, temp_dir)

        # Update status: transcribing
        supabase.table("projects").update({
            "status": "transcribing"
        }).eq("id", project_id).execute()

        # Transcribe - run in thread pool to keep event loop responsive
        if not MLX_AVAILABLE:
            raise RuntimeError("Whisper MLX not available")

        # Track transcription progress (estimate based on duration)
        # Whisper typically processes at 0.3-0.5x realtime on M1/M2
        transcription_progress[project_id] = {
            "start_time": time.time(),
            "duration": duration or 0,
            "estimated_factor": 0.4,  # Estimated transcription speed factor
        }

        whisper_service = WhisperMLXService()
        # Run transcription in a separate thread so cancel requests can be processed
        transcript = await asyncio.to_thread(whisper_service.transcribe, audio_path)

        # Clean up progress tracking
        transcription_progress.pop(project_id, None)

        # Check for cancellation
        check_cancelled(project_id, supabase, temp_dir)

        # Save transcript to database
        transcript_result = supabase.table("transcripts").insert({
            "project_id": project_id,
            "church_id": church_id,
            "full_text": transcript.full_text,
            "segments": [
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
            ],
        }).execute()

        transcript_id = transcript_result.data[0]["id"]

        # Update status: analyzing
        supabase.table("projects").update({
            "status": "analyzing"
        }).eq("id", project_id).execute()

        # Extract quotes - run in thread pool to keep event loop responsive
        ollama_service = OllamaService()
        if ollama_service.is_available():
            quotes = await asyncio.to_thread(ollama_service.extract_quotes, transcript)

            # Save quotes to database
            for quote in quotes:
                supabase.table("quotes").insert({
                    "project_id": project_id,
                    "church_id": church_id,
                    "transcript_id": transcript_id,
                    "text": quote.text,
                    "start_time": quote.start_time,
                    "end_time": quote.end_time,
                    "context": quote.context,
                    "status": "pending",
                }).execute()

        # Extract sermon highlights
        check_cancelled(project_id, supabase, temp_dir)

        supabase.table("projects").update({
            "status": "extracting_highlights"
        }).eq("id", project_id).execute()

        highlight_service = HighlightService()
        quote_dicts = [
            {"text": q.text, "start_time": q.start_time, "end_time": q.end_time}
            for q in quotes
        ] if ollama_service.is_available() else []
        segment_dicts = [
            {"start": seg.start, "end": seg.end, "text": seg.text,
             "words": [{"word": w.word, "start": w.start, "end": w.end} for w in seg.words]}
            for seg in transcript.segments
        ]

        highlights = await asyncio.to_thread(
            highlight_service.extract_highlights, segment_dicts, quote_dicts
        )

        for highlight in highlights:
            supabase.table("sermon_highlights").insert({
                "project_id": project_id,
                "church_id": church_id,
                "title": highlight.title,
                "transcript_excerpt": highlight.transcript_excerpt,
                "quote_text": highlight.quote_text,
                "start_time": highlight.start_time,
                "end_time": highlight.end_time,
                "duration_tier": highlight.duration_tier,
            }).execute()

        # Generate merge suggestions
        await _generate_merge_suggestions(supabase, highlight_service, highlights, project_id, church_id)

        # Update project status to completed
        supabase.table("projects").update({
            "status": "completed",
            "video_duration_seconds": int(duration) if duration else None,
        }).eq("id", project_id).execute()

    except InterruptedError:
        # Cancelled by user - status already updated in check_cancelled
        pass

    except Exception as e:
        # Update status to failed
        supabase.table("projects").update({
            "status": "failed",
            "error_message": str(e),
        }).eq("id", project_id).execute()
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

    if not MLX_AVAILABLE:
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
    supabase = get_supabase()

    result = supabase.table("projects").select("*").eq("id", project_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = result.data
    if project["status"] != "completed":
        raise HTTPException(status_code=400, detail="Project must be completed before reprocessing highlights")

    # Verify transcript exists
    transcript_result = supabase.table("transcripts").select("id").eq("project_id", project_id).limit(1).execute()
    if not transcript_result.data:
        raise HTTPException(status_code=400, detail="No transcript found — run full processing first")

    background_tasks.add_task(_reprocess_highlights_task, project_id, project.get("church_id"))

    return ProcessResponse(
        project_id=project_id,
        status="started",
        message="Highlight re-extraction started.",
    )


async def _generate_merge_suggestions(
    supabase: Client,
    highlight_service: HighlightService,
    highlights: list,
    project_id: str,
    church_id: str,
):
    """Generate and save merge suggestions for a set of highlights."""
    try:
        merge_suggestions = await asyncio.to_thread(highlight_service.suggest_merges, highlights)
        if not merge_suggestions:
            return

        # Fetch saved highlights to get their UUIDs (ordered by start_time to match indices)
        saved = supabase.table("sermon_highlights").select("id, start_time").eq(
            "project_id", project_id
        ).order("start_time").execute()
        saved_highlights = saved.data or []

        if len(saved_highlights) != len(highlights):
            logger.warning("Saved highlight count mismatch — skipping merge suggestions")
            return

        for suggestion in merge_suggestions:
            highlight_uuids = [saved_highlights[i]["id"] for i in suggestion.highlight_indices]
            min_start = min(highlights[i].start_time for i in suggestion.highlight_indices)
            max_end = max(highlights[i].end_time for i in suggestion.highlight_indices)

            supabase.table("merge_suggestions").insert({
                "project_id": project_id,
                "church_id": church_id,
                "highlight_ids": highlight_uuids,
                "reason": suggestion.reason,
                "merged_title": suggestion.merged_title,
                "merged_start_time": min_start,
                "merged_end_time": max_end,
                "confidence": suggestion.confidence,
            }).execute()

        logger.info(f"Saved {len(merge_suggestions)} merge suggestions for project {project_id}")

    except Exception as e:
        logger.warning(f"Merge suggestion generation failed (non-fatal): {e}")


async def _reprocess_highlights_task(project_id: str, church_id: str):
    """Background task to re-extract highlights from existing transcript."""
    supabase = get_supabase()

    try:
        supabase.table("projects").update({"status": "extracting_highlights"}).eq("id", project_id).execute()

        # Get transcript segments
        transcript_result = supabase.table("transcripts").select("segments").eq(
            "project_id", project_id
        ).order("created_at", desc=True).limit(1).execute()
        segments = transcript_result.data[0]["segments"]
        segment_dicts = [{"start": s["start"], "end": s["end"], "text": s["text"], "words": s.get("words", [])} for s in segments]

        # Get quotes
        quotes_result = supabase.table("quotes").select("text, start_time, end_time").eq("project_id", project_id).execute()
        quote_dicts = quotes_result.data or []

        # Re-extract highlights
        highlight_service = HighlightService()
        highlights = await asyncio.to_thread(highlight_service.extract_highlights, segment_dicts, quote_dicts)

        # Delete old highlights and merge suggestions, then insert new ones
        supabase.table("merge_suggestions").delete().eq("project_id", project_id).execute()
        supabase.table("sermon_highlights").delete().eq("project_id", project_id).execute()
        for h in highlights:
            supabase.table("sermon_highlights").insert({
                "project_id": project_id,
                "church_id": church_id,
                "title": h.title,
                "transcript_excerpt": h.transcript_excerpt,
                "quote_text": h.quote_text,
                "start_time": h.start_time,
                "end_time": h.end_time,
                "duration_tier": h.duration_tier,
            }).execute()

        # Generate merge suggestions
        await _generate_merge_suggestions(supabase, highlight_service, highlights, project_id, church_id)

        supabase.table("projects").update({"status": "completed"}).eq("id", project_id).execute()

    except Exception as e:
        logger.error(f"Highlight reprocessing failed: {e}")
        supabase.table("projects").update({
            "status": "completed",
            "error_message": f"Highlight reprocessing failed: {e}",
        }).eq("id", project_id).execute()


@router.get("/project/{project_id}/status", response_model=StatusResponse)
async def get_processing_status(project_id: str, restart_if_stuck: bool = False, background_tasks: BackgroundTasks = None):
    """Get the current processing status for a project.

    Args:
        project_id: The project ID
        restart_if_stuck: If True and project is in a stuck processing state, restart it
        background_tasks: FastAPI background tasks (injected)
    """
    supabase = get_supabase()

    # Get project
    result = supabase.table("projects").select("*").eq("id", project_id).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = result.data
    status = project.get("status", "unknown")

    # Check for stuck processing jobs and restart if requested
    stuck_statuses = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights"]
    if restart_if_stuck and background_tasks and status in stuck_statuses:
        # Restart the processing pipeline
        background_tasks.add_task(process_project_pipeline, project_id)
        status = "restarting"

    # Get quote count if available
    quotes_result = supabase.table("quotes").select("id", count="exact").eq("project_id", project_id).execute()
    quotes_count = quotes_result.count or 0

    # Get highlight count
    highlights_result = supabase.table("sermon_highlights").select("id", count="exact").eq("project_id", project_id).execute()
    highlights_count = highlights_result.count or 0

    # Get transcript ID if available
    transcript_result = supabase.table("transcripts").select("id").eq("project_id", project_id).execute()
    transcript_id = transcript_result.data[0]["id"] if transcript_result.data else None

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
        video_url=project.get("video_url"),
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
        supabase = get_supabase()

        # Get current status
        result = supabase.table("projects").select("status").eq("id", project_id).single().execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Project not found")

        current_status = result.data.get("status")
        processing_statuses = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing"]

        if current_status not in processing_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot cancel project with status: {current_status}"
            )

        # Mark for cancellation
        cancelled_projects.add(project_id)

        # Immediately update status to show cancellation is pending
        supabase.table("projects").update({
            "status": "cancelling"
        }).eq("id", project_id).execute()

        return ProcessResponse(
            project_id=project_id,
            status="cancelling",
            message="Cancellation requested. Processing will stop at the next checkpoint."
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
