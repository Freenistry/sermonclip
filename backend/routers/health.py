import asyncio
import os
import platform
import shutil
import subprocess
import tempfile
import logging

from fastapi import APIRouter, HTTPException

from services.ffmpeg_path import is_ffmpeg_available
from database import get_data_dir

logger = logging.getLogger(__name__)

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

    from services.whisper_mlx_service import is_mlx_whisper_installed
    whisper_available = is_mlx_whisper_installed()

    return {
        "ffmpeg": ffmpeg_available,
        "ollama": ollama_available,
        "whisper": whisper_available,
    }


@router.get("/debug/ssl")
async def debug_ssl():
    """Debug SSL certificate configuration."""
    import ssl
    info = {
        "frozen": getattr(__import__("sys"), "frozen", False),
        "ssl_cert_file_env": os.environ.get("SSL_CERT_FILE", "NOT SET"),
    }
    try:
        import certifi
        ca_path = certifi.where()
        info["certifi_path"] = ca_path
        info["certifi_exists"] = os.path.exists(ca_path)
        if os.path.exists(ca_path):
            info["certifi_size"] = os.path.getsize(ca_path)
    except ImportError:
        info["certifi"] = "NOT INSTALLED"

    # Test actual HTTPS connection
    import urllib.request
    try:
        urllib.request.urlopen("https://www.youtube.com", timeout=5)
        info["https_test"] = "OK"
    except Exception as e:
        info["https_test"] = str(e)

    info["_create_default_https_context"] = str(ssl._create_default_https_context)
    info["create_default_context"] = str(ssl.create_default_context)

    return info


@router.get("/install/ffmpeg")
async def install_ffmpeg():
    """Auto-install FFmpeg."""
    if is_ffmpeg_available():
        return {"success": True, "message": "FFmpeg is already installed"}

    system = platform.system()

    try:
        if system == "Darwin":
            brew_path = shutil.which("brew")
            if brew_path:
                proc = await asyncio.to_thread(
                    subprocess.run,
                    [brew_path, "install", "ffmpeg"],
                    capture_output=True, text=True, timeout=300,
                )
                if proc.returncode == 0:
                    return {"success": True, "message": "FFmpeg installed via Homebrew"}

            # Download static binary
            data_dir = get_data_dir()
            bin_dir = os.path.join(data_dir, "bin")
            os.makedirs(bin_dir, exist_ok=True)

            ffmpeg_url = "https://evermeet.cx/ffmpeg/get/zip"
            ffprobe_url = "https://evermeet.cx/ffmpeg/get/ffprobe/zip"

            import httpx
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0), follow_redirects=True) as client:
                for url, name in [(ffmpeg_url, "ffmpeg"), (ffprobe_url, "ffprobe")]:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        raise RuntimeError(f"Failed to download {name}: HTTP {resp.status_code}")

                    zip_path = os.path.join(tempfile.gettempdir(), f"{name}.zip")
                    with open(zip_path, "wb") as f:
                        f.write(resp.content)

                    import zipfile
                    with zipfile.ZipFile(zip_path) as zf:
                        zf.extractall(bin_dir)
                    os.remove(zip_path)

                    bin_path = os.path.join(bin_dir, name)
                    if os.path.exists(bin_path):
                        os.chmod(bin_path, 0o755)

            os.environ["FFMPEG_DIR"] = bin_dir

            if is_ffmpeg_available():
                return {"success": True, "message": "FFmpeg downloaded and installed"}
            else:
                raise RuntimeError("FFmpeg binary downloaded but not detected")

        elif system == "Linux":
            proc = await asyncio.to_thread(
                subprocess.run,
                ["sudo", "apt-get", "install", "-y", "ffmpeg"],
                capture_output=True, text=True, timeout=120,
            )
            if proc.returncode == 0:
                return {"success": True, "message": "FFmpeg installed via apt"}
            raise RuntimeError(proc.stderr)

        elif system == "Windows":
            raise HTTPException(400, "Auto-install not yet supported on Windows.")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"FFmpeg install failed: {e}")
        raise HTTPException(500, f"Installation failed: {str(e)}")


@router.get("/install/ollama")
async def install_ollama():
    """Auto-install Ollama."""
    # Check if already running
    try:
        import httpx
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get("http://localhost:11434/api/tags")
            if resp.status_code == 200:
                return {"success": True, "message": "Ollama is already running"}
    except Exception:
        pass

    system = platform.system()

    try:
        if system == "Darwin":
            ollama_app = "/Applications/Ollama.app"
            ollama_cli = shutil.which("ollama")

            if os.path.exists(ollama_app) or ollama_cli:
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
                await _wait_for_ollama()
                return {"success": True, "message": "Ollama started"}

            # Download Ollama macOS app
            import httpx
            zip_url = "https://ollama.com/download/Ollama-darwin.zip"
            zip_path = os.path.join(tempfile.gettempdir(), "Ollama.zip")

            async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0), follow_redirects=True) as client:
                resp = await client.get(zip_url)
                if resp.status_code != 200:
                    raise RuntimeError(f"Failed to download Ollama: HTTP {resp.status_code}")
                with open(zip_path, "wb") as f:
                    f.write(resp.content)

            # Unzip to /Applications
            await asyncio.to_thread(
                subprocess.run,
                ["unzip", "-o", zip_path, "-d", "/Applications/"],
                capture_output=True, timeout=60,
            )
            os.remove(zip_path)

            # Launch Ollama
            if os.path.exists(ollama_app):
                await asyncio.to_thread(
                    subprocess.run, ["open", ollama_app],
                    capture_output=True, timeout=10,
                )
                await _wait_for_ollama()
                return {"success": True, "message": "Ollama installed and started"}
            else:
                raise RuntimeError("Ollama app not found after extraction")

        elif system == "Linux":
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
                await _wait_for_ollama()
                return {"success": True, "message": "Ollama installed and started"}
            raise RuntimeError(proc.stderr)

        elif system == "Windows":
            raise HTTPException(400, "Auto-install not yet supported on Windows.")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Ollama install failed: {e}")
        raise HTTPException(500, f"Installation failed: {str(e)}")


@router.get("/install/whisper")
async def install_whisper():
    """Auto-install Whisper MLX via pip3."""
    from services.whisper_mlx_service import is_mlx_whisper_installed

    if is_mlx_whisper_installed():
        return {"success": True, "message": "Whisper MLX is already installed"}

    pip3 = shutil.which("pip3")
    if not pip3:
        raise HTTPException(400, "pip3 not found. Please install Python 3 first.")

    try:
        proc = await asyncio.to_thread(
            subprocess.run,
            [pip3, "install", "mlx-whisper"],
            capture_output=True, text=True, timeout=600,
        )
        if proc.returncode == 0:
            return {"success": True, "message": "Whisper MLX installed successfully"}
        raise RuntimeError(proc.stderr)
    except Exception as e:
        logger.error(f"Whisper install failed: {e}")
        raise HTTPException(500, f"Installation failed: {str(e)}")


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
