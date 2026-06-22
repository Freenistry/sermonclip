import os
from dataclasses import dataclass
from typing import Optional

# MLX Whisper import - only works on Apple Silicon
try:
    import mlx_whisper
    MLX_AVAILABLE = True
except ImportError:
    MLX_AVAILABLE = False


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


@dataclass
class Transcript:
    full_text: str
    segments: list[TranscriptSegment]


class WhisperMLXService:
    """Service for audio transcription using Whisper MLX on Apple Silicon."""

    def __init__(self, model_name: Optional[str] = None):
        if not MLX_AVAILABLE:
            raise RuntimeError("MLX Whisper is not available. Requires Apple Silicon.")

        self.model_name = model_name or os.getenv(
            "WHISPER_MODEL",
            "mlx-community/whisper-large-v3-turbo"
        )

    def transcribe(self, audio_path: str) -> Transcript:
        """
        Transcribe audio file to text with timestamps.

        Args:
            audio_path: Path to audio file (WAV recommended)

        Returns:
            Transcript with full text and timestamped segments
        """
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        # Run transcription
        result = mlx_whisper.transcribe(
            audio_path,
            path_or_hf_repo=self.model_name,
            verbose=False,
        )

        # Parse segments
        segments = []
        for segment in result.get("segments", []):
            segments.append(TranscriptSegment(
                start=segment["start"],
                end=segment["end"],
                text=segment["text"].strip(),
            ))

        # Build full text
        full_text = result.get("text", "").strip()
        if not full_text and segments:
            full_text = " ".join(s.text for s in segments)

        return Transcript(
            full_text=full_text,
            segments=segments,
        )

    @staticmethod
    def is_available() -> bool:
        """Check if MLX Whisper is available."""
        return MLX_AVAILABLE
