import re
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
    def generate_waveform_peaks(
        video_path: str,
        start: float,
        end: float,
        num_peaks: int = 200,
    ) -> list[float]:
        """
        Generate normalized waveform peaks for a time range.

        Uses FFmpeg to extract RMS audio levels, then downsamples to num_peaks values.

        Returns:
            List of floats (0.0-1.0) representing amplitude peaks.
        """
        duration = end - start
        # Use astats to get per-frame RMS levels
        # Sample at a higher rate than num_peaks for accuracy
        cmd = [
            "ffmpeg",
            "-ss", str(start),
            "-t", str(duration),
            "-i", video_path,
            "-af", f"aresample=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
            "-f", "null",
            "-",
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode != 0:
                return [0.0] * num_peaks

            # Parse RMS levels from stderr/stdout
            rms_values = []
            for line in result.stdout.splitlines():
                match = re.search(r"lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)", line)
                if match:
                    val = match.group(1)
                    if val == "-inf":
                        rms_values.append(0.0)
                    else:
                        # Convert dB to linear (0.0-1.0 range)
                        db = float(val)
                        # Clamp to reasonable range (-60dB to 0dB)
                        db = max(-60.0, min(0.0, db))
                        linear = 10 ** (db / 20.0)
                        rms_values.append(linear)

            if not rms_values:
                return [0.0] * num_peaks

            # Downsample to num_peaks
            peaks = []
            chunk_size = max(1, len(rms_values) // num_peaks)
            for i in range(num_peaks):
                chunk_start = i * len(rms_values) // num_peaks
                chunk_end = (i + 1) * len(rms_values) // num_peaks
                chunk = rms_values[chunk_start:chunk_end]
                peaks.append(max(chunk) if chunk else 0.0)

            # Normalize to 0.0-1.0
            max_peak = max(peaks) if peaks else 1.0
            if max_peak > 0:
                peaks = [p / max_peak for p in peaks]

            return peaks

        except subprocess.CalledProcessError:
            return [0.0] * num_peaks
        except subprocess.TimeoutExpired:
            return [0.0] * num_peaks

    @staticmethod
    def get_video_dimensions(video_path: str) -> tuple[int, int]:
        """Get video width and height."""
        cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0:s=x",
            video_path,
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            parts = result.stdout.strip().split("x")
            return int(parts[0]), int(parts[1])
        except (subprocess.CalledProcessError, ValueError, IndexError):
            return 1920, 1080  # Default fallback

    @staticmethod
    def generate_thumbnail_sprite(
        video_path: str,
        start: float,
        end: float,
        count: int = 20,
        frame_height: int = 80,
    ) -> bytes:
        """Extract evenly-spaced frames and stitch into a horizontal sprite sheet JPEG."""
        duration = end - start
        if duration <= 0:
            raise ValueError("Invalid time range")
        if count < 1:
            raise ValueError("count must be >= 1")
        if frame_height < 1:
            raise ValueError("frame_height must be >= 1")

        fps = count / duration

        with tempfile.TemporaryDirectory() as tmp_dir:
            sprite_path = os.path.join(tmp_dir, "sprite.jpg")
            cmd = [
                "ffmpeg",
                "-ss", str(start),
                "-t", str(duration),
                "-i", video_path,
                "-vf", f"fps={fps},scale=-2:{frame_height},tile={count}x1",
                "-frames:v", "1",
                "-q:v", "5",
                "-y",
                sprite_path,
            ]

            try:
                result = subprocess.run(cmd, capture_output=True, timeout=60)
            except subprocess.TimeoutExpired:
                raise RuntimeError("Thumbnail generation timed out")

            if result.returncode != 0:
                stderr = result.stderr.decode()
                # ffmpeg dumps config/version info before the actual error — grab last few lines
                error_lines = [l for l in stderr.strip().splitlines() if l.strip()]
                error_msg = "\n".join(error_lines[-5:]) if error_lines else stderr[:500]
                raise RuntimeError(f"Thumbnail generation failed: {error_msg}")

            if not os.path.exists(sprite_path):
                raise RuntimeError("No sprite sheet generated")

            return Path(sprite_path).read_bytes()

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
