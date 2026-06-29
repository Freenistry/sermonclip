import json
import logging
import math
import os
import re
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

MIN_HIGHLIGHT_DURATION = 25  # seconds — hard floor for valid clips
MAX_HIGHLIGHT_DURATION = 180  # seconds


@dataclass
class Highlight:
    title: str
    transcript_excerpt: str
    quote_text: str
    start_time: float
    end_time: float
    duration_tier: str  # 'short', 'medium', 'long'


@dataclass
class MergeSuggestion:
    highlight_indices: list[int]  # 0-based indices into highlights list
    reason: str
    merged_title: str
    confidence: str  # 'high', 'medium', 'low'


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

        Splits long sermons into sections and extracts per-section to ensure
        highlights are spread across the entire sermon.

        Args:
            segments: Transcript segments [{start, end, text}, ...]
            quotes: Extracted quotes [{text, start_time, end_time}, ...]

        Returns:
            List of Highlight objects
        """
        if not segments:
            return []

        max_time = max(seg["end"] for seg in segments)

        # Split sermon into sections (~5 min each, min 3, max 6)
        section_count = max(3, min(6, math.ceil(max_time / 300)))
        section_duration = max_time / section_count

        all_highlights = []
        for i in range(section_count):
            sec_start = i * section_duration
            sec_end = (i + 1) * section_duration

            # Get segments in this section (with some overlap for context)
            context_start = max(0, sec_start - 15)
            sec_segments = [
                s for s in segments
                if s["end"] > context_start and s["start"] < sec_end
            ]
            if not sec_segments:
                continue

            # Get quotes in this section
            sec_quotes = [
                q for q in quotes
                if q["start_time"] < sec_end and q.get("end_time", q["start_time"]) > sec_start
            ]

            highlights_per_section = max(2, round(10 / section_count))
            prompt = self._build_prompt(
                sec_segments, sec_quotes,
                section_start=sec_start,
                section_end=sec_end,
                total_duration=max_time,
                target_count=highlights_per_section,
            )

            section_highlights = self._call_ollama(prompt, segments)
            logger.info(
                f"Section {i+1}/{section_count} "
                f"({sec_start:.0f}s-{sec_end:.0f}s): "
                f"{len(section_highlights)} highlights"
            )
            all_highlights.extend(section_highlights)

        # Deduplicate across sections
        unique = self._deduplicate(all_highlights)

        # Merge nearby short highlights into medium/long clips
        merged = self._merge_short_highlights(unique, segments)

        logger.info(
            f"Total: {len(merged)} highlights "
            f"({len(all_highlights)} candidates → {len(unique)} unique → {len(merged)} after merge)"
        )
        return merged

    def _call_ollama(self, prompt: str, segments: list[dict]) -> list[Highlight]:
        """Make a single Ollama call and parse the response."""
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
                        "num_predict": 4096,
                    },
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

    def _consolidate_segments(self, segments: list[dict]) -> str:
        """Consolidate segments into ~30s chunks to reduce token count."""
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
        return "\n".join(chunks)

    def _build_prompt(
        self,
        segments: list[dict],
        quotes: list[dict],
        section_start: float,
        section_end: float,
        total_duration: float,
        target_count: int,
    ) -> str:
        transcript_text = self._consolidate_segments(segments)

        quotes_text = "\n".join(
            f"- \"{q['text']}\" ({q['start_time']:.0f}s)"
            for q in quotes
        ) if quotes else "(none for this section)"

        return f"""You are a social media editor finding the most IMPACTFUL moments from a sermon for short-form video clips.

SECTION: {section_start:.0f}s to {section_end:.0f}s of a {total_duration:.0f}s sermon.
Find {target_count} highlights from THIS section only.

CRITICAL RULES:
- MINIMUM clip length is 35 seconds. end_time minus start_time MUST be >= 35.
- Include AT LEAST one clip that is 60+ seconds long.
- A good clip captures the COMPLETE thought — include the setup, the point, AND the landing.
- If a powerful moment needs 60-90 seconds of context to land properly, use the full range.
- The clip MUST start at the beginning of a sentence — never mid-sentence.
- The clip MUST end after a complete sentence — never cut off mid-thought.
- Look at the transcript timestamps to find where sentences naturally begin and end.

Tier guidelines:
- SHORT (35-50s): One complete thought with setup and payoff
- MEDIUM (55-90s): Multiple connected ideas building to a conclusion
- LONG (90-120s): Full sermon moment with context and climax

Pick moments that are emotionally powerful, quotable, or tell a compelling mini-story. Skip filler.

JSON array ONLY — no other text:
- "title": punchy 3-6 word title
- "quote_text": the single most impactful COMPLETE sentence
- "transcript_excerpt": 1-2 sentence summary of what is said
- "start_time": seconds (number, between {section_start:.0f} and {section_end:.0f})
- "end_time": seconds (number, MUST be at least 35 more than start_time)
- "duration_tier": "short", "medium", or "long"

Key quotes:
{quotes_text}

Transcript:
{transcript_text}

REMEMBER: every clip must be at least 35 seconds. Double-check end_time - start_time >= 35 for each.
[{{"title": "Example", "transcript_excerpt": "Summary...", "quote_text": "Key sentence.", "start_time": {section_start:.0f}, "end_time": {section_start + 50:.0f}, "duration_tier": "short"}}]"""

    def _parse_time_value(self, value) -> float:
        """Parse a time value that may be seconds (float) or 'MM:SS'/'M:SS' string."""
        if isinstance(value, (int, float)):
            return float(value)
        s = str(value).strip()
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
        logger.debug(f"Raw LLM response preview: {raw_response[:500]}")

        json_match = re.search(r'\[[\s\S]*\]', raw_response)
        if not json_match:
            logger.warning(f"Could not find JSON array in response: {raw_response[:200]}")
            return []

        json_str = json_match.group()
        json_str = re.sub(
            r'("(?:start_time|end_time)":\s*)(\d+:\d{1,2}(?:\.\d+)?)',
            r'\1"\2"',
            json_str,
        )

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            # Try to salvage individual JSON objects from malformed array
            data = []
            for obj_match in re.finditer(r'\{[^{}]+\}', json_str):
                try:
                    data.append(json.loads(obj_match.group()))
                except json.JSONDecodeError:
                    continue
            if not data:
                logger.warning(f"Failed to parse any JSON from response")
                return []
            logger.info(f"Salvaged {len(data)} objects from malformed JSON")

        logger.info(f"Parsed {len(data)} highlight candidates from LLM")

        highlights = []
        max_time = segments[-1]["end"] if segments else float("inf")

        for item in data:
            try:
                start_time = self._parse_time_value(item["start_time"])
                end_time = self._parse_time_value(item["end_time"])

                if start_time > max_time or end_time > max_time:
                    logger.warning(
                        f"Skipping out-of-range: {start_time:.0f}-{end_time:.0f} (max: {max_time:.0f})"
                    )
                    continue

                duration = end_time - start_time

                if duration < MIN_HIGHLIGHT_DURATION:
                    logger.warning(f"Skipping highlight with duration {duration:.0f}s (min: {MIN_HIGHLIGHT_DURATION}s)")
                    continue

                if duration > MAX_HIGHLIGHT_DURATION:
                    logger.warning(f"Skipping highlight with duration {duration:.0f}s (max: {MAX_HIGHLIGHT_DURATION}s)")
                    continue

                # Snap start/end to nearest segment boundaries
                start_time = self._snap_to_segment(start_time, segments, snap="start")
                end_time = self._snap_to_segment(end_time, segments, snap="end")

                # Adjust to sentence boundaries so clips don't start/end mid-sentence
                start_time, end_time = self._snap_to_sentence_boundary(start_time, end_time, segments)

                snapped_duration = end_time - start_time
                if snapped_duration < MIN_HIGHLIGHT_DURATION:
                    logger.warning(f"Skipping post-snap duration {snapped_duration:.0f}s")
                    continue
                if snapped_duration > MAX_HIGHLIGHT_DURATION:
                    logger.warning(f"Skipping post-snap duration {snapped_duration:.0f}s (exceeds max)")
                    continue

                tier = self._classify_tier(snapped_duration)

                title = item.get("title", "").strip()
                quote_text = item.get("quote_text", "").strip()
                transcript_excerpt = item.get("transcript_excerpt", "").strip()

                if not title and not quote_text:
                    continue

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

        return highlights

    def _deduplicate(self, highlights: list[Highlight]) -> list[Highlight]:
        """Remove highlights with >50% time overlap, keeping longer clips."""
        # Sort by duration descending so we keep the longer/better clips
        sorted_hl = sorted(highlights, key=lambda h: h.end_time - h.start_time, reverse=True)
        unique = []
        for h in sorted_hl:
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
        # Return sorted by start time
        unique.sort(key=lambda h: h.start_time)
        return unique

    def _merge_short_highlights(
        self, highlights: list[Highlight], segments: list[dict]
    ) -> list[Highlight]:
        """Merge nearby short highlights into medium/long clips for variety.

        If two short highlights are within 30s of each other, merge them
        into a single medium/long clip. This compensates for small LLMs
        that consistently produce short clips.
        """
        if len(highlights) < 2:
            return highlights

        merged = []
        skip = set()

        for i, h in enumerate(highlights):
            if i in skip:
                continue

            # Only try merging short clips
            h_dur = h.end_time - h.start_time
            if h_dur > 50:
                merged.append(h)
                continue

            # Look for next highlight within 30s gap
            if i + 1 < len(highlights) and i + 1 not in skip:
                next_h = highlights[i + 1]
                gap = next_h.start_time - h.end_time
                combined_dur = next_h.end_time - h.start_time

                if gap <= 30 and combined_dur <= MAX_HIGHLIGHT_DURATION:
                    # Merge: use first title, best quote (longer one)
                    best_quote = h.quote_text if len(h.quote_text) > len(next_h.quote_text) else next_h.quote_text
                    excerpt = f"{h.transcript_excerpt} {next_h.transcript_excerpt}".strip()
                    tier = self._classify_tier(combined_dur)
                    merged.append(Highlight(
                        title=h.title,
                        transcript_excerpt=excerpt,
                        quote_text=best_quote,
                        start_time=h.start_time,
                        end_time=next_h.end_time,
                        duration_tier=tier,
                    ))
                    skip.add(i + 1)
                    logger.info(
                        f"Merged '{h.title}' + '{next_h.title}' → "
                        f"{combined_dur:.0f}s ({tier})"
                    )
                    continue

            merged.append(h)

        return merged

    def suggest_merges(self, highlights: list[Highlight]) -> list[MergeSuggestion]:
        """Suggest which highlights could be merged for stronger clips."""
        if len(highlights) < 2:
            return []

        prompt = self._build_merge_prompt(highlights)
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
                        "num_predict": 2048,
                    },
                },
                timeout=300.0,
            )

            if response.status_code != 200:
                logger.error(f"Ollama API error during merge suggestion: {response.status_code}")
                return []

            result = response.json()
            raw_response = result.get("response", "")
            return self._parse_merge_suggestions(raw_response, highlights)

        except httpx.TimeoutException:
            logger.error("Ollama timeout during merge suggestion")
            return []
        except Exception as e:
            logger.error(f"Merge suggestion failed: {e}")
            return []

    def _build_merge_prompt(self, highlights: list[Highlight]) -> str:
        """Build prompt for merge suggestion LLM call."""
        highlight_lines = []
        for i, h in enumerate(highlights):
            duration = h.end_time - h.start_time
            start_fmt = self._format_time(h.start_time)
            end_fmt = self._format_time(h.end_time)
            highlight_lines.append(
                f'[{i}] "{h.title}" ({start_fmt}-{end_fmt}, {duration:.0f}s) '
                f'Quote: "{h.quote_text}" Summary: {h.transcript_excerpt}'
            )
        highlights_text = "\n".join(highlight_lines)

        return f"""You are a senior video editor analyzing sermon highlights. Your job is to find clips that form a CLEAR setup-and-payoff arc when combined.

HIGHLIGHTS:
{highlights_text}

STRICT MERGE RULES — only suggest a merge when ALL of these are true:
1. The two clips are CLOSE in time — the gap between them is under 90 seconds
2. There is a clear NARRATIVE ARC: one clip sets up a question/tension, the other delivers the answer/resolution
3. A viewer watching them back-to-back would feel a natural flow — not a jarring topic jump
4. They reference the SAME specific story, scripture, illustration, or argument (not just a vague thematic similarity)
5. Combined content duration (sum of both clips) is under 180 seconds
6. Neither clip is already 90+ seconds

DO NOT MERGE clips that:
- Share only a loose thematic connection (e.g. both mention "fear" but discuss different fears)
- Are far apart in the sermon (gap over 90 seconds means the speaker moved on)
- Would feel like two separate thoughts stitched together
- Both stand perfectly well on their own without the other

When in doubt, do NOT suggest the merge. It is better to return [] than to suggest a weak merge. Most sermons will have 0-1 good merge candidates.

For each suggested merge, provide:
- "indices": array of highlight indices to merge (usually 2)
- "reason": explain the specific setup→payoff arc (1 sentence)
- "merged_title": punchy 3-6 word title for the combined clip
- "confidence": "high" or "medium" (do not suggest "low" confidence merges)

Return a JSON array ONLY — no other text. If no good merges exist, return [].

[{{"indices": [0, 1], "reason": "Clip 0 poses the question X, clip 1 delivers the answer Y", "merged_title": "Title Here", "confidence": "high"}}]"""

    def _parse_merge_suggestions(
        self, raw_response: str, highlights: list[Highlight]
    ) -> list[MergeSuggestion]:
        """Parse merge suggestions from LLM JSON response."""
        logger.info(f"Merge suggestion response length: {len(raw_response)} chars")

        json_match = re.search(r'\[[\s\S]*\]', raw_response)
        if not json_match:
            logger.warning("No JSON array found in merge suggestion response")
            return []

        try:
            data = json.loads(json_match.group())
        except json.JSONDecodeError:
            logger.warning("Failed to parse merge suggestion JSON")
            return []

        suggestions = []
        max_idx = len(highlights) - 1

        for item in data:
            try:
                indices = item.get("indices", [])
                if len(indices) < 2:
                    continue

                # Validate indices
                if any(not isinstance(i, int) or i < 0 or i > max_idx for i in indices):
                    logger.warning(f"Invalid indices in merge suggestion: {indices}")
                    continue

                # Check gap between clips — reject if speaker moved on (>90s gap)
                sorted_indices = sorted(indices, key=lambda i: highlights[i].start_time)
                for j in range(len(sorted_indices) - 1):
                    gap = highlights[sorted_indices[j + 1]].start_time - highlights[sorted_indices[j]].end_time
                    if gap > 90:
                        logger.warning(f"Skipping merge with {gap:.0f}s gap between clips")
                        break
                else:
                    gap = 0  # no break — all gaps ok
                if gap > 90:
                    continue

                # Check combined content duration (sum of segments, not full span)
                combined_content = sum(
                    highlights[i].end_time - highlights[i].start_time for i in indices
                )
                if combined_content > MAX_HIGHLIGHT_DURATION:
                    logger.warning(f"Skipping merge with combined content duration {combined_content:.0f}s")
                    continue

                # Don't merge two long highlights
                if all((highlights[i].end_time - highlights[i].start_time) >= 90 for i in indices):
                    logger.warning("Skipping merge of two 90+ second highlights")
                    continue

                confidence = item.get("confidence", "medium")
                if confidence not in ("high", "medium"):
                    logger.info(f"Skipping low-confidence merge suggestion")
                    continue

                suggestions.append(MergeSuggestion(
                    highlight_indices=indices,
                    reason=item.get("reason", ""),
                    merged_title=item.get("merged_title", ""),
                    confidence=confidence,
                ))
            except (KeyError, ValueError, IndexError) as e:
                logger.warning(f"Skipping invalid merge suggestion: {e}")
                continue

        logger.info(f"Parsed {len(suggestions)} valid merge suggestions")
        return suggestions

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

        if best_dist > 5.0:
            return time
        return best

    def _snap_to_sentence_boundary(
        self, start_time: float, end_time: float, segments: list[dict]
    ) -> tuple[float, float]:
        """Adjust start/end to land on sentence boundaries using word timestamps.

        Uses word-level timestamps to find exact positions of sentence-ending
        punctuation (. ! ?) so clips don't start or end mid-sentence.
        """
        if not segments:
            return start_time, end_time

        # Build a flat list of words with timestamps from nearby segments
        words = []
        for seg in segments:
            if seg["end"] < start_time - 30 or seg["start"] > end_time + 30:
                continue
            for w in seg.get("words", []):
                words.append(w)

        if not words:
            return start_time, end_time

        # --- Snap start backward to sentence beginning ---
        # Find the word at start_time, then look backward for a sentence-ending
        # word (ends with . ! ?). The next word after that is the sentence start.
        start_word_idx = None
        for i, w in enumerate(words):
            if w["end"] >= start_time:
                start_word_idx = i
                break
        if start_word_idx is not None:
            for i in range(start_word_idx - 1, max(start_word_idx - 40, -1), -1):
                word_text = words[i]["word"].strip()
                if word_text and word_text[-1] in '.!?':
                    # Sentence ends here; next word starts a new sentence
                    new_start = words[i + 1]["start"] if i + 1 < len(words) else words[i]["end"]
                    if start_time - new_start <= 15:
                        start_time = new_start
                        logger.debug(f"Snapped start back to {start_time:.1f}s (after '{word_text}')")
                    break

        # --- Snap end forward to sentence completion ---
        # Find the word at end_time, then look forward for a sentence-ending word.
        end_word_idx = None
        for i, w in enumerate(words):
            if w["end"] >= end_time - 1:
                end_word_idx = i
                break
        if end_word_idx is not None:
            # First check: does the current word already end a sentence?
            cur_text = words[end_word_idx]["word"].strip()
            if cur_text and cur_text[-1] in '.!?':
                end_time = words[end_word_idx]["end"]
            else:
                # Look forward (up to 15s) for sentence-ending punctuation
                for i in range(end_word_idx + 1, min(end_word_idx + 40, len(words))):
                    if words[i]["start"] - end_time > 15:
                        break
                    word_text = words[i]["word"].strip()
                    if word_text and word_text[-1] in '.!?':
                        end_time = words[i]["end"]
                        logger.debug(f"Snapped end forward to {end_time:.1f}s (at '{word_text}')")
                        break

        return start_time, end_time
