import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional


class ClipService:
    """Service for generating quote video clips."""

    FONT_PATH = Path(__file__).parent.parent / "assets" / "fonts" / "Montserrat-Bold.ttf"

    def _validate_url(self, video_url: str) -> bool:
        """Validate video URL is HTTP/HTTPS."""
        if not video_url or not isinstance(video_url, str):
            return False
        video_url = video_url.strip()
        return video_url.startswith(('http://', 'https://'))

    def _escape_text_for_ffmpeg(self, text: str) -> str:
        """Escape special characters for FFmpeg drawtext filter."""
        # Escape single quotes, colons, and backslashes
        text = text.replace("\\", "\\\\")
        text = text.replace("'", "'\\''")
        text = text.replace(":", "\\:")
        return text

    def _build_drawtext_filter(self, quote_text: str) -> Optional[str]:
        """Build FFmpeg drawtext filter for captions."""
        if not self.FONT_PATH.exists():
            return None

        escaped_text = self._escape_text_for_ffmpeg(quote_text)
        font_path = str(self.FONT_PATH).replace(":", "\\:")

        # drawtext filter with styling:
        # - White text with black border
        # - Centered at bottom (10% from bottom)
        # - Font size 48, Montserrat Bold
        filter_str = (
            f"drawtext=fontfile='{font_path}':"
            f"text='{escaped_text}':"
            f"fontsize=48:"
            f"fontcolor=white:"
            f"borderw=2:"
            f"bordercolor=black:"
            f"x=(w-text_w)/2:"
            f"y=h-th-h*0.1"
        )
        return filter_str

    def generate_quote_clip(
        self,
        video_url: str,
        start_time: float,
        end_time: float,
        quote_text: str,
    ) -> bytes:
        """
        Generate an MP4 clip with burned-in captions.

        Args:
            video_url: URL to the source video
            start_time: Start time in seconds
            end_time: End time in seconds
            quote_text: Quote text to burn in as captions

        Returns:
            MP4 video as bytes

        Raises:
            ValueError: If video URL is invalid
            RuntimeError: If FFmpeg fails
        """
        if not self._validate_url(video_url):
            raise ValueError("Invalid video URL")

        duration = end_time - start_time
        if duration <= 0:
            raise ValueError("Invalid time range")

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp_path = tmp.name

            # Build FFmpeg command
            cmd = [
                "ffmpeg",
                "-ss", str(start_time),
                "-i", video_url,
                "-t", str(duration),
            ]

            # Add drawtext filter if font available
            drawtext_filter = self._build_drawtext_filter(quote_text)
            if drawtext_filter:
                cmd.extend(["-vf", drawtext_filter])

            # Output encoding options
            cmd.extend([
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                "-y",
                tmp_path,
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=300,  # 5 minute timeout for longer clips
            )

            if result.returncode != 0:
                error_msg = result.stderr.decode("utf-8", errors="ignore")
                raise RuntimeError(f"FFmpeg failed: {error_msg[:500]}")

            if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
                raise RuntimeError("FFmpeg produced empty output")

            with open(tmp_path, "rb") as f:
                return f.read()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
