"""Resolve FFmpeg/FFprobe binary paths -- bundled or system PATH."""
import os
import sys
import shutil


def _bundled_dir():
    """Get directory where bundled binaries would live (PyInstaller _MEIPASS or exe dir)."""
    if getattr(sys, "frozen", False):
        # PyInstaller onefile: binaries are extracted to _MEIPASS temp dir
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return meipass
        return os.path.dirname(sys.executable)
    return None


def _data_bin_dir():
    """Get the bin/ directory inside the app data dir (where auto-install downloads to)."""
    try:
        from database import get_data_dir
        data_dir = get_data_dir()
        if data_dir:
            return os.path.join(data_dir, "bin")
    except Exception:
        pass
    return None


def _find_binary(name):
    """Search for a binary in bundled dir, FFMPEG_DIR, data dir, then system PATH."""
    bundled = _bundled_dir()
    if bundled:
        candidate = os.path.join(bundled, name)
        if os.path.isfile(candidate):
            return candidate

    ffmpeg_dir = os.environ.get("FFMPEG_DIR")
    if ffmpeg_dir:
        candidate = os.path.join(ffmpeg_dir, name)
        if os.path.isfile(candidate):
            return candidate

    data_bin = _data_bin_dir()
    if data_bin:
        candidate = os.path.join(data_bin, name)
        if os.path.isfile(candidate):
            return candidate

    system = shutil.which(name)
    if system:
        return system

    return name


def get_ffmpeg_path():
    """Get the path to the ffmpeg binary."""
    return _find_binary("ffmpeg")


def get_ffprobe_path():
    """Get the path to the ffprobe binary."""
    return _find_binary("ffprobe")


def is_ffmpeg_available():
    """Check if ffmpeg is available."""
    path = get_ffmpeg_path()
    if path == "ffmpeg":
        return shutil.which("ffmpeg") is not None
    return os.path.isfile(path)
