"""ASS subtitle generation with animated styles for word-level timestamps."""

from pathlib import Path
from typing import Optional

FONT_PATH = Path(__file__).parent.parent / "assets" / "fonts" / "Montserrat-Bold.ttf"
FONT_NAME = "Montserrat Bold"


def _ass_time(seconds: float) -> str:
    """Convert seconds to ASS timestamp format H:MM:SS.CC"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _hex_to_ass_color(hex_color: str) -> str:
    """Convert hex color (#RRGGBB) to ASS BGR format (&H00BBGGRR&)."""
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return f"&H00{b:02X}{g:02X}{r:02X}&"


def _ass_header(
    video_width: int,
    video_height: int,
    font_color: Optional[str] = None,
    font_size: Optional[int] = None,
    font_bold: bool = True,
) -> str:
    """Generate ASS file header with script info and styles."""
    primary = _hex_to_ass_color(font_color) if font_color else "&H00FFFFFF"
    # The frontend slider sends 24-72 (default 48) as a UI-scale value.
    # Scale to actual video pixels proportional to output height.
    ui_sz = font_size or 48
    sz = int(ui_sz * 1.8 * video_height / 1080)
    big_sz = int(sz * 1.5)
    hl_sz = int(sz * 1.17)
    bold = -1 if font_bold else 0

    return f"""[Script Info]
Title: SermonClip Subtitles
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Basic,{FONT_NAME},{sz},{primary},&H000000FF,&H00000000,&H80000000,{bold},0,0,0,100,100,0,0,1,3,1,2,40,40,60,1
Style: BigCenter,{FONT_NAME},{big_sz},{primary},&H000000FF,&H00000000,&H80000000,{bold},0,0,0,100,100,0,0,1,4,2,5,40,40,40,1
Style: Highlight,{FONT_NAME},{hl_sz},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,{bold},0,0,0,100,100,0,0,1,3,1,5,40,40,60,1
Style: HighlightActive,{FONT_NAME},{hl_sz},{primary},&H000000FF,&H00000000,&H80000000,{bold},0,0,0,100,100,0,0,1,3,1,5,40,40,60,1

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
        font_color: Optional[str] = None,
        font_size: Optional[int] = None,
        font_weight: Optional[str] = None,
    ) -> str:
        """
        Generate ASS subtitle content.

        Args:
            words: List of {word, start, end} dicts
            style: One of 'basic', 'one_word', 'two_word', 'elevate', 'word_color'
            video_width: Output video width
            video_height: Output video height
            clip_start_time: Start time of the clip (subtracted from word times)
            font_color: Hex color for subtitle text (e.g. "#FFFFFF")
            font_size: Font size in pixels
            font_weight: "normal" or "bold"

        Returns:
            ASS file content as string
        """
        font_bold = font_weight != "normal"
        header = _ass_header(video_width, video_height, font_color, font_size, font_bold)

        if not words:
            return header

        # For word_color style, compute the ASS highlight color
        highlight_color = _hex_to_ass_color(font_color) if font_color else "&H0000FFFF&"

        generators = {
            "basic": self._basic,
            "one_word": self._one_word,
            "two_word": self._two_word,
            "elevate": self._elevate,
            "word_color": lambda w, o: self._word_color(w, o, highlight_color),
            "text_reveal": lambda w, o: self._text_reveal(w, o, highlight_color),
            "slide_in": self._slide_in,
            "word_bg": lambda w, o: self._word_bg(w, o, highlight_color),
            "word_append": self._word_append,
            "highlight_impactful": lambda w, o: self._highlight_impactful(w, o, highlight_color),
        }

        generator = generators.get(style, self._basic)
        events = generator(words, clip_start_time)
        return header + "\n".join(events) + "\n"

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

    def _word_color(self, words: list[dict], offset: float, highlight_color: str = "&H0000FFFF&") -> list[str]:
        """All words visible, active word highlighted with custom color."""
        phrases = self._group_into_phrases(words)
        events = []
        for phrase in phrases:
            for active_idx, active_word in enumerate(phrase):
                w_start = _ass_time(active_word["start"] - offset)
                w_end = _ass_time(active_word["end"] - offset)
                parts = []
                for j, w in enumerate(phrase):
                    if j == active_idx:
                        parts.append(f"{{\\c{highlight_color}}}{w['word']}{{\\c&H00FFFFFF&}}")
                    else:
                        parts.append(w["word"])
                text = " ".join(parts)
                events.append(f"Dialogue: 0,{w_start},{w_end},Highlight,,0,0,0,,{text}")
        return events

    def _text_reveal(self, words: list[dict], offset: float, highlight_color: str = "&H0000FFFF&") -> list[str]:
        """Words revealed progressively with underline effect."""
        phrases = self._group_into_phrases(words)
        events = []
        for phrase in phrases:
            for active_idx, active_word in enumerate(phrase):
                w_start = _ass_time(active_word["start"] - offset)
                w_end = _ass_time(active_word["end"] - offset)
                parts = []
                for j, w in enumerate(phrase):
                    if j <= active_idx:
                        # Revealed: colored + underline
                        parts.append(f"{{\\c{highlight_color}\\u1}}{w['word']}{{\\u0\\c&H00FFFFFF&}}")
                    else:
                        # Dim / not yet revealed
                        parts.append(f"{{\\alpha&H99&}}{w['word']}{{\\alpha&H00&}}")
                text = " ".join(parts)
                events.append(f"Dialogue: 0,{w_start},{w_end},Highlight,,0,0,0,,{text}")
        return events

    def _slide_in(self, words: list[dict], offset: float) -> list[str]:
        """Phrases slide in from left with move animation."""
        phrases = self._group_into_phrases(words)
        events = []
        for phrase in phrases:
            start = _ass_time(phrase[0]["start"] - offset)
            end = _ass_time(phrase[-1]["end"] - offset)
            text_str = " ".join(w["word"] for w in phrase)
            # Slide from left (-200) to center (0) over 300ms
            text = f"{{\\move(-200,0,0,0,0,300)}}{text_str}"
            events.append(f"Dialogue: 0,{start},{end},Highlight,,0,0,0,,{text}")
        return events

    def _word_bg(self, words: list[dict], offset: float, highlight_color: str = "&H0000FFFF&") -> list[str]:
        """Active word gets a colored background box."""
        phrases = self._group_into_phrases(words)
        events = []
        for phrase in phrases:
            for active_idx, active_word in enumerate(phrase):
                w_start = _ass_time(active_word["start"] - offset)
                w_end = _ass_time(active_word["end"] - offset)
                parts = []
                for j, w in enumerate(phrase):
                    if j == active_idx:
                        # BorderStyle 3 = opaque box, so use inline override
                        parts.append(
                            f"{{\\3c{highlight_color}\\bord4\\p0}}{w['word']}{{\\3c&H00000000&\\bord3}}"
                        )
                    else:
                        parts.append(w["word"])
                text = " ".join(parts)
                events.append(f"Dialogue: 0,{w_start},{w_end},Highlight,,0,0,0,,{text}")
        return events

    def _word_append(self, words: list[dict], offset: float) -> list[str]:
        """Words appear one by one, building up the sentence."""
        phrases = self._group_into_phrases(words)
        events = []
        for phrase in phrases:
            for i, word in enumerate(phrase):
                w_start = _ass_time(word["start"] - offset)
                # Show accumulated words until end of phrase
                w_end = _ass_time(phrase[-1]["end"] - offset)
                accumulated = " ".join(w["word"] for w in phrase[:i + 1])
                events.append(f"Dialogue: 0,{w_start},{w_end},Highlight,,0,0,0,,{accumulated}")
        return events

    def _highlight_impactful(self, words: list[dict], offset: float, highlight_color: str = "&H0000FFFF&") -> list[str]:
        """All words visible, longer words (4+ letters) highlighted when active."""
        phrases = self._group_into_phrases(words)
        events = []
        for phrase in phrases:
            for active_idx, active_word in enumerate(phrase):
                w_start = _ass_time(active_word["start"] - offset)
                w_end = _ass_time(active_word["end"] - offset)
                # Only highlight if word is 4+ alphanumeric chars
                clean_word = "".join(c for c in active_word["word"] if c.isalpha())
                is_impactful = len(clean_word) >= 4
                parts = []
                for j, w in enumerate(phrase):
                    if j == active_idx and is_impactful:
                        parts.append(
                            f"{{\\c{highlight_color}\\fscx110\\fscy110}}{w['word']}{{\\fscx100\\fscy100\\c&H00FFFFFF&}}"
                        )
                    else:
                        parts.append(w["word"])
                text = " ".join(parts)
                events.append(f"Dialogue: 0,{w_start},{w_end},Highlight,,0,0,0,,{text}")
        return events
