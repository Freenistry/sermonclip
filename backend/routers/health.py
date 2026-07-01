import asyncio
import json
import os
import platform
import shutil
import subprocess
import tempfile
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from services.ffmpeg_path import is_ffmpeg_available
from database import get_data_dir

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/health", tags=["health"])


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


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

    from services.whisper_mlx_service import is_mlx_whisper_installed
    whisper_available = is_mlx_whisper_installed()

    return {
        "ffmpeg": ffmpeg_available,
        "ollama": ollama_available,
        "whisper": whisper_available,
    }


@router.post("/install/ffmpeg")
async def install_ffmpeg():
    """Auto-install FFmpeg with SSE progress streaming."""
    async def stream():
        if is_ffmpeg_available():
            yield _sse("log", {"message": "FFmpeg is already installed"})
            yield _sse("done", {"success": True, "message": "FFmpeg is already installed"})
            return

        system = platform.system()
        machine = platform.machine()

        try:
            if system == "Darwin":
                brew_path = shutil.which("brew")
                if brew_path:
                    yield _sse("progress", {"step": "Installing via Homebrew...", "percent": 10})
                    yield _sse("log", {"message": f"Running: brew install ffmpeg"})
                    proc = await asyncio.to_thread(
                        subprocess.run,
                        [brew_path, "install", "ffmpeg"],
                        capture_output=True, text=True, timeout=300,
                    )
                    if proc.stdout:
                        for line in proc.stdout.strip().split("\n")[-5:]:
                            yield _sse("log", {"message": line})
                    if proc.returncode == 0:
                        yield _sse("progress", {"step": "Installed!", "percent": 100})
                        yield _sse("done", {"success": True, "message": "FFmpeg installed via Homebrew"})
                        return
                    yield _sse("log", {"message": f"Homebrew failed, trying direct download..."})

                data_dir = get_data_dir()
                bin_dir = os.path.join(data_dir, "bin")
                os.makedirs(bin_dir, exist_ok=True)

                arch = "arm64" if machine == "arm64" else "x86_64"
                ffmpeg_url = f"https://www.osxexperts.net/ffmpeg{arch}v7.zip"
                ffprobe_url = f"https://www.osxexperts.net/ffprobe{arch}v7.zip"

                import httpx
                async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
                    for i, (url, name) in enumerate([(ffmpeg_url, "ffmpeg"), (ffprobe_url, "ffprobe")]):
                        base_pct = 10 + i * 40
                        yield _sse("progress", {"step": f"Downloading {name}...", "percent": base_pct})
                        yield _sse("log", {"message": f"Downloading {url}"})

                        resp = await client.get(url)
                        if resp.status_code != 200:
                            raise RuntimeError(f"Failed to download {name}: HTTP {resp.status_code}")

                        yield _sse("progress", {"step": f"Extracting {name}...", "percent": base_pct + 20})
                        zip_path = os.path.join(tempfile.gettempdir(), f"{name}.zip")
                        with open(zip_path, "wb") as f:
                            f.write(resp.content)
                        yield _sse("log", {"message": f"Downloaded {len(resp.content) / 1024 / 1024:.1f} MB"})

                        import zipfile
                        with zipfile.ZipFile(zip_path) as zf:
                            zf.extractall(bin_dir)
                        os.remove(zip_path)

                        bin_path = os.path.join(bin_dir, name)
                        if os.path.exists(bin_path):
                            os.chmod(bin_path, 0o755)
                        yield _sse("log", {"message": f"Extracted {name} to {bin_dir}"})

                os.environ["FFMPEG_DIR"] = bin_dir
                yield _sse("progress", {"step": "Verifying...", "percent": 95})

                if is_ffmpeg_available():
                    yield _sse("progress", {"step": "Installed!", "percent": 100})
                    yield _sse("done", {"success": True, "message": "FFmpeg downloaded and installed"})
                else:
                    raise RuntimeError("FFmpeg binary downloaded but not detected")

            elif system == "Linux":
                yield _sse("progress", {"step": "Installing via apt...", "percent": 10})
                proc = await asyncio.to_thread(
                    subprocess.run,
                    ["sudo", "apt-get", "install", "-y", "ffmpeg"],
                    capture_output=True, text=True, timeout=120,
                )
                if proc.returncode == 0:
                    yield _sse("progress", {"step": "Installed!", "percent": 100})
                    yield _sse("done", {"success": True, "message": "FFmpeg installed via apt"})
                    return
                raise RuntimeError(proc.stderr)

            elif system == "Windows":
                yield _sse("error", {"message": "Auto-install not yet supported on Windows."})
                return

        except Exception as e:
            logger.error(f"FFmpeg install failed: {e}")
            yield _sse("log", {"message": str(e)})
            yield _sse("error", {"message": f"Installation failed: {str(e)}"})

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/install/ollama")
async def install_ollama():
    """Auto-install Ollama with SSE progress streaming."""
    async def stream():
        # Check if already running
        try:
            import httpx
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get("http://localhost:11434/api/tags")
                if resp.status_code == 200:
                    yield _sse("log", {"message": "Ollama is already running"})
                    yield _sse("done", {"success": True, "message": "Ollama is already running"})
                    return
        except Exception:
            pass

        system = platform.system()

        try:
            if system == "Darwin":
                ollama_app = "/Applications/Ollama.app"
                ollama_cli = shutil.which("ollama")

                if os.path.exists(ollama_app) or ollama_cli:
                    yield _sse("progress", {"step": "Starting Ollama...", "percent": 50})
                    yield _sse("log", {"message": "Ollama found, starting..."})
                    if os.path.exists(ollama_app):
                        await asyncio.to_thread(
                            subprocess.run, ["open", ollama_app],
                            capture_output=True, timeout=10,
                        )
                    elif ollama_cli:
                        subprocess.Popen(
                            [ollama_cli, "serve"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        )
                    yield _sse("progress", {"step": "Waiting for server...", "percent": 70})
                    await _wait_for_ollama()
                    yield _sse("progress", {"step": "Started!", "percent": 100})
                    yield _sse("done", {"success": True, "message": "Ollama started"})
                    return

                yield _sse("progress", {"step": "Downloading Ollama...", "percent": 10})
                yield _sse("log", {"message": "Downloading Ollama for macOS..."})

                import httpx
                zip_url = "https://ollama.com/download/Ollama-darwin.zip"
                zip_path = os.path.join(tempfile.gettempdir(), "Ollama.zip")

                async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
                    resp = await client.get(zip_url)
                    if resp.status_code != 200:
                        raise RuntimeError(f"Failed to download Ollama: HTTP {resp.status_code}")
                    with open(zip_path, "wb") as f:
                        f.write(resp.content)
                    yield _sse("log", {"message": f"Downloaded {len(resp.content) / 1024 / 1024:.0f} MB"})

                yield _sse("progress", {"step": "Extracting to Applications...", "percent": 60})
                yield _sse("log", {"message": "Extracting to /Applications/"})
                await asyncio.to_thread(
                    subprocess.run,
                    ["unzip", "-o", zip_path, "-d", "/Applications/"],
                    capture_output=True, timeout=60,
                )
                os.remove(zip_path)

                yield _sse("progress", {"step": "Launching Ollama...", "percent": 80})
                if os.path.exists(ollama_app):
                    await asyncio.to_thread(
                        subprocess.run, ["open", ollama_app],
                        capture_output=True, timeout=10,
                    )
                    yield _sse("progress", {"step": "Waiting for server...", "percent": 90})
                    yield _sse("log", {"message": "Waiting for Ollama server to start..."})
                    await _wait_for_ollama()
                    yield _sse("progress", {"step": "Installed!", "percent": 100})
                    yield _sse("done", {"success": True, "message": "Ollama installed and started"})
                else:
                    raise RuntimeError("Ollama app not found after extraction")

            elif system == "Linux":
                yield _sse("progress", {"step": "Installing Ollama...", "percent": 10})
                proc = await asyncio.to_thread(
                    subprocess.run,
                    ["bash", "-c", "curl -fsSL https://ollama.com/install.sh | sh"],
                    capture_output=True, text=True, timeout=300,
                )
                if proc.returncode == 0:
                    subprocess.Popen(
                        ["ollama", "serve"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    )
                    yield _sse("progress", {"step": "Waiting for server...", "percent": 80})
                    await _wait_for_ollama()
                    yield _sse("progress", {"step": "Installed!", "percent": 100})
                    yield _sse("done", {"success": True, "message": "Ollama installed and started"})
                    return
                raise RuntimeError(proc.stderr)

            elif system == "Windows":
                yield _sse("error", {"message": "Auto-install not yet supported on Windows."})
                return

        except Exception as e:
            logger.error(f"Ollama install failed: {e}")
            yield _sse("log", {"message": str(e)})
            yield _sse("error", {"message": f"Installation failed: {str(e)}"})

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/install/whisper")
async def install_whisper():
    """Auto-install Whisper MLX with SSE progress streaming."""
    async def stream():
        from services.whisper_mlx_service import is_mlx_whisper_installed

        if is_mlx_whisper_installed():
            yield _sse("log", {"message": "Whisper MLX is already installed"})
            yield _sse("done", {"success": True, "message": "Whisper MLX is already installed"})
            return

        pip3 = shutil.which("pip3")
        if not pip3:
            yield _sse("error", {"message": "pip3 not found. Please install Python 3 first."})
            return

        try:
            yield _sse("progress", {"step": "Installing mlx-whisper...", "percent": 10})
            yield _sse("log", {"message": f"Running: {pip3} install mlx-whisper"})

            proc = await asyncio.to_thread(
                subprocess.run,
                [pip3, "install", "mlx-whisper"],
                capture_output=True, text=True, timeout=300,
            )

            if proc.stdout:
                for line in proc.stdout.strip().split("\n"):
                    if line.strip():
                        yield _sse("log", {"message": line.strip()})

            if proc.returncode == 0:
                yield _sse("progress", {"step": "Installed!", "percent": 100})
                yield _sse("done", {"success": True, "message": "Whisper MLX installed successfully"})
            else:
                if proc.stderr:
                    for line in proc.stderr.strip().split("\n")[-5:]:
                        yield _sse("log", {"message": line.strip()})
                raise RuntimeError(proc.stderr or "pip install failed")

        except Exception as e:
            logger.error(f"Whisper install failed: {e}")
            yield _sse("log", {"message": str(e)})
            yield _sse("error", {"message": f"Installation failed: {str(e)}"})

    return StreamingResponse(stream(), media_type="text/event-stream")


async def _wait_for_ollama(timeout: int = 30):
    """Wait for Ollama server to become available."""
    import httpx
    for _ in range(timeout):
        try:
            async with httpx.AsyncClient(timeout=1.0) as client:
                resp = await client.get("http://localhost:11434/api/tags")
                if resp.status_code == 200:
                    return
        except Exception:
            pass
        await asyncio.sleep(1)
