"""ASS subtitle generation with animated styles for word-level timestamps."""

from pathlib import Path

FONT_PATH = Path(__file__).parent.parent / "assets" / "fonts" / "Montserrat-Bold.ttf"
FONT_NAME = "Montserrat Bold"


def _ass_time(seconds: float) -> str:
    """Convert seconds to ASS timestamp format H:MM:SS.CC"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_header(video_width: int, video_height: int) -> str:
    """Generate ASS file header with script info and styles."""
    return f"""[Script Info]
Title: SermonClip Subtitles
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Basic,{FONT_NAME},48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,60,1
Style: BigCenter,{FONT_NAME},72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,5,40,40,40,1
Style: Highlight,{FONT_NAME},56,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,60,1
Style: HighlightActive,{FONT_NAME},56,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,40,40,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


class SubtitleService:
    """Generates .ass subtitle files from word timestamps with multiple styles."""

    def generate_ass(
        self,
        words: list[dict],
        style: str,
        video_width: int,
        video_height: int,
        clip_start_time: float,
    ) -> str:
        """
        Generate ASS subtitle content.

        Args:
            words: List of {word, start, end} dicts
            style: One of 'basic', 'one_word', 'two_word', 'elevate', 'word_color'
            video_width: Output video width
            video_height: Output video height
            clip_start_time: Start time of the clip (subtracted from word times)

        Returns:
            ASS file content as string
        """
        if not words:
            return _ass_header(video_width, video_height)

        generators = {
            "basic": self._basic,
            "one_word": self._one_word,
            "two_word": self._two_word,
            "elevate": self._elevate,
            "word_color": self._word_color,
        }

        generator = generators.get(style, self._basic)
        events = generator(words, clip_start_time)
        return _ass_header(video_width, video_height) + "\n".join(events) + "\n"

    def _group_into_phrases(self, words: list[dict], max_words: int = 8) -> list[list[dict]]:
        """Group words into phrases for display."""
        phrases = []
        current = []
        for w in words:
            current.append(w)
            if len(current) >= max_words:
                phrases.append(current)
                current = []
        if current:
            phrases.append(current)
        return phrases

    def _basic(self, words: list[dict], offset: float) -> list[str]:
        """Full phrases at bottom."""
        phrases = self._group_into_phrases(words)
        events = []
        for phrase in phrases:
            start = _ass_time(phrase[0]["start"] - offset)
            end = _ass_time(phrase[-1]["end"] - offset)
            text = " ".join(w["word"] for w in phrase)
            events.append(f"Dialogue: 0,{start},{end},Basic,,0,0,0,,{text}")
        return events

    def _one_word(self, words: list[dict], offset: float) -> list[str]:
        """Single word centered, large."""
        events = []
        for w in words:
            start = _ass_time(w["start"] - offset)
            end = _ass_time(w["end"] - offset)
            events.append(f"Dialogue: 0,{start},{end},BigCenter,,0,0,0,,{w['word']}")
        return events

    def _two_word(self, words: list[dict], offset: float) -> list[str]:
        """Word pairs centered."""
        events = []
        for i in range(0, len(words), 2):
            pair = words[i:i + 2]
            start = _ass_time(pair[0]["start"] - offset)
            end = _ass_time(pair[-1]["end"] - offset)
            text = " ".join(w["word"] for w in pair)
            events.append(f"Dialogue: 0,{start},{end},BigCenter,,0,0,0,,{text}")
        return events

    def _elevate(self, words: list[dict], offset: float) -> list[str]:
        """Scale-up pop animation per word using ASS \\fscx/\\fscy tags."""
        events = []
        for w in words:
            start = _ass_time(w["start"] - offset)
            end = _ass_time(w["end"] - offset)
            # Pop-in animation: scale from 80% to 110% then settle to 100%
            word_dur = max(0.05, w["end"] - w["start"])
            pop_ms = min(100, int(word_dur * 1000 * 0.3))
            settle_ms = min(100, int(word_dur * 1000 * 0.2))
            text = (
                f"{{\\fscx80\\fscy80\\t(0,{pop_ms},\\fscx110\\fscy110)"
                f"\\t({pop_ms},{pop_ms + settle_ms},\\fscx100\\fscy100)}}"
                f"{w['word']}"
            )
            events.append(f"Dialogue: 0,{start},{end},BigCenter,,0,0,0,,{text}")
        return events

    def _word_color(self, words: list[dict], offset: float) -> list[str]:
        """All words visible, active word highlighted yellow."""
        phrases = self._group_into_phrases(words)
        events = []
        for phrase in phrases:
            phrase_start = _ass_time(phrase[0]["start"] - offset)
            phrase_end = _ass_time(phrase[-1]["end"] - offset)
            for active_idx, active_word in enumerate(phrase):
                w_start = _ass_time(active_word["start"] - offset)
                w_end = _ass_time(active_word["end"] - offset)
                parts = []
                for j, w in enumerate(phrase):
                    if j == active_idx:
                        # Yellow highlight for active word
                        parts.append(f"{{\\c&H0000FFFF&}}{w['word']}{{\\c&H00FFFFFF&}}")
                    else:
                        parts.append(w["word"])
                text = " ".join(parts)
                events.append(f"Dialogue: 0,{w_start},{w_end},Highlight,,0,0,0,,{text}")
        return events
