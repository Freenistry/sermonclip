import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional
import httpx
import re

from services.ffmpeg_path import get_ffmpeg_path
from services.subtitle_service import SubtitleService
from services.ffmpeg_service import FFmpegService

logger = logging.getLogger(__name__)


class ClipService:
    """Service for generating quote video clips."""

    FONT_PATH = Path(__file__).parent.parent / "assets" / "fonts" / "Montserrat-Bold.ttf"
    OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
    MIN_CLIP_DURATION = 30.0
    MAX_CLIP_DURATION = 60.0

    def _fallback_boundaries(
        self,
        quote_start: float,
        quote_end: float,
        video_duration: float = float('inf'),
    ) -> tuple[float, float]:
        """
        Expand ±15 seconds to reach ~30 sec minimum.

        Args:
            quote_start: Original quote start time
            quote_end: Original quote end time
            video_duration: Total video duration (to avoid exceeding)

        Returns:
            (start_time, end_time) tuple
        """
        duration = quote_end - quote_start
        if duration >= self.MIN_CLIP_DURATION:
            return quote_start, quote_end

        expand = (self.MIN_CLIP_DURATION - duration) / 2
        start = max(0, quote_start - expand)
        end = min(video_duration, quote_end + expand)

        # Compensate if we hit boundaries
        actual_duration = end - start
        if actual_duration < self.MIN_CLIP_DURATION:
            shortfall = self.MIN_CLIP_DURATION - actual_duration
            # Try to extend the end
            if end < video_duration:
                end = min(video_duration, end + shortfall)
            # If still short, try to extend the start backwards (shouldn't happen if start is 0)
            actual_duration = end - start
            if actual_duration < self.MIN_CLIP_DURATION and start > 0:
                start = max(0, start - (self.MIN_CLIP_DURATION - actual_duration))

        logger.info(f"Fallback boundaries: {start:.1f}s - {end:.1f}s (expanded ±{expand:.1f}s)")
        return start, end

    def _format_time(self, seconds: float) -> str:
        """Format seconds as M:SS for display."""
        mins = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{mins}:{secs:02d}"

    def get_smart_boundaries(
        self,
        quote_text: str,
        quote_start: float,
        quote_end: float,
        segments: list[dict],
    ) -> tuple[float, float]:
        """
        Use Ollama to find optimal 30-60 sec clip boundaries.

        Args:
            quote_text: The quote to build clip around
            quote_start: Original quote start time
            quote_end: Original quote end time
            segments: Transcript segments [{start, end, text}, ...]

        Returns:
            (start_time, end_time) tuple for the expanded clip
        """
        if not segments:
            logger.warning("No segments provided, using fallback")
            return self._fallback_boundaries(quote_start, quote_end)

        # Build context window (±60 seconds around quote)
        context_start = max(0, quote_start - 60)
        context_end = quote_end + 60

        # Filter segments within context window
        context_segments = [
            seg for seg in segments
            if seg["end"] >= context_start and seg["start"] <= context_end
        ]

        if not context_segments:
            logger.warning("No segments in context window, using fallback")
            return self._fallback_boundaries(quote_start, quote_end)

        # Format segments for prompt
        segments_text = "\n".join(
            f"[{self._format_time(seg['start'])}-{self._format_time(seg['end'])}] \"{seg['text']}\""
            for seg in context_segments
        )

        prompt = f"""You are analyzing a sermon transcript to find the optimal video clip boundaries.

The goal: Create a 30-60 second clip that captures a complete thought arc around this quote:
"{quote_text}"

Transcript context (with timestamps):
{segments_text}

Find timestamps that:
1. Start with setup/context that leads into the quote
2. Include the full quote
3. End with conclusion or natural pause
4. Total duration: 30-60 seconds

Respond with ONLY two numbers (start and end in seconds):
START: 45.0
END: 75.0"""

        try:
            response = httpx.post(
                f"{self.OLLAMA_HOST}/api/generate",
                json={
                    "model": self.OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3},
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.warning(f"Ollama API error: {response.status_code}, using fallback")
                return self._fallback_boundaries(quote_start, quote_end)

            result = response.json()
            raw_response = result.get("response", "")

            # Parse START and END from response
            start_match = re.search(r"START:\s*([\d.]+)", raw_response)
            end_match = re.search(r"END:\s*([\d.]+)", raw_response)

            if not start_match or not end_match:
                logger.warning(f"Could not parse boundaries from: {raw_response[:200]}, using fallback")
                return self._fallback_boundaries(quote_start, quote_end)

            smart_start = float(start_match.group(1))
            smart_end = float(end_match.group(1))
            smart_duration = smart_end - smart_start

            # Validate duration is in range
            if smart_duration < self.MIN_CLIP_DURATION or smart_duration > self.MAX_CLIP_DURATION:
                logger.warning(
                    f"Smart duration {smart_duration:.1f}s outside range "
                    f"[{self.MIN_CLIP_DURATION}, {self.MAX_CLIP_DURATION}], using fallback"
                )
                return self._fallback_boundaries(quote_start, quote_end)

            # Ensure boundaries include the original quote
            if smart_start > quote_start or smart_end < quote_end:
                logger.warning("Smart boundaries don't include full quote, using fallback")
                return self._fallback_boundaries(quote_start, quote_end)

            logger.info(f"Smart boundaries: {smart_start:.1f}s - {smart_end:.1f}s ({smart_duration:.1f}s)")
            return smart_start, smart_end

        except httpx.TimeoutException:
            logger.warning("Ollama timeout, using fallback")
            return self._fallback_boundaries(quote_start, quote_end)
        except Exception as e:
            logger.warning(f"Smart boundary detection failed: {e}, using fallback")
            return self._fallback_boundaries(quote_start, quote_end)

    def _validate_url(self, video_url: str) -> bool:
        """Validate video URL is HTTP/HTTPS or a local file path."""
        if not video_url or not isinstance(video_url, str):
            logger.warning("Invalid video URL: not a string or empty")
            return False
        video_url = video_url.strip()
        is_valid = video_url.startswith(('http://', 'https://')) or os.path.isfile(video_url)
        if not is_valid:
            logger.warning(f"Invalid video source: not a URL or existing file")
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
                get_ffmpeg_path(),
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
                        get_ffmpeg_path(),
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

    def generate_merged_clip(
        self,
        video_url: str,
        time_ranges: list[dict],
        quote_text: str,
    ) -> bytes:
        """
        Generate an MP4 clip by concatenating multiple video segments.

        Args:
            video_url: URL or path to the source video
            time_ranges: List of segments [{"start": 90.0, "end": 120.0}, ...]
            quote_text: Quote text for captions

        Returns:
            MP4 video as bytes
        """
        if not self._validate_url(video_url):
            raise ValueError("Invalid video URL")

        if not time_ranges or len(time_ranges) < 2:
            raise ValueError("At least two time ranges required for merged clip")

        logger.info(f"Generating merged clip with {len(time_ranges)} segments")

        segment_paths = []
        concat_path = None
        output_path = None

        try:
            # Extract each segment to a temp file
            for i, tr in enumerate(time_ranges):
                start = tr["start"]
                end = tr["end"]
                duration = end - start
                if duration <= 0:
                    raise ValueError(f"Invalid time range in segment {i}")

                with tempfile.NamedTemporaryFile(
                    suffix=f"_seg{i}.mp4", delete=False
                ) as tmp:
                    seg_path = tmp.name

                cmd = [
                    get_ffmpeg_path(),
                    "-ss", str(start),
                    "-i", video_url,
                    "-t", str(duration),
                    "-c:v", "libx264",
                    "-preset", "fast",
                    "-crf", "23",
                    "-c:a", "aac",
                    "-b:a", "128k",
                    "-y",
                    seg_path,
                ]

                result = subprocess.run(cmd, capture_output=True, timeout=300)
                if result.returncode != 0:
                    error_msg = result.stderr.decode("utf-8", errors="replace")
                    raise RuntimeError(
                        f"FFmpeg segment {i} failed: {error_msg[:500]}"
                    )

                segment_paths.append(seg_path)

            # Create concat file
            with tempfile.NamedTemporaryFile(
                suffix=".txt", mode="w", delete=False
            ) as concat_file:
                concat_path = concat_file.name
                for seg_path in segment_paths:
                    concat_file.write(f"file '{seg_path}'\n")

            # Concatenate segments
            with tempfile.NamedTemporaryFile(
                suffix=".mp4", delete=False
            ) as out_tmp:
                output_path = out_tmp.name

            cmd = [
                get_ffmpeg_path(),
                "-f", "concat",
                "-safe", "0",
                "-i", concat_path,
                "-c", "copy",
                "-movflags", "+faststart",
                "-y",
                output_path,
            ]

            result = subprocess.run(cmd, capture_output=True, timeout=300)
            if result.returncode != 0:
                error_msg = result.stderr.decode("utf-8", errors="replace")
                raise RuntimeError(f"FFmpeg concat failed: {error_msg[:500]}")

            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                raise RuntimeError("FFmpeg produced empty output")

            with open(output_path, "rb") as f:
                clip_data = f.read()
                logger.info(
                    f"Merged clip generated: {len(clip_data)} bytes, "
                    f"{len(time_ranges)} segments"
                )
                return clip_data

        finally:
            for p in segment_paths:
                if os.path.exists(p):
                    os.unlink(p)
            if concat_path and os.path.exists(concat_path):
                os.unlink(concat_path)
            if output_path and os.path.exists(output_path):
                os.unlink(output_path)

    # --- Editor clip methods ---

    ASPECT_RATIOS = {
        "9:16": (1080, 1920),
        "16:9": (1920, 1080),
        "1:1": (1080, 1080),
    }

    def _build_crop_filter(
        self,
        aspect_ratio: str,
        input_width: int,
        input_height: int,
    ) -> str:
        """Build FFmpeg crop filter for target aspect ratio.

        Center-crops the input to the target aspect ratio, then scales to output size.
        """
        out_w, out_h = self.ASPECT_RATIOS.get(aspect_ratio, (1920, 1080))
        target_ratio = out_w / out_h
        input_ratio = input_width / input_height

        if input_ratio > target_ratio:
            # Input is wider - crop width
            crop_h = input_height
            crop_w = int(crop_h * target_ratio)
        else:
            # Input is taller - crop height
            crop_w = input_width
            crop_h = int(crop_w / target_ratio)

        crop_x = (input_width - crop_w) // 2
        crop_y = (input_height - crop_h) // 2

        return f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={out_w}:{out_h}"

    def generate_editor_clip(
        self,
        video_path: str,
        start: float,
        end: float,
        words: list[dict],
        subtitle_style: str,
        aspect_ratio: str,
        font_color: Optional[str] = None,
        font_size: Optional[int] = None,
        font_weight: Optional[str] = None,
        bg_music_path: Optional[str] = None,
        bg_music_volume: float = 0.15,
        bg_music_segments: Optional[list[dict]] = None,
    ) -> bytes:
        """
        Generate a clip with animated subtitles and aspect ratio crop.

        Args:
            video_path: Path or URL to source video
            start: Start time in seconds
            end: End time in seconds
            words: Word-level timestamps [{word, start, end}, ...]
            subtitle_style: Style name (basic, one_word, two_word, elevate, word_color)
            aspect_ratio: Target ratio (9:16, 16:9, 1:1)
            font_color: Hex color for subtitle text
            font_size: Font size in px
            font_weight: "normal" or "bold"

        Returns:
            MP4 video as bytes
        """
        duration = end - start
        if duration <= 0:
            raise ValueError("Invalid time range")

        out_w, out_h = self.ASPECT_RATIOS.get(aspect_ratio, (1920, 1080))

        # Get input dimensions
        input_w, input_h = FFmpegService.get_video_dimensions(video_path)

        # Generate ASS subtitle file
        subtitle_service = SubtitleService()
        ass_content = subtitle_service.generate_ass(
            words, subtitle_style, out_w, out_h, start,
            font_color=font_color, font_size=font_size, font_weight=font_weight,
        )

        tmp_path = None
        ass_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".ass", mode="w", delete=False) as ass_file:
                ass_file.write(ass_content)
                ass_path = ass_file.name

            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp_path = tmp.name

            # Build filter chain: crop → ass overlay
            crop_filter = self._build_crop_filter(aspect_ratio, input_w, input_h)
            # Escape the ass path for FFmpeg filter
            escaped_ass = ass_path.replace("\\", "/").replace(":", "\\:")
            fonts_dir = str(self.FONT_PATH.parent).replace("\\", "/").replace(":", "\\:")
            filter_chain = f"{crop_filter},ass='{escaped_ass}':fontsdir='{fonts_dir}'"

            cmd = [
                get_ffmpeg_path(),
                "-ss", str(start),
                "-i", video_path,
            ]

            # Build segments list — fall back to single full-track segment
            segments = bg_music_segments or []
            if bg_music_path and not segments:
                segments = [{"music_start": 0, "music_end": 0, "timeline_start": start}]

            # Add each music segment as a separate input
            if bg_music_path and segments:
                for seg in segments:
                    ms = seg.get("music_start", 0)
                    me = seg.get("music_end", 0)
                    if ms > 0:
                        cmd.extend(["-ss", str(ms)])
                    if me > ms > 0:
                        cmd.extend(["-t", str(me - ms)])
                    cmd.extend(["-i", bg_music_path])

            cmd.extend([
                "-t", str(duration),
                "-vf", filter_chain,
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
            ])

            if bg_music_path and segments:
                vol = max(0.0, min(1.0, bg_music_volume))
                # Build filter_complex for all music segments
                filter_parts = ["[0:a]volume=1.0[voice]"]
                mix_inputs = ["[voice]"]
                for i, seg in enumerate(segments):
                    input_idx = i + 1  # 0 is video
                    delay_sec = seg.get("timeline_start", start) - start
                    delay_ms = max(0, int(delay_sec * 1000))
                    label = f"m{i}"
                    if delay_ms > 0:
                        filter_parts.append(
                            f"[{input_idx}:a]volume={vol},adelay={delay_ms}|{delay_ms}[{label}]"
                        )
                    else:
                        filter_parts.append(
                            f"[{input_idx}:a]volume={vol}[{label}]"
                        )
                    mix_inputs.append(f"[{label}]")
                n_inputs = len(mix_inputs)
                mix_str = "".join(mix_inputs)
                filter_parts.append(
                    f"{mix_str}amix=inputs={n_inputs}:duration=first:dropout_transition=2[aout]"
                )
                cmd.extend([
                    "-filter_complex",
                    ";".join(filter_parts),
                    "-map", "0:v",
                    "-map", "[aout]",
                ])

            cmd.extend([
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                "-y",
                tmp_path,
            ])

            result = subprocess.run(cmd, capture_output=True, timeout=300)

            if result.returncode != 0:
                error_msg = result.stderr.decode("utf-8", errors="replace")
                logger.error(f"Editor clip FFmpeg failed: {error_msg[:500]}")
                raise RuntimeError(f"FFmpeg failed: {error_msg[:500]}")

            if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
                raise RuntimeError("FFmpeg produced empty output")

            with open(tmp_path, "rb") as f:
                return f.read()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
            if ass_path and os.path.exists(ass_path):
                os.unlink(ass_path)
