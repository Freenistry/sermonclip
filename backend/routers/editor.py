import os
import asyncio
import base64
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import create_client, Client

from pathlib import Path
from services.video_resolver import resolve_video
from services.ffmpeg_service import FFmpegService
from services.clip_service import ClipService

MUSIC_DIR = Path(__file__).parent.parent / "assets" / "music"

MUSIC_TRACKS = [
    {"id": "inspiring", "name": "Inspiring", "file": "inspiring.mp3"},
    {"id": "upbeat", "name": "Upbeat", "file": "upbeat.mp3"},
    {"id": "ambient", "name": "Ambient", "file": "ambient.mp3"},
    {"id": "cinematic", "name": "Cinematic", "file": "cinematic.mp3"},
    {"id": "worship", "name": "Worship", "file": "worship.mp3"},
]


def _filter_words(segments: list[dict], start_time: float, end_time: float) -> list[dict]:
    """Filter transcript segments/words overlapping a time range."""
    words = []
    for seg in segments:
        if seg["end"] < start_time or seg["start"] > end_time:
            continue
        seg_words = seg.get("words", [])
        if seg_words:
            for w in seg_words:
                if w["end"] >= start_time and w["start"] <= end_time:
                    words.append({"word": w["word"], "start": w["start"], "end": w["end"]})
        else:
            # Fallback: split segment text into words, distribute timing evenly
            text = seg.get("text", "").strip()
            if not text:
                continue
            text_words = text.split()
            seg_duration = seg["end"] - seg["start"]
            word_duration = seg_duration / max(len(text_words), 1)
            for i, w in enumerate(text_words):
                w_start = seg["start"] + i * word_duration
                w_end = w_start + word_duration
                if w_end >= start_time and w_start <= end_time:
                    words.append({"word": w, "start": w_start, "end": w_end})
    return words

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/editor", tags=["editor"])


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54421")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return create_client(url, key)


class WordItem(BaseModel):
    word: str
    start: float
    end: float


class WordsResponse(BaseModel):
    highlight_id: str
    start_time: float
    end_time: float
    words: list[WordItem]


@router.get("/highlight/{highlight_id}/words", response_model=WordsResponse)
async def get_highlight_words(highlight_id: str):
    """Get word-level timestamps for a highlight's time range."""
    supabase = get_supabase()

    # Get highlight
    result = supabase.table("sermon_highlights").select("*").eq("id", highlight_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Highlight not found")

    highlight = result.data
    project_id = highlight["project_id"]
    h_start = highlight["start_time"]
    h_end = highlight["end_time"]

    # Get transcript for this project (use limit(1) in case of duplicates)
    t_result = supabase.table("transcripts").select("segments").eq("project_id", project_id).limit(1).execute()
    if not t_result.data:
        raise HTTPException(status_code=404, detail="Transcript not found")

    segments = t_result.data[0].get("segments", [])

    # Filter segments overlapping highlight range and flatten words
    word_dicts = _filter_words(segments, h_start, h_end)
    words = [WordItem(**w) for w in word_dicts]

    return WordsResponse(
        highlight_id=highlight_id,
        start_time=h_start,
        end_time=h_end,
        words=words,
    )


class WaveformResponse(BaseModel):
    peaks: list[float]
    start_time: float
    end_time: float


@router.get("/project/{project_id}/waveform", response_model=WaveformResponse)
async def get_waveform(project_id: str, start: float = 0, end: float = 0, peaks: int = 200):
    """Generate waveform peaks for a time range of the project video."""
    supabase = get_supabase()

    result = supabase.table("projects").select("*").eq("id", project_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = result.data

    async with resolve_video(project) as video_path:
        if end <= start:
            end = await asyncio.to_thread(FFmpegService.get_video_duration, video_path)

        waveform_peaks = await asyncio.to_thread(
            FFmpegService.generate_waveform_peaks, video_path, start, end, peaks
        )

    return WaveformResponse(peaks=waveform_peaks, start_time=start, end_time=end)


@router.get("/music")
async def list_music_tracks():
    """List available background music tracks."""
    tracks = []
    for t in MUSIC_TRACKS:
        path = MUSIC_DIR / t["file"]
        if path.exists():
            tracks.append({"id": t["id"], "name": t["name"]})
    return {"tracks": tracks}


class ExportRequest(BaseModel):
    start_time: float
    end_time: float
    aspect_ratio: str = "16:9"
    subtitle_style: str = "basic"
    font_color: Optional[str] = None     # hex color e.g. "#FFFFFF"
    font_size: Optional[int] = None      # px, e.g. 48
    font_weight: Optional[str] = None    # "normal" or "bold"
    bg_music: Optional[str] = None       # music track id e.g. "inspiring"
    bg_music_volume: float = 0.15        # 0.0 to 1.0


class ExportResponse(BaseModel):
    video: str
    filename: str
    duration: float


@router.post("/highlight/{highlight_id}/export", response_model=ExportResponse)
async def export_editor_clip(highlight_id: str, req: ExportRequest):
    """Export a clip with animated subtitles and aspect ratio crop."""
    supabase = get_supabase()

    # Get highlight
    result = supabase.table("sermon_highlights").select("*").eq("id", highlight_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Highlight not found")

    highlight = result.data
    project_id = highlight["project_id"]

    # Get transcript words for the time range (use limit(1) in case of duplicates)
    t_result = supabase.table("transcripts").select("segments").eq("project_id", project_id).limit(1).execute()
    if not t_result.data:
        raise HTTPException(status_code=404, detail="Transcript not found")

    segments = t_result.data[0].get("segments", [])
    words = _filter_words(segments, req.start_time, req.end_time)

    # Get project for video
    p_result = supabase.table("projects").select("*").eq("id", project_id).single().execute()
    if not p_result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = p_result.data
    clip_service = ClipService()

    # Resolve background music path
    bg_music_path = None
    if req.bg_music:
        for t in MUSIC_TRACKS:
            if t["id"] == req.bg_music:
                p = MUSIC_DIR / t["file"]
                if p.exists():
                    bg_music_path = str(p)
                break

    async with resolve_video(project) as video_path:
        clip_bytes = await asyncio.to_thread(
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
        )

    video_b64 = base64.b64encode(clip_bytes).decode("utf-8")
    duration = req.end_time - req.start_time
    safe_title = highlight.get("title", "clip").replace(" ", "_")[:30]
    filename = f"{safe_title}_{req.aspect_ratio.replace(':', 'x')}.mp4"

    return ExportResponse(
        video=f"data:video/mp4;base64,{video_b64}",
        filename=filename,
        duration=duration,
    )


@router.get("/project/{project_id}/video-stream")
async def video_stream(project_id: str, request: Request):
    """Stream video with Range support for HTML5 video seeking."""
    supabase = get_supabase()

    result = supabase.table("projects").select("*").eq("id", project_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = result.data

    # For upload projects, redirect to signed URL
    if project.get("source_type") != "youtube":
        video_url = project.get("video_url")
        if not video_url:
            raise HTTPException(status_code=404, detail="No video URL")
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=video_url)

    # For YouTube projects, stream from cached file
    from services.video_resolver import _cached_path, resolve_video as _rv
    from services.youtube_service import YouTubeService

    cached = _cached_path(project_id)

    # Ensure video is downloaded
    if not os.path.isfile(cached) or os.path.getsize(cached) == 0:
        youtube_url = project.get("youtube_url")
        if not youtube_url:
            raise HTTPException(status_code=404, detail="No YouTube URL")
        await YouTubeService.download_video(youtube_url, cached)

    file_size = os.path.getsize(cached)
    range_header = request.headers.get("range")

    if range_header:
        # Parse range header with validation
        try:
            range_match = range_header.replace("bytes=", "").split("-")
            start = int(range_match[0])
            end = int(range_match[1]) if range_match[1] else file_size - 1
            end = min(end, file_size - 1)
            if start < 0 or start > end:
                raise ValueError("Invalid range")
        except (ValueError, IndexError):
            raise HTTPException(status_code=416, detail="Invalid Range header")
        chunk_size = end - start + 1

        def iter_file():
            with open(cached, "rb") as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    read_size = min(remaining, 1024 * 1024)
                    data = f.read(read_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            iter_file(),
            status_code=206,
            media_type="video/mp4",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
            },
        )

    def iter_full():
        with open(cached, "rb") as f:
            while chunk := f.read(1024 * 1024):
                yield chunk

    return StreamingResponse(
        iter_full(),
        media_type="video/mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        },
    )
