from fastapi import APIRouter

from services.ffmpeg_path import is_ffmpeg_available

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/dependencies")
async def check_dependencies():
    """Check which system dependencies are available."""
    ffmpeg_available = is_ffmpeg_available()

    ollama_available = False
    try:
        import httpx
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get("http://localhost:11434/api/tags")
            ollama_available = resp.status_code == 200
    except Exception:
        pass

    whisper_available = False
    try:
        import mlx_whisper  # noqa: F401
        whisper_available = True
    except ImportError:
        pass

    return {
        "ffmpeg": ffmpeg_available,
        "ollama": ollama_available,
        "whisper": whisper_available,
    }
