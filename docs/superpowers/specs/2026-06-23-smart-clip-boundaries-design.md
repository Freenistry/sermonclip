# Smart Clip Boundaries Design

**Date:** 2026-06-23
**Status:** Approved

## Overview

Enhance clip generation to create impactful 30-60 second clips by using Ollama to intelligently select optimal boundaries around each quote, capturing a complete thought arc (setup → quote → conclusion).

## Requirements

- **Duration:** 30-60 seconds (vs current quote-only timestamps)
- **Intelligence:** LLM-driven boundary selection using transcript context
- **Content:** Complete thought arc - setup/context before, conclusion after
- **Fallback:** If LLM fails, expand ±15 seconds from quote boundaries
- **Trigger:** On-demand when user clicks "Clip" button

## Architecture

```
User clicks "Clip" on QuoteCard
        │
        ▼
POST /clip/quote/{id}?smart=true
        │
        ▼
Fetch quote + transcript from DB
        │
        ▼
ClipService.get_smart_boundaries()
  1. Build context window (±60 sec around quote)
  2. Format segments with timestamps for LLM
  3. Call Ollama to find optimal 30-60 sec boundaries
  4. Parse response, validate duration
  5. Return expanded start_time, end_time
        │
        ▼
ClipService.generate_quote_clip()
  (existing FFmpeg pipeline with smart timestamps)
        │
        ▼
Return MP4 clip (30-60 seconds)
```

## Backend Components

### ClipService (`backend/services/clip_service.py`)

**New method:**

```python
def get_smart_boundaries(
    self,
    quote_text: str,
    quote_start: float,
    quote_end: float,
    segments: list[dict],  # [{start, end, text}, ...]
) -> tuple[float, float]:
    """
    Use Ollama to find optimal 30-60 sec clip boundaries.

    Args:
        quote_text: The quote to build clip around
        quote_start: Original quote start time
        quote_end: Original quote end time
        segments: Transcript segments with timestamps

    Returns:
        (start_time, end_time) tuple for the expanded clip

    Falls back to ±15 sec expansion if:
        - Ollama unavailable
        - Response parsing fails
        - Duration outside 30-60 sec range
    """
```

**Ollama Prompt:**

```
You are analyzing a sermon transcript to find the optimal video clip boundaries.

The goal: Create a 30-60 second clip that captures a complete thought arc around this quote:
"{quote_text}"

Transcript context (with timestamps):
[0:45-0:52] "When we face challenges..."
[0:52-1:01] "God doesn't abandon us..."
[1:01-1:08] "{the quote appears here}"
[1:08-1:15] "And that's the promise..."

Find timestamps that:
1. Start with setup/context that leads into the quote
2. Include the full quote
3. End with conclusion or natural pause
4. Total duration: 30-60 seconds

Respond with ONLY two numbers (start and end in seconds):
START: 45.0
END: 75.0
```

### API Endpoint (`backend/routers/clip.py`)

**Updated endpoint:**

```python
@router.post("/quote/{quote_id}")
async def generate_quote_clip(
    quote_id: str,
    smart: bool = True,  # NEW: Enable smart boundary detection
) -> ClipResponse:
```

**Logic changes:**
1. If `smart=True`, fetch transcript segments for the quote's project
2. Call `clip_service.get_smart_boundaries()` to get expanded timestamps
3. Pass expanded timestamps to `generate_quote_clip()`
4. If `smart=False`, use original quote timestamps (backwards compatible)

## Frontend Changes

### QuoteCard.tsx

Update API call to include smart parameter:

```typescript
const response = await fetch(`${API_URL}/clip/quote/${quote.id}?smart=true`, {
  method: "POST",
});
```

No other UI changes required - existing loading state handles the slightly longer generation time.

## Fallback Behavior

If smart boundary detection fails, use simple expansion:

```python
def _fallback_boundaries(quote_start: float, quote_end: float) -> tuple[float, float]:
    """Expand ±15 seconds to reach ~30 sec minimum."""
    duration = quote_end - quote_start
    if duration >= 30:
        return quote_start, quote_end

    expand = (30 - duration) / 2
    return max(0, quote_start - expand), quote_end + expand
```

**Fallback triggers:**
- Ollama service unavailable
- LLM response parsing fails
- Calculated duration < 30 or > 60 seconds
- No transcript segments available

## Constraints

- Minimum clip duration: 30 seconds
- Maximum clip duration: 60 seconds
- Context window for LLM: ±60 seconds around quote
- Ollama model: llama3.1:8b (same as quote extraction)
- Ollama timeout: 30 seconds for boundary detection

## File Changes

```
backend/
  services/
    clip_service.py        # ADD: get_smart_boundaries() method
  routers/
    clip.py                # MODIFY: Add smart parameter, fetch transcript

frontend/
  src/components/projects/
    QuoteCard.tsx          # MODIFY: Add ?smart=true to API call
```

## Dependencies

No new dependencies - uses existing Ollama integration from OllamaService.

## Future Enhancements (Out of Scope)

- Pre-compute smart boundaries during initial processing
- User adjustment of clip boundaries in UI
- Multiple clip length options (30s, 45s, 60s)
- Batch smart clip generation
