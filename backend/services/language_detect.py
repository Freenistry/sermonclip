import logging
from langdetect import detect, DetectorFactory

logger = logging.getLogger(__name__)

# Make detection deterministic
DetectorFactory.seed = 0


def detect_language(text: str) -> tuple[str, str]:
    """Detect the primary language of a text.

    Returns:
        Tuple of (language_code, language_name).
        Falls back to ("en", "English") on failure.
    """
    LANGUAGE_NAMES = {
        "en": "English",
        "tl": "Filipino/Tagalog",
        "fil": "Filipino/Tagalog",
        "es": "Spanish",
        "pt": "Portuguese",
        "ko": "Korean",
        "zh-cn": "Chinese",
        "ja": "Japanese",
        "id": "Indonesian",
        "ms": "Malay",
        "fr": "French",
        "de": "German",
    }

    # Sample middle portion of text (more representative than start/end)
    sample_start = len(text) // 4
    sample = text[sample_start:sample_start + 3000]

    try:
        code = detect(sample)
        name = LANGUAGE_NAMES.get(code, code.title())
        logger.info(f"Detected language: {name} ({code})")
        return code, name
    except Exception as e:
        logger.warning(f"Language detection failed: {e}, defaulting to English")
        return "en", "English"
