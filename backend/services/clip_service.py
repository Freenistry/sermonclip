import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class ClipService:
    """Service for generating quote video clips."""

    FONT_PATH = Path(__file__).parent.parent / "assets" / "fonts" / "Montserrat-Bold.ttf"

    def _validate_url(self, video_url: str) -> bool:
        """Validate video URL is HTTP/HTTPS."""
        if not video_url or not isinstance(video_url, str):
            logger.warning("Invalid video URL: not a string or empty")
            return False
        video_url = video_url.strip()
        is_valid = video_url.startswith(('http://', 'https://'))
        if not is_valid:
            logger.warning(f"Invalid video URL: does not start with http:// or https://")
        return is_valid

    def _escape_text_for_ffmpeg(self, text: str) -> str:
        """Escape special characters for FFmpeg drawtext filter."""
        # Escape single quotes, colons, backslashes, and semicolons
        text = text.replace("\\", "\\\\")
        text = text.replace("'", "'\\''")
        text = text.replace(":", "\\:")
        text = text.replace(";", "\\;")
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

        logger.info(f"Starting clip generation: start_time={start_time}s, end_time={end_time}s, duration={duration}s")

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
                error_msg = result.stderr.decode("utf-8", errors="replace")

                # If drawtext filter not available, retry without captions
                if "No such filter: 'drawtext'" in error_msg and drawtext_filter:
                    logger.warning("drawtext filter not available, retrying without captions")
                    cmd_no_captions = [
                        "ffmpeg",
                        "-ss", str(start_time),
                        "-i", video_url,
                        "-t", str(duration),
                        "-c:v", "libx264",
                        "-preset", "fast",
                        "-crf", "23",
                        "-c:a", "aac",
                        "-b:a", "128k",
                        "-movflags", "+faststart",
                        "-y",
                        tmp_path,
                    ]
                    result = subprocess.run(
                        cmd_no_captions,
                        capture_output=True,
                        timeout=300,
                    )
                    if result.returncode == 0:
                        logger.info("Clip generated without captions (drawtext unavailable)")
                    else:
                        error_msg = result.stderr.decode("utf-8", errors="replace")
                        truncated_msg = error_msg[:500] + ("... (truncated)" if len(error_msg) > 500 else "")
                        logger.error(f"FFmpeg failed with return code {result.returncode}: {error_msg}")
                        raise RuntimeError(f"FFmpeg failed: {truncated_msg}")
                else:
                    truncated_msg = error_msg[:500] + ("... (truncated)" if len(error_msg) > 500 else "")
                    logger.error(f"FFmpeg failed with return code {result.returncode}: {error_msg}")
                    raise RuntimeError(f"FFmpeg failed: {truncated_msg}")

            if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
                raise RuntimeError("FFmpeg produced empty output")

            with open(tmp_path, "rb") as f:
                clip_data = f.read()
                file_size = len(clip_data)
                logger.info(f"Clip generation successful: {file_size} bytes")
                return clip_data

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
