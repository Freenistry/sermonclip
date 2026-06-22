import os
import httpx
from dataclasses import dataclass
from typing import Optional

from services.whisper_mlx_service import Transcript, TranscriptSegment


@dataclass
class Quote:
    text: str
    start_time: float
    end_time: float
    context: str


class OllamaService:
    """Service for quote extraction using Ollama local LLM."""

    def __init__(self, model_name: Optional[str] = None, host: Optional[str] = None):
        self.model_name = model_name or os.getenv("OLLAMA_MODEL", "llama3.1:8b")
        self.host = host or os.getenv("OLLAMA_HOST", "http://localhost:11434")

    def is_available(self) -> bool:
        """Check if Ollama is running and accessible."""
        try:
            response = httpx.get(f"{self.host}/api/tags", timeout=5.0)
            return response.status_code == 200
        except Exception:
            return False

    def extract_quotes(self, transcript: Transcript) -> list[Quote]:
        """
        Extract inspirational quotes from a sermon transcript.

        Args:
            transcript: Transcript with full text and timestamped segments

        Returns:
            List of Quote objects with text and timestamps
        """
        # Create prompt for quote extraction
        prompt = self._build_extraction_prompt(transcript.full_text)

        # Call Ollama API
        response = httpx.post(
            f"{self.host}/api/generate",
            json={
                "model": self.model_name,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.3,  # Lower temp for more focused extraction
                }
            },
            timeout=120.0,  # LLM calls can take time
        )

        if response.status_code != 200:
            raise RuntimeError(f"Ollama API error: {response.text}")

        result = response.json()
        raw_quotes = result.get("response", "")

        # Parse quotes from LLM response
        quotes = self._parse_quotes(raw_quotes, transcript.segments)

        return quotes

    def _build_extraction_prompt(self, text: str) -> str:
        """Build the prompt for quote extraction."""
        return f"""You are an expert at identifying powerful, shareable quotes from sermon transcripts.

Analyze the following sermon transcript and extract 5-10 of the most inspirational, thought-provoking quotes that would work well as social media content.

For each quote:
1. It should be a complete thought (1-3 sentences)
2. It should be inspiring, encouraging, or thought-provoking
3. It should make sense without additional context
4. It should be suitable for Instagram/Facebook/TikTok

Format your response as a numbered list with ONLY the quotes, one per line:
1. "Quote text here"
2. "Another quote here"

Transcript:
{text}

Quotes:"""

    def _parse_quotes(self, raw_response: str, segments: list[TranscriptSegment]) -> list[Quote]:
        """Parse quotes from LLM response and match to timestamps."""
        quotes = []
        lines = raw_response.strip().split("\n")

        for line in lines:
            # Extract quote text (handle numbered format like "1. "quote"")
            line = line.strip()
            if not line:
                continue

            # Remove numbering
            if line[0].isdigit():
                line = line.split(".", 1)[-1].strip()

            # Remove surrounding quotes
            quote_text = line.strip('"').strip("'").strip()

            if not quote_text or len(quote_text) < 20:
                continue

            # Find matching segment for timestamps
            start_time, end_time, context = self._find_quote_timestamps(
                quote_text, segments
            )

            quotes.append(Quote(
                text=quote_text,
                start_time=start_time,
                end_time=end_time,
                context=context,
            ))

        return quotes

    def _find_quote_timestamps(
        self, quote_text: str, segments: list[TranscriptSegment]
    ) -> tuple[float, float, str]:
        """Find the timestamps for a quote by matching against segments."""
        quote_lower = quote_text.lower()
        quote_words = set(quote_lower.split())

        best_match_idx = 0
        best_match_score = 0

        # Find the segment with the best word overlap
        for i, segment in enumerate(segments):
            segment_words = set(segment.text.lower().split())
            overlap = len(quote_words & segment_words)
            if overlap > best_match_score:
                best_match_score = overlap
                best_match_idx = i

        if best_match_score == 0:
            # No match found, return zeros
            return 0.0, 0.0, ""

        # Get context from surrounding segments
        start_idx = max(0, best_match_idx - 1)
        end_idx = min(len(segments) - 1, best_match_idx + 1)

        start_time = segments[start_idx].start
        end_time = segments[end_idx].end

        # Build context from matched segments
        context = " ".join(
            seg.text for seg in segments[start_idx:end_idx + 1]
        )

        return start_time, end_time, context
