import json
import os
import subprocess
import shutil
import sys
import tempfile
from dataclasses import dataclass
from typing import Optional

# MLX Whisper import - only works on Apple Silicon
try:
    import mlx_whisper
    MLX_AVAILABLE = True
except ImportError:
    MLX_AVAILABLE = False


def is_mlx_whisper_installed() -> bool:
    """Check if mlx_whisper is available either via direct import or system pip."""
    if MLX_AVAILABLE:
        return True
    # Check if installed via system pip3
    pip3 = shutil.which("pip3")
    if not pip3:
        return False
    try:
        result = subprocess.run(
            [pip3, "show", "mlx-whisper"],
            capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0
    except Exception:
        return False


@dataclass
class WordTimestamp:
    word: str
    start: float
    end: float


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str
    words: list[WordTimestamp] = None

    def __post_init__(self):
        if self.words is None:
            self.words = []


@dataclass
class Transcript:
    full_text: str
    segments: list[TranscriptSegment]


# Helper script for subprocess-based transcription
_TRANSCRIBE_SCRIPT = '''
import json, sys, os
os.environ.setdefault("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")
import mlx_whisper
result = mlx_whisper.transcribe(
    sys.argv[1],
    path_or_hf_repo=os.environ["WHISPER_MODEL"],
    verbose=False,
    word_timestamps=True,
)
print(json.dumps(result, ensure_ascii=False))
'''


class WhisperMLXService:
    """Service for audio transcription using Whisper MLX on Apple Silicon."""

    def __init__(self, model_name: Optional[str] = None):
        self.model_name = model_name or os.getenv(
            "WHISPER_MODEL",
            "mlx-community/whisper-large-v3-turbo"
        )
        self._use_subprocess = not MLX_AVAILABLE

    def transcribe(self, audio_path: str) -> Transcript:
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        if self._use_subprocess:
            return self._transcribe_subprocess(audio_path)
        return self._transcribe_direct(audio_path)

    def _transcribe_direct(self, audio_path: str) -> Transcript:
        """Transcribe using directly imported mlx_whisper."""
        result = mlx_whisper.transcribe(
            audio_path,
            path_or_hf_repo=self.model_name,
            verbose=False,
            word_timestamps=True,
        )
        return self._parse_result(result)

    def _transcribe_subprocess(self, audio_path: str) -> Transcript:
        """Transcribe via system python3 subprocess (for PyInstaller builds)."""
        python3 = shutil.which("python3")
        if not python3:
            raise RuntimeError("python3 not found. Cannot run Whisper MLX.")

        env = os.environ.copy()
        env["WHISPER_MODEL"] = self.model_name

        script_file = os.path.join(tempfile.gettempdir(), "sermonclip_whisper.py")
        with open(script_file, "w") as f:
            f.write(_TRANSCRIBE_SCRIPT)

        proc = subprocess.run(
            [python3, script_file, audio_path],
            capture_output=True, text=True, env=env,
            timeout=3600,  # 1 hour max for long sermons
        )

        if proc.returncode != 0:
            raise RuntimeError(f"Whisper MLX failed: {proc.stderr}")

        result = json.loads(proc.stdout)
        return self._parse_result(result)

    def _parse_result(self, result: dict) -> Transcript:
        """Parse mlx_whisper result dict into Transcript."""
        segments = []
        for segment in result.get("segments", []):
            words = []
            for w in segment.get("words", []):
                words.append(WordTimestamp(
                    word=w.get("word", "").strip(),
                    start=w.get("start", 0.0),
                    end=w.get("end", 0.0),
                ))
            segments.append(TranscriptSegment(
                start=segment["start"],
                end=segment["end"],
                text=segment["text"].strip(),
                words=words,
            ))

        full_text = result.get("text", "").strip()
        if not full_text and segments:
            full_text = " ".join(s.text for s in segments)

        return Transcript(full_text=full_text, segments=segments)

    @staticmethod
    def is_available() -> bool:
        """Check if MLX Whisper is available (direct import or system install)."""
        return is_mlx_whisper_installed()
