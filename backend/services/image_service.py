import os
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Optional
from PIL import Image, ImageDraw, ImageFont


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

    def _create_fallback_background(self, color: str) -> Image.Image:
        """Create a solid color background."""
        return Image.new("RGB", self.IMAGE_SIZE, color)

    def _resize_and_crop(self, img: Image.Image) -> Image.Image:
        """Resize and center-crop image to square."""
        width, height = img.size
        min_dim = min(width, height)
        left = (width - min_dim) // 2
        top = (height - min_dim) // 2
        right = left + min_dim
        bottom = top + min_dim
        img = img.crop((left, top, right, bottom))
        img = img.resize(self.IMAGE_SIZE, Image.Resampling.LANCZOS)
        return img

    def _apply_overlay(self, img: Image.Image) -> Image.Image:
        """Apply dark gradient overlay for text readability."""
        overlay = Image.new("RGBA", self.IMAGE_SIZE, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        for y in range(self.IMAGE_SIZE[1]):
            alpha = int(80 + (100 * y / self.IMAGE_SIZE[1]))
            draw.line([(0, y), (self.IMAGE_SIZE[0], y)], fill=(0, 0, 0, alpha))
        img = img.convert("RGBA")
        img = Image.alpha_composite(img, overlay)
        return img.convert("RGB")

    def _wrap_text(self, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list:
        """Wrap text to fit within max_width."""
        words = text.split()
        lines = []
        current_line = []
        for word in words:
            test_line = " ".join(current_line + [word])
            bbox = font.getbbox(test_line)
            width = bbox[2] - bbox[0]
            if width <= max_width:
                current_line.append(word)
            else:
                if current_line:
                    lines.append(" ".join(current_line))
                current_line = [word]
        if current_line:
            lines.append(" ".join(current_line))
        return lines

    def _calculate_font_size(self, text: str, max_width: int, max_height: int) -> int:
        """Calculate optimal font size to fit text in bounds."""
        for size in range(60, 28, -2):
            font = ImageFont.truetype(str(self.FONT_PATH), size)
            lines = self._wrap_text(text, font, max_width)
            line_height = size * 1.4
            total_height = len(lines) * line_height
            if total_height <= max_height and len(lines) <= 8:
                return size
        return 30

    def _render_text(self, img: Image.Image, quote_text: str, church_name: str) -> Image.Image:
        """Render quote text and church name on image."""
        draw = ImageDraw.Draw(img)
        padding = 80
        max_width = self.IMAGE_SIZE[0] - (padding * 2)
        max_height = self.IMAGE_SIZE[1] - (padding * 3)

        font_size = self._calculate_font_size(quote_text, max_width, max_height)
        font = ImageFont.truetype(str(self.FONT_PATH), font_size)
        lines = self._wrap_text(quote_text, font, max_width)

        line_height = font_size * 1.4
        text_height = len(lines) * line_height
        start_y = (self.IMAGE_SIZE[1] - text_height) // 2 - 40

        for i, line in enumerate(lines):
            bbox = font.getbbox(line)
            text_width = bbox[2] - bbox[0]
            x = (self.IMAGE_SIZE[0] - text_width) // 2
            y = start_y + (i * line_height)
            draw.text((x + 2, y + 2), line, font=font, fill=(0, 0, 0, 128))
            draw.text((x, y), line, font=font, fill="white")

        church_font = ImageFont.truetype(str(self.FONT_PATH), 24)
        bbox = church_font.getbbox(church_name)
        church_width = bbox[2] - bbox[0]
        church_x = (self.IMAGE_SIZE[0] - church_width) // 2
        church_y = self.IMAGE_SIZE[1] - 60
        draw.text((church_x, church_y), church_name, font=church_font, fill=(255, 255, 255, 200))

        return img

    def generate_quote_image(
        self,
        quote_text: str,
        video_url: str,
        timestamp: float,
        church_name: str,
        fallback_color: str = "#1a1a2e",
    ) -> bytes:
        """Generate a quote image with video frame background."""
        background = self.extract_frame(video_url, timestamp)

        if background is None:
            background = self._create_fallback_background(fallback_color)
        else:
            background = self._resize_and_crop(background)

        img = self._apply_overlay(background)
        img = self._render_text(img, quote_text, church_name)

        buffer = BytesIO()
        img.save(buffer, format="PNG", quality=95)
        buffer.seek(0)
        return buffer.getvalue()
