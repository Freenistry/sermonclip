import os
import asyncio
import base64
import json
import logging
import re
import subprocess
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from sqlmodel import select
import httpx

from pathlib import Path
from database import get_session, get_data_dir
from models import Project, Transcript, SermonHighlight

from services.ffmpeg_path import get_ffmpeg_path
from services.video_resolver import resolve_video
from services.ffmpeg_service import FFmpegService
from services.clip_service import ClipService

MUSIC_DIR = Path(__file__).parent.parent / "assets" / "music"
MUSIC_CACHE_DIR = Path(__file__).parent.parent / "cache" / "music"
MUSIC_CACHE_DIR.mkdir(parents=True, exist_ok=True)
MUSIC_UPLOAD_DIR = Path(__file__).parent.parent / "cache" / "music_uploads"
MUSIC_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
THUMBNAIL_CACHE_DIR = Path(__file__).parent.parent / "cache" / "thumbnails"
THUMBNAIL_CACHE_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50MB
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9]+$")

JAMENDO_CLIENT_ID = os.getenv("JAMENDO_CLIENT_ID", "")
JAMENDO_API_URL = "https://api.jamendo.com/v3.0"

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
    with get_session() as session:
        highlight = session.get(SermonHighlight, highlight_id)
        if not highlight:
            raise HTTPException(status_code=404, detail="Highlight not found")

        project_id = highlight.project_id
        h_start = highlight.start_time
        h_end = highlight.end_time

        # Get transcript for this project
        transcript = session.exec(
            select(Transcript)
            .where(Transcript.project_id == project_id)
            .limit(1)
        ).first()
        if not transcript:
            raise HTTPException(status_code=404, detail="Transcript not found")

        segments = transcript.segments or []

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
    with get_session() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        project_dict = project.model_dump()

    async with resolve_video(project_dict) as video_path:
        if end <= start:
            end = await asyncio.to_thread(FFmpegService.get_video_duration, video_path)

        waveform_peaks = await asyncio.to_thread(
            FFmpegService.generate_waveform_peaks, video_path, start, end, peaks
        )

    return WaveformResponse(peaks=waveform_peaks, start_time=start, end_time=end)


@router.get("/project/{project_id}/thumbnails")
async def get_thumbnails(
    project_id: str,
    start: float = 0,
    end: float = 0,
    count: int = 20,
    height: int = 80,
):
    """Generate a sprite sheet of video frame thumbnails for the timeline."""
    if not re.match(r"^[a-zA-Z0-9\-]+$", project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")

    with get_session() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        project_dict = project.model_dump()

    # Clamp params to reasonable range
    count = max(5, min(count, 60))
    height = max(40, min(height, 200))

    # Cache key based on params
    cache_key = f"{project_id}_{start:.1f}_{end:.1f}_{count}_{height}"
    cache_file = THUMBNAIL_CACHE_DIR / f"{cache_key}.jpg"

    if cache_file.exists() and cache_file.stat().st_size > 0:
        return FileResponse(str(cache_file), media_type="image/jpeg")

    try:
        async with resolve_video(project_dict) as video_path:
            if end <= start:
                end = await asyncio.to_thread(FFmpegService.get_video_duration, video_path)

            sprite_bytes = await asyncio.to_thread(
                FFmpegService.generate_thumbnail_sprite,
                video_path, start, end, count, height,
            )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    cache_file.write_bytes(sprite_bytes)
    return FileResponse(str(cache_file), media_type="image/jpeg")


@router.get("/music")
async def list_music_tracks():
    """List bundled background music tracks."""
    tracks = []
    for t in MUSIC_TRACKS:
        path = MUSIC_DIR / t["file"]
        if path.exists():
            tracks.append({"id": t["id"], "name": t["name"], "source": "bundled"})
    return {"tracks": tracks}


@router.get("/music/search")
async def search_music(
    q: str = "",
    tags: str = "",
    speed: str = "",
    limit: int = 20,
    offset: int = 0,
):
    """Search Jamendo for background music tracks."""
    if not JAMENDO_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Jamendo API not configured")

    params = {
        "client_id": JAMENDO_CLIENT_ID,
        "format": "json",
        "limit": min(limit, 50),
        "offset": offset,
        "vocalinstrumental": "instrumental",
        "include": "musicinfo",
        "audioformat": "mp32",
        "order": "relevance_desc",
        "fullcount": "true",
    }
    if q:
        params["search"] = q
    if tags:
        params["fuzzytags"] = tags
    if speed:
        params["speed"] = speed

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{JAMENDO_API_URL}/tracks/", params=params)
        if resp.status_code != 200:
            logger.error(f"Jamendo API error: {resp.status_code} {resp.text[:200]}")
            raise HTTPException(status_code=502, detail="Jamendo API error")

        data = resp.json()

    results = []
    for track in data.get("results", []):
        results.append({
            "id": f"jamendo:{track['id']}",
            "name": track.get("name", "Untitled"),
            "artist": track.get("artist_name", "Unknown"),
            "duration": track.get("duration", 0),
            "audio": track.get("audio", ""),
            "image": track.get("album_image", ""),
            "source": "jamendo",
        })

    return {
        "tracks": results,
        "total": data.get("headers", {}).get("results_fullcount", len(results)),
    }


@router.get("/music/categories")
async def music_categories():
    """Return curated music category presets for quick browsing."""
    return {
        "categories": [
            {"id": "inspiring", "label": "Inspiring", "tags": "inspiring+uplifting"},
            {"id": "ambient", "label": "Ambient", "tags": "ambient+relaxing"},
            {"id": "cinematic", "label": "Cinematic", "tags": "cinematic+epic"},
            {"id": "upbeat", "label": "Upbeat", "tags": "energetic+happy"},
            {"id": "worship", "label": "Worship", "tags": "spiritual+peaceful"},
            {"id": "acoustic", "label": "Acoustic", "tags": "acoustic+soft"},
            {"id": "piano", "label": "Piano", "tags": "piano+classical"},
            {"id": "lofi", "label": "Lo-Fi", "tags": "lofi+chill"},
        ]
    }


@router.post("/music/upload")
async def upload_music(file: UploadFile = File(...)):
    """Upload a music file for use as background music."""
    # Validate by file extension (content_type is unreliable from browsers/curl)
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    allowed_exts = {".mp3", ".wav", ".ogg", ".aac", ".m4a"}
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext or 'unknown'}. Upload MP3, WAV, OGG, or AAC.",
        )

    # Read and validate size
    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    # Generate a safe filename
    file_id = uuid.uuid4().hex[:12]
    original_name = file.filename or "uploaded"
    safe_name = f"{file_id}{ext}"

    dest = MUSIC_UPLOAD_DIR / safe_name
    dest.write_bytes(data)

    # Get duration via ffprobe
    duration = 0
    try:
        duration = FFmpegService.get_video_duration(str(dest))
    except Exception:
        pass

    # Store metadata alongside the file
    meta_path = MUSIC_UPLOAD_DIR / f"{file_id}.json"
    meta = {
        "id": f"upload:{file_id}",
        "name": Path(original_name).stem,
        "filename": safe_name,
        "duration": duration,
        "size": len(data),
    }
    meta_path.write_text(json.dumps(meta))

    logger.info(f"Uploaded music: {original_name} -> {safe_name} ({len(data)} bytes)")

    return {
        "id": f"upload:{file_id}",
        "name": Path(original_name).stem,
        "duration": duration,
        "audio": f"/editor/music/stream/{file_id}",
        "source": "upload",
    }


@router.get("/music/uploads")
async def list_uploaded_music():
    """List user-uploaded music files."""
    uploads = []
    for meta_path in sorted(MUSIC_UPLOAD_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            meta = json.loads(meta_path.read_text())
            file_id = meta["id"].split(":", 1)[1]
            meta["audio"] = f"/editor/music/stream/{file_id}"
            meta["source"] = "upload"
            uploads.append(meta)
        except Exception:
            continue
    return {"tracks": uploads}


@router.get("/music/stream/{file_id}")
async def stream_music(file_id: str, request: Request):
    """Stream an uploaded music file with Range support."""
    if not SAFE_ID_PATTERN.match(file_id):
        raise HTTPException(status_code=400, detail="Invalid file ID")
    # Find the file by ID prefix
    matches = list(MUSIC_UPLOAD_DIR.glob(f"{file_id}.*"))
    audio_file = None
    for m in matches:
        if m.suffix != ".json":
            audio_file = m
            break

    if not audio_file or not audio_file.exists():
        raise HTTPException(status_code=404, detail="Music file not found")

    media_types = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".aac": "audio/aac",
        ".m4a": "audio/mp4",
    }
    media_type = media_types.get(audio_file.suffix, "audio/mpeg")
    file_size = audio_file.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
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
            with open(audio_file, "rb") as f:
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
            media_type=media_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
            },
        )

    return FileResponse(
        str(audio_file),
        media_type=media_type,
        headers={"Accept-Ranges": "bytes"},
    )


class YouTubeImportRequest(BaseModel):
    url: str


@router.post("/music/youtube")
async def import_youtube_music(req: YouTubeImportRequest):
    """Download audio from a YouTube URL and save as MP3."""
    from services.youtube_service import YouTubeService

    url = req.url.strip()
    if not YouTubeService.is_valid_url(url):
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")

    try:
        # Get metadata first
        meta = await YouTubeService.validate_and_get_metadata(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    file_id = uuid.uuid4().hex[:12]
    mp3_path = MUSIC_UPLOAD_DIR / f"{file_id}.mp3"
    tmp_video = MUSIC_UPLOAD_DIR / f"{file_id}_tmp.mp4"

    try:
        # Download audio-only stream
        def _download_audio():
            from pytubefix import YouTube

            yt = YouTube(url)
            audio_stream = (
                yt.streams
                .filter(only_audio=True)
                .order_by("abr")
                .desc()
                .first()
            )
            if not audio_stream:
                raise ValueError("No audio stream found")

            audio_stream.download(
                output_path=str(MUSIC_UPLOAD_DIR),
                filename=f"{file_id}_tmp.mp4",
            )

        await asyncio.to_thread(_download_audio)

        # Convert to MP3 with FFmpeg
        result = await asyncio.to_thread(
            subprocess.run,
            [
                get_ffmpeg_path(), "-y",
                "-i", str(tmp_video),
                "-vn",
                "-c:a", "libmp3lame",
                "-b:a", "192k",
                str(mp3_path),
            ],
            capture_output=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg conversion failed: {result.stderr.decode()[:200]}")

        # Get duration
        duration = 0
        try:
            duration = FFmpegService.get_video_duration(str(mp3_path))
        except Exception:
            duration = meta.duration_seconds

        # Save metadata
        track_name = meta.title
        meta_path = MUSIC_UPLOAD_DIR / f"{file_id}.json"
        meta_dict = {
            "id": f"upload:{file_id}",
            "name": track_name,
            "filename": f"{file_id}.mp3",
            "duration": duration,
            "size": mp3_path.stat().st_size,
            "youtube_url": url,
        }
        meta_path.write_text(json.dumps(meta_dict))

        logger.info(f"Imported YouTube audio: {track_name} -> {file_id}.mp3")

        return {
            "id": f"upload:{file_id}",
            "name": track_name,
            "duration": duration,
            "audio": f"/editor/music/stream/{file_id}",
            "source": "upload",
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"YouTube import failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to import audio from YouTube")
    finally:
        # Cleanup temp video file
        if tmp_video.exists():
            tmp_video.unlink()


@router.delete("/music/upload/{file_id}")
async def delete_uploaded_music(file_id: str):
    """Delete an uploaded music file."""
    if not SAFE_ID_PATTERN.match(file_id):
        raise HTTPException(status_code=400, detail="Invalid file ID")
    # Delete audio file and metadata
    for f in MUSIC_UPLOAD_DIR.glob(f"{file_id}.*"):
        f.unlink()
    return {"ok": True}


async def _resolve_music_path(bg_music_id: str) -> Optional[str]:
    """Resolve a music track ID to a local file path.

    Handles both bundled tracks (e.g. "inspiring") and Jamendo tracks
    (e.g. "jamendo:12345"). Jamendo tracks are downloaded and cached.
    """
    if not bg_music_id:
        return None

    # Uploaded track
    if bg_music_id.startswith("upload:"):
        file_id = bg_music_id.split(":", 1)[1]
        if not SAFE_ID_PATTERN.match(file_id):
            return None
        matches = list(MUSIC_UPLOAD_DIR.glob(f"{file_id}.*"))
        for m in matches:
            if m.suffix != ".json":
                return str(m)
        return None

    # Bundled track
    if not bg_music_id.startswith("jamendo:"):
        for t in MUSIC_TRACKS:
            if t["id"] == bg_music_id:
                p = MUSIC_DIR / t["file"]
                if p.exists():
                    return str(p)
        return None

    # Jamendo track — check cache first
    jamendo_id = bg_music_id.split(":", 1)[1]
    if not SAFE_ID_PATTERN.match(jamendo_id):
        return None
    cache_file = MUSIC_CACHE_DIR / f"{jamendo_id}.mp3"

    if cache_file.exists() and cache_file.stat().st_size > 0:
        return str(cache_file)

    # Download from Jamendo
    if not JAMENDO_CLIENT_ID:
        logger.warning("Jamendo API not configured, cannot download track")
        return None

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Get track info to find download URL
        resp = await client.get(
            f"{JAMENDO_API_URL}/tracks/",
            params={
                "client_id": JAMENDO_CLIENT_ID,
                "format": "json",
                "id": jamendo_id,
                "audioformat": "mp32",
            },
        )
        if resp.status_code != 200 or not resp.json().get("results"):
            logger.error(f"Failed to get Jamendo track {jamendo_id}")
            return None

        audio_url = resp.json()["results"][0].get("audio", "")
        if not audio_url:
            return None

        # Download the audio file
        audio_resp = await client.get(audio_url, follow_redirects=True)
        if audio_resp.status_code != 200:
            logger.error(f"Failed to download Jamendo audio for {jamendo_id}")
            return None

        cache_file.write_bytes(audio_resp.content)
        logger.info(f"Cached Jamendo track {jamendo_id} ({len(audio_resp.content)} bytes)")
        return str(cache_file)


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
    bg_music_segments: Optional[list[dict]] = None  # [{music_start, music_end, timeline_start}]


class ExportResponse(BaseModel):
    video: str
    filename: str
    duration: float


@router.post("/highlight/{highlight_id}/export", response_model=ExportResponse)
async def export_editor_clip(highlight_id: str, req: ExportRequest):
    """Export a clip with animated subtitles and aspect ratio crop."""
    with get_session() as session:
        highlight = session.get(SermonHighlight, highlight_id)
        if not highlight:
            raise HTTPException(status_code=404, detail="Highlight not found")

        project_id = highlight.project_id
        h_title = highlight.title or "clip"

        # Get transcript words for the time range
        transcript = session.exec(
            select(Transcript)
            .where(Transcript.project_id == project_id)
            .limit(1)
        ).first()
        if not transcript:
            raise HTTPException(status_code=404, detail="Transcript not found")

        segments = transcript.segments or []

        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        project_dict = project.model_dump()

    words = _filter_words(segments, req.start_time, req.end_time)
    clip_service = ClipService()

    # Resolve background music path (supports bundled + Jamendo tracks)
    bg_music_path = await _resolve_music_path(req.bg_music) if req.bg_music else None

    async with resolve_video(project_dict) as video_path:
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
            req.bg_music_segments,
        )

    video_b64 = base64.b64encode(clip_bytes).decode("utf-8")
    duration = req.end_time - req.start_time
    safe_title = h_title.replace(" ", "_")[:30]
    filename = f"{safe_title}_{req.aspect_ratio.replace(':', 'x')}.mp4"

    return ExportResponse(
        video=f"data:video/mp4;base64,{video_b64}",
        filename=filename,
        duration=duration,
    )


@router.get("/project/{project_id}/video-stream")
async def video_stream(project_id: str, request: Request):
    """Stream video with Range support for HTML5 video seeking."""
    with get_session() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        project_dict = project.model_dump()

    # For upload projects, serve local file or redirect
    if project_dict.get("source_type") != "youtube":
        video_url = project_dict.get("video_url")
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
        youtube_url = project_dict.get("youtube_url")
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
