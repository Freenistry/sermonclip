import json
import logging
import os
import re
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


@dataclass
class Highlight:
    title: str
    transcript_excerpt: str
    quote_text: str
    start_time: float
    end_time: float
    duration_tier: str  # 'short', 'medium', 'long'


class HighlightService:
    """Extract sermon highlights (complete thought arcs) using Ollama."""

    OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

    def extract_highlights(
        self,
        segments: list[dict],
        quotes: list[dict],
    ) -> list[Highlight]:
        """
        Extract sermon highlights at multiple duration tiers.

        Args:
            segments: Transcript segments [{start, end, text}, ...]
            quotes: Extracted quotes [{text, start_time, end_time}, ...]

        Returns:
            List of Highlight objects
        """
        prompt = self._build_prompt(segments, quotes)

        try:
            response = httpx.post(
                f"{self.OLLAMA_HOST}/api/generate",
                json={
                    "model": self.OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3},
                },
                timeout=300.0,
            )

            if response.status_code != 200:
                logger.error(f"Ollama API error: {response.status_code}")
                return []

            result = response.json()
            raw_response = result.get("response", "")
            return self._parse_highlights(raw_response, segments)

        except httpx.TimeoutException:
            logger.error("Ollama timeout during highlight extraction")
            return []
        except Exception as e:
            logger.error(f"Highlight extraction failed: {e}")
            return []

    def _format_time(self, seconds: float) -> str:
        mins = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{mins}:{secs:02d}"

    def _build_prompt(self, segments: list[dict], quotes: list[dict]) -> str:
        transcript_lines = []
        for seg in segments:
            time_label = self._format_time(seg["start"])
            transcript_lines.append(f"[{time_label}] {seg['text']}")

        transcript_text = "\n".join(transcript_lines)

        quotes_text = "\n".join(
            f"- \"{q['text']}\" (at {self._format_time(q['start_time'])})"
            for q in quotes
        )

        return f"""You are an expert sermon content editor. Analyze this sermon transcript and identify the most impactful, complete thought arcs that would make great social media video clips.

Find highlights at THREE duration tiers:
- SHORT (20-40 seconds): A single powerful thought — setup, point, and landing
- MEDIUM (45-75 seconds): A deeper arc — builds through 2-3 connected ideas
- LONG (75-100 seconds): A full sermon moment — context, build-up, climax, conclusion

Rules:
1. Each highlight MUST be a COMPLETE thought — it should make sense on its own
2. Duration is flexible — completeness matters more than hitting exact times
3. Include setup/context before the key point, not just the punchline
4. Find as many quality highlights as the content supports (don't force it)
5. The "quote_text" should be the single most impactful sentence — the punchline
6. Highlights should not overlap with each other

Previously extracted key quotes for reference:
{quotes_text}

Transcript with timestamps:
{transcript_text}

Respond with ONLY a JSON array. No other text before or after:
[
  {{
    "title": "Short descriptive title",
    "transcript_excerpt": "The full text of everything said in this highlight...",
    "quote_text": "The single most impactful sentence",
    "start_time": 120.5,
    "end_time": 155.0,
    "duration_tier": "short"
  }}
]"""

    def _parse_highlights(
        self, raw_response: str, segments: list[dict]
    ) -> list[Highlight]:
        """Parse highlights from LLM JSON response."""
        json_match = re.search(r'\[[\s\S]*\]', raw_response)
        if not json_match:
            logger.warning(f"Could not find JSON array in response: {raw_response[:200]}")
            return []

        try:
            data = json.loads(json_match.group())
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse JSON: {e}")
            return []

        highlights = []
        for item in data:
            try:
                start_time = float(item["start_time"])
                end_time = float(item["end_time"])
                duration = end_time - start_time
                tier = item.get("duration_tier", "short")

                # Validate duration is reasonable for tier
                if tier == "short" and not (15 <= duration <= 50):
                    logger.warning(f"Skipping short highlight with duration {duration:.0f}s")
                    continue
                if tier == "medium" and not (40 <= duration <= 90):
                    logger.warning(f"Skipping medium highlight with duration {duration:.0f}s")
                    continue
                if tier == "long" and not (70 <= duration <= 120):
                    logger.warning(f"Skipping long highlight with duration {duration:.0f}s")
                    continue

                # Snap start/end to nearest segment boundaries
                start_time = self._snap_to_segment(start_time, segments, snap="start")
                end_time = self._snap_to_segment(end_time, segments, snap="end")

                highlights.append(Highlight(
                    title=item.get("title", "Untitled"),
                    transcript_excerpt=item.get("transcript_excerpt", ""),
                    quote_text=item.get("quote_text", ""),
                    start_time=start_time,
                    end_time=end_time,
                    duration_tier=tier,
                ))
            except (KeyError, ValueError) as e:
                logger.warning(f"Skipping invalid highlight: {e}")
                continue

        return highlights

    def _snap_to_segment(
        self, time: float, segments: list[dict], snap: str = "start"
    ) -> float:
        """Snap a timestamp to the nearest segment boundary."""
        if not segments:
            return time

        best = time
        best_dist = float("inf")

        for seg in segments:
            boundary = seg["start"] if snap == "start" else seg["end"]
            dist = abs(boundary - time)
            if dist < best_dist:
                best_dist = dist
                best = boundary

        return best
