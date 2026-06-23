# Sermon Highlights Design

## Problem

Current clips are built around short individual quotes (3-7s) expanded to 30s with padding. The result lacks narrative completeness and impact. Users want clips that capture complete, impactful thought arcs at multiple durations.

## Solution

Replace the quote-centric clip system with "Sermon Highlights" — complete thought arcs extracted by the LLM at three flexible duration tiers (~30s, ~1min, ~1:30). Each highlight contains a title, full transcript excerpt, and a punchline quote (used for images/copy).

## Approach: New table + link to quotes

- New `sermon_highlights` table stores complete thought arcs with timestamps and duration tier
- Existing `quotes` table gains an optional `highlight_id` FK linking quotes to their parent highlight
- LLM extracts quotes first (existing behavior), then groups them into highlights (new step)
- Highlights are pre-computed during processing; video rendering happens on demand

## Database Schema

### New table: `sermon_highlights`

```sql
CREATE TABLE public.sermon_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  transcript_excerpt TEXT NOT NULL,
  quote_text TEXT NOT NULL,
  start_time DECIMAL NOT NULL,
  end_time DECIMAL NOT NULL,
  duration_tier TEXT NOT NULL CHECK (duration_tier IN ('short', 'medium', 'long')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_highlights_project_id ON public.sermon_highlights(project_id);

ALTER TABLE public.sermon_highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view church highlights" ON public.sermon_highlights
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM public.projects WHERE church_id IN (
        SELECT church_id FROM public.users WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Service can insert highlights" ON public.sermon_highlights
  FOR INSERT WITH CHECK (true);
```

### Alter existing `quotes` table

```sql
ALTER TABLE public.quotes ADD COLUMN highlight_id UUID REFERENCES public.sermon_highlights(id) ON DELETE SET NULL;
```

## Processing Pipeline

```
upload -> download -> extract_audio -> transcribe -> analyze (quotes) -> extract_highlights -> completed
```

New `extract_highlights` step:
1. Receives full transcript (with timestamps) + extracted quotes
2. Calls Ollama to identify complete thought arcs at 3 duration tiers
3. LLM returns structured highlights with title, excerpt, punchline, timestamps, duration tier
4. Saves to `sermon_highlights` table and links related quotes via `highlight_id`

## LLM Prompt Strategy

Input: full transcript with segment timestamps + extracted quotes as anchor points.

Output format:
```json
[
  {
    "title": "God Will Never Fail",
    "transcript_excerpt": "The full text of the thought arc...",
    "quote_text": "Ang Diyos natin, He will never fail",
    "start_time": 2610.0,
    "end_time": 2645.0,
    "duration_tier": "short"
  }
]
```

Duration guidelines for LLM:
- short: 20-40 seconds (target ~30s) — single powerful thought
- medium: 45-75 seconds (target ~1min) — deeper arc with 2-3 connected ideas
- long: 75-100 seconds (target ~1:30) — full sermon moment with context, build-up, climax

The LLM decides how many highlights exist per tier based on content quality. Not every sermon will have long highlights.

## Frontend UI

Replace quotes list with Sermon Highlights grouped by duration:

```
Sermon Highlights

Short (~30s)
  [HighlightCard] "God Will Never Fail" [28s]     Copy | Image | Clip
  [HighlightCard] "God Won't Abandon You" [33s]   Copy | Image | Clip

Medium (~1 min)
  [HighlightCard] "Trust Beyond Anxiety" [58s]     Copy | Image | Clip

Long (~1:30)
  [HighlightCard] "The Full Message of Trust" [84s] Copy | Image | Clip
```

Each HighlightCard shows:
- Title (bold)
- Punchline quote (italic)
- Duration badge
- Actions: Copy (quote_text), Image (quote_text), Clip (video from start_time to end_time)

## API Changes

### New endpoint
- `POST /clip/highlight/{highlight_id}` — generates video clip using highlight timestamps

### Existing endpoints
- `POST /clip/quote/{quote_id}` — kept for backward compat but no longer primary
- `POST /image/quote/{quote_id}` — still works, highlights reference quote_text for images

### New status endpoint fields
- `highlights_count` added to status response

## Clip Generation Changes

- Remove smart boundary detection from ClipService (highlights already have correct boundaries)
- Keep FFmpeg rendering as-is (on-demand)
- No base64 response change needed for now

## Migration Path

- Existing projects keep their quotes (still visible if no highlights exist)
- New processing runs produce highlights
- Users can re-process existing projects to generate highlights
