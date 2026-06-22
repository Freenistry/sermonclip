import os
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Optional
from PIL import Image


class ImageService:
    """Service for generating quote images."""

    IMAGE_SIZE = (1080, 1080)
    FONT_PATH = Path(__file__).parent.parent / "assets" / "fonts" / "Montserrat-Bold.ttf"

    def extract_frame(self, video_url: str, timestamp: float) -> Optional[Image.Image]:
        """
        Extract a frame from video at the given timestamp.

        Args:
            video_url: URL to the video file
            timestamp: Time in seconds to extract frame

        Returns:
            PIL Image or None if extraction fails
        """
        try:
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                tmp_path = tmp.name

            cmd = [
                "ffmpeg",
                "-ss", str(timestamp),
                "-i", video_url,
                "-frames:v", "1",
                "-q:v", "2",
                "-y",
                tmp_path,
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=30,
            )

            if result.returncode != 0:
                return None

            if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 0:
                img = Image.open(tmp_path)
                img.load()  # Load into memory before deleting file
                os.unlink(tmp_path)
                return img

            return None

        except Exception:
            return None
        finally:
            if 'tmp_path' in locals() and os.path.exists(tmp_path):
                os.unlink(tmp_path)
