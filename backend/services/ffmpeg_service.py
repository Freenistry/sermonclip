import subprocess
import os
import tempfile
from pathlib import Path
from typing import Optional


class FFmpegService:
    """Service for video/audio processing using FFmpeg."""

    @staticmethod
    def extract_audio(video_path: str, output_path: Optional[str] = None) -> str:
        """
        Extract audio from video file.

        Args:
            video_path: Path to input video file
            output_path: Path for output audio file (optional, creates temp file if not provided)

        Returns:
            Path to extracted audio file (WAV format)
        """
        if output_path is None:
            # Create temp file for audio
            fd, output_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

        # FFmpeg command to extract audio as WAV
        cmd = [
            "ffmpeg",
            "-i", video_path,
            "-vn",  # No video
            "-acodec", "pcm_s16le",  # PCM 16-bit little-endian
            "-ar", "16000",  # 16kHz sample rate (optimal for Whisper)
            "-ac", "1",  # Mono
            "-y",  # Overwrite output
            output_path,
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True,
            )
            return output_path
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"FFmpeg error: {e.stderr}")

    @staticmethod
    def get_video_duration(video_path: str) -> float:
        """
        Get duration of video file in seconds.

        Args:
            video_path: Path to video file

        Returns:
            Duration in seconds
        """
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            video_path,
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True,
            )
            return float(result.stdout.strip())
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"FFprobe error: {e.stderr}")
        except ValueError:
            raise RuntimeError("Could not parse video duration")

    @staticmethod
    def is_ffmpeg_available() -> bool:
        """Check if FFmpeg is installed and accessible."""
        try:
            subprocess.run(
                ["ffmpeg", "-version"],
                capture_output=True,
                check=True,
            )
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False
