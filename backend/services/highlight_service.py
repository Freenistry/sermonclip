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
                    "options": {
                        "temperature": 0.3,
                        "num_ctx": 32768,
                        "num_predict": 8192,
                    },
                },
                timeout=600.0,
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
        # Consolidate segments into ~30s chunks to reduce token count
        chunks = []
        current_start = None
        current_texts = []
        for seg in segments:
            if current_start is None:
                current_start = seg["start"]
                current_texts = [seg["text"]]
            elif seg["start"] - current_start > 30:
                chunks.append(f"[{current_start:.0f}s] {' '.join(current_texts)}")
                current_start = seg["start"]
                current_texts = [seg["text"]]
            else:
                current_texts.append(seg["text"])
        if current_texts:
            chunks.append(f"[{current_start:.0f}s] {' '.join(current_texts)}")

        transcript_text = "\n".join(chunks)

        # Calculate total duration from segments
        max_time = max(seg["end"] for seg in segments) if segments else 0

        quotes_text = "\n".join(
            f"- \"{q['text']}\" ({q['start_time']:.0f}s)"
            for q in quotes
        )

        return f"""Find 10+ sermon highlights for social media clips. Each must be a COMPLETE thought that makes sense on its own.

The sermon is {max_time:.0f} seconds long. All timestamps MUST be within 0-{max_time:.0f}.

IMPORTANT: Each clip MUST be at least 30 seconds long. The difference between end_time and start_time must be >= 30.

Duration tiers (aim for 3-4 per tier):
- SHORT (30-45s): One powerful thought with setup and payoff
- MEDIUM (50-80s): 2-3 connected ideas building to a conclusion
- LONG (80-120s): Full sermon moment with context, build-up, and climax

Requirements:
- "title": short descriptive title
- "quote_text": the single most impactful COMPLETE sentence
- "transcript_excerpt": ALL the text spoken during the clip (include full sentences from start_time to end_time)
- "start_time" and "end_time": numbers in SECONDS matching the [Xs] timestamps above
- "duration_tier": "short", "medium", or "long"
- No overlapping highlights. Spread across the entire sermon.
- Never cut mid-sentence.

Key quotes already extracted:
{quotes_text}

Transcript:
{transcript_text}

Respond with ONLY a JSON array, no other text:
[{{"title": "Example Title", "transcript_excerpt": "Full text of everything said from start to end...", "quote_text": "The key sentence.", "start_time": 120, "end_time": 160, "duration_tier": "short"}}]"""

    def _parse_time_value(self, value) -> float:
        """Parse a time value that may be seconds (float) or 'MM:SS'/'M:SS' string."""
        if isinstance(value, (int, float)):
            return float(value)
        s = str(value).strip()
        # Handle "MM:SS" or "M:SS" format
        m = re.match(r'^(\d+):(\d{1,2})(?:\.(\d+))?$', s)
        if m:
            minutes = int(m.group(1))
            seconds = int(m.group(2))
            frac = float(f"0.{m.group(3)}") if m.group(3) else 0.0
            return minutes * 60 + seconds + frac
        return float(s)

    def _classify_tier(self, duration: float) -> str:
        """Assign a duration tier based on actual duration."""
        if duration <= 50:
            return "short"
        elif duration <= 90:
            return "medium"
        else:
            return "long"

    def _parse_highlights(
        self, raw_response: str, segments: list[dict]
    ) -> list[Highlight]:
        """Parse highlights from LLM JSON response."""
        logger.info(f"Raw LLM response length: {len(raw_response)} chars")
        logger.info(f"Raw LLM response preview: {raw_response[:1000]}")

        json_match = re.search(r'\[[\s\S]*\]', raw_response)
        if not json_match:
            logger.warning(f"Could not find JSON array in response: {raw_response[:200]}")
            return []

        json_str = json_match.group()
        # Fix unquoted MM:SS timestamps (e.g. "start_time": 5:37 → "start_time": "5:37")
        json_str = re.sub(
            r'("(?:start_time|end_time)":\s*)(\d+:\d{1,2}(?:\.\d+)?)',
            r'\1"\2"',
            json_str,
        )

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse JSON: {e}")
            return []

        logger.info(f"Parsed {len(data)} highlight candidates from LLM")

        highlights = []
        for item in data:
            try:
                start_time = self._parse_time_value(item["start_time"])
                end_time = self._parse_time_value(item["end_time"])

                # Skip timestamps beyond the actual sermon duration
                max_time = segments[-1]["end"] if segments else float("inf")
                if start_time > max_time or end_time > max_time:
                    logger.warning(
                        f"Skipping highlight with out-of-range timestamps: "
                        f"{start_time:.0f}-{end_time:.0f} (max: {max_time:.0f})"
                    )
                    continue

                duration = end_time - start_time

                # Skip highlights that are too short or negative
                if duration < 10:
                    logger.warning(f"Skipping highlight with duration {duration:.0f}s (too short)")
                    continue

                # Skip highlights that are excessively long
                if duration > 180:
                    logger.warning(f"Skipping highlight with duration {duration:.0f}s (too long)")
                    continue

                # Reclassify tier based on actual duration instead of dropping
                tier = self._classify_tier(duration)
                requested_tier = item.get("duration_tier", "unknown")
                if tier != requested_tier:
                    logger.info(
                        f"Reclassified highlight from '{requested_tier}' to '{tier}' "
                        f"(duration: {duration:.0f}s)"
                    )

                # Snap start/end to nearest segment boundaries
                start_time = self._snap_to_segment(start_time, segments, snap="start")
                end_time = self._snap_to_segment(end_time, segments, snap="end")

                # Re-check duration after snapping
                snapped_duration = end_time - start_time
                if snapped_duration < 10:
                    logger.warning(
                        f"Skipping highlight with post-snap duration {snapped_duration:.0f}s"
                    )
                    continue

                # Update tier based on snapped duration
                tier = self._classify_tier(snapped_duration)

                title = item.get("title", "").strip()
                quote_text = item.get("quote_text", "").strip()
                transcript_excerpt = item.get("transcript_excerpt", "").strip()

                # Skip highlights with no text content
                if not title and not quote_text:
                    logger.warning(
                        f"Skipping highlight with empty title and quote_text: "
                        f"start={start_time}, end={end_time}, keys={list(item.keys())}"
                    )
                    continue

                # Fill in missing title from quote_text or vice versa
                if not title:
                    title = quote_text[:50] + ("..." if len(quote_text) > 50 else "")
                if not quote_text:
                    quote_text = title

                highlights.append(Highlight(
                    title=title,
                    transcript_excerpt=transcript_excerpt,
                    quote_text=quote_text,
                    start_time=start_time,
                    end_time=end_time,
                    duration_tier=tier,
                ))
            except (KeyError, ValueError) as e:
                logger.warning(f"Skipping invalid highlight: {e}")
                continue

        # Deduplicate: remove highlights with heavily overlapping time ranges
        unique = []
        for h in highlights:
            is_dup = False
            for u in unique:
                overlap_start = max(h.start_time, u.start_time)
                overlap_end = min(h.end_time, u.end_time)
                overlap = max(0, overlap_end - overlap_start)
                h_dur = h.end_time - h.start_time
                if h_dur > 0 and overlap / h_dur > 0.5:
                    is_dup = True
                    break
            if not is_dup:
                unique.append(h)

        logger.info(f"Returning {len(unique)} valid highlights (deduplicated from {len(highlights)})")
        return unique

    def _snap_to_segment(
        self, time: float, segments: list[dict], snap: str = "start"
    ) -> float:
        """Snap a timestamp to the nearest segment boundary (within 5s)."""
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

        # Only snap if within 5 seconds; otherwise keep original
        if best_dist > 5.0:
            return time
        return best
