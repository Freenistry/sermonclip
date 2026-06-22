import os
import tempfile
import shutil
from typing import Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from supabase import create_client, Client

from services.ffmpeg_service import FFmpegService
from services.whisper_mlx_service import WhisperMLXService, MLX_AVAILABLE
from services.ollama_service import OllamaService

router = APIRouter(prefix="/process", tags=["process"])


def get_supabase() -> Client:
    """Get Supabase client."""
    url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54421")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return create_client(url, key)


class ProcessResponse(BaseModel):
    project_id: str
    status: str
    message: str


class StatusResponse(BaseModel):
    project_id: str
    status: str
    video_url: Optional[str] = None
    transcript_id: Optional[str] = None
    quotes_count: int = 0


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

        # Get project
        result = supabase.table("projects").select("*").eq("id", project_id).single().execute()
        project = result.data

        if not project:
            raise ValueError(f"Project not found: {project_id}")

        video_url = project.get("video_url")
        if not video_url:
            raise ValueError("No video URL for project")

        church_id = project.get("church_id")

        # Create temp directory
        temp_dir = tempfile.mkdtemp(prefix=f"sermonclip_{project_id}_")
        video_path = os.path.join(temp_dir, "video.mp4")
        audio_path = os.path.join(temp_dir, "audio.wav")

        # Update status: downloading
        supabase.table("projects").update({
            "status": "downloading"
        }).eq("id", project_id).execute()

        # Download video
        import httpx
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.get(video_url, follow_redirects=True)
            if response.status_code != 200:
                raise ValueError(f"Failed to download video: {response.status_code}")
            with open(video_path, "wb") as f:
                f.write(response.content)

        # Update status: extracting audio
        supabase.table("projects").update({
            "status": "extracting_audio"
        }).eq("id", project_id).execute()

        # Extract audio
        FFmpegService.extract_audio(video_path, audio_path)
        duration = FFmpegService.get_video_duration(video_path)

        # Remove video file to save space
        os.remove(video_path)

        # Update status: transcribing
        supabase.table("projects").update({
            "status": "transcribing"
        }).eq("id", project_id).execute()

        # Transcribe
        if not MLX_AVAILABLE:
            raise RuntimeError("Whisper MLX not available")

        whisper_service = WhisperMLXService()
        transcript = whisper_service.transcribe(audio_path)

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
                }
                for seg in transcript.segments
            ],
        }).execute()

        transcript_id = transcript_result.data[0]["id"]

        # Update status: analyzing
        supabase.table("projects").update({
            "status": "analyzing"
        }).eq("id", project_id).execute()

        # Extract quotes
        ollama_service = OllamaService()
        if ollama_service.is_available():
            quotes = ollama_service.extract_quotes(transcript)

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

        # Update project status to completed
        supabase.table("projects").update({
            "status": "completed",
            "duration_seconds": duration,
        }).eq("id", project_id).execute()

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


@router.get("/project/{project_id}/status", response_model=StatusResponse)
async def get_processing_status(project_id: str):
    """Get the current processing status for a project."""
    supabase = get_supabase()

    # Get project
    result = supabase.table("projects").select("*").eq("id", project_id).single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = result.data

    # Get quote count if available
    quotes_result = supabase.table("quotes").select("id", count="exact").eq("project_id", project_id).execute()
    quotes_count = quotes_result.count or 0

    # Get transcript ID if available
    transcript_result = supabase.table("transcripts").select("id").eq("project_id", project_id).execute()
    transcript_id = transcript_result.data[0]["id"] if transcript_result.data else None

    return StatusResponse(
        project_id=project_id,
        status=project.get("status", "unknown"),
        video_url=project.get("video_url"),
        transcript_id=transcript_id,
        quotes_count=quotes_count,
    )
