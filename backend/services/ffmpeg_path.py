"""Resolve FFmpeg/FFprobe binary paths -- bundled or system PATH."""
import os
import sys
import shutil


def _bundled_dir():
    """Get directory where bundled binaries would live."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return None


def get_ffmpeg_path():
    """Get the path to the ffmpeg binary."""
    bundled = _bundled_dir()
    if bundled:
        candidate = os.path.join(bundled, "ffmpeg")
        if os.path.isfile(candidate):
            return candidate

    ffmpeg_dir = os.environ.get("FFMPEG_DIR")
    if ffmpeg_dir:
        candidate = os.path.join(ffmpeg_dir, "ffmpeg")
        if os.path.isfile(candidate):
            return candidate

    system = shutil.which("ffmpeg")
    if system:
        return system

    return "ffmpeg"


def get_ffprobe_path():
    """Get the path to the ffprobe binary."""
    bundled = _bundled_dir()
    if bundled:
        candidate = os.path.join(bundled, "ffprobe")
        if os.path.isfile(candidate):
            return candidate

    ffmpeg_dir = os.environ.get("FFMPEG_DIR")
    if ffmpeg_dir:
        candidate = os.path.join(ffmpeg_dir, "ffprobe")
        if os.path.isfile(candidate):
            return candidate

    system = shutil.which("ffprobe")
    if system:
        return system

    return "ffprobe"


def is_ffmpeg_available():
    """Check if ffmpeg is available."""
    path = get_ffmpeg_path()
    if path == "ffmpeg":
        return shutil.which("ffmpeg") is not None
    return os.path.isfile(path)
