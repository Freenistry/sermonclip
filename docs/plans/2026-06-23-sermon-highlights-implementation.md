# Sermon Highlights Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace quote-based clips with Sermon Highlights — complete thought arcs at ~30s/1min/1:30 durations, extracted by LLM during processing.

**Architecture:** New `sermon_highlights` table stores pre-computed highlight definitions (title, excerpt, quote, timestamps, duration tier). Processing pipeline adds an `extract_highlights` step after quote extraction. Frontend replaces the quotes grid with highlights grouped by duration tier. Video clips are rendered on-demand via FFmpeg.

**Tech Stack:** Python/FastAPI backend, Ollama LLM (llama3.1:8b), Supabase/PostgreSQL, Next.js frontend, FFmpeg for clip rendering.

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260623100000_add_sermon_highlights.sql`

**Step 1: Write the migration SQL**

```sql
-- Sermon Highlights table
CREATE TABLE public.sermon_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  church_id UUID REFERENCES public.churches(id) ON DELETE CASCADE,
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sermon_highlights TO authenticated;
GRANT ALL ON public.sermon_highlights TO service_role;

-- Add highlight_id FK to quotes
ALTER TABLE public.quotes ADD COLUMN highlight_id UUID REFERENCES public.sermon_highlights(id) ON DELETE SET NULL;

-- Add extracting_highlights to valid project statuses
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('uploading', 'processing', 'downloading', 'extracting_audio', 'transcribing', 'analyzing', 'extracting_highlights', 'ready', 'error', 'completed', 'failed', 'cancelled', 'cancelling'));
```

**Step 2: Apply the migration**

Run: `cd /Users/bertwinromero/Documents/work/mindnistry/sermonclip && npx supabase db reset` or `npx supabase migration up`
Expected: Migration applied successfully.

**Step 3: Verify the table exists**

Run: `curl -s "http://127.0.0.1:54421/rest/v1/sermon_highlights" -H "apikey: <service_key>" -H "Authorization: Bearer <service_key>"`
Expected: `[]` (empty array, table exists)

**Step 4: Commit**

```bash
git add supabase/migrations/20260623100000_add_sermon_highlights.sql
git commit -m "feat: add sermon_highlights table and migration"
```

---

### Task 2: Highlight Extraction Service

**Files:**
- Create: `backend/services/highlight_service.py`

**Step 1: Create the highlight extraction service**

This service calls Ollama with the full transcript + timestamps and asks it to identify complete thought arcs at 3 duration tiers.

```python
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Optional

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
        # Build timestamped transcript
        transcript_lines = []
        for seg in segments:
            time_label = self._format_time(seg["start"])
            transcript_lines.append(f"[{time_label}] {seg['text']}")

        transcript_text = "\n".join(transcript_lines)

        # Build quotes reference
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
        # Try to extract JSON array from response
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
```

**Step 2: Verify the file was created**

Run: `python3 -c "from services.highlight_service import HighlightService; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/services/highlight_service.py
git commit -m "feat: add HighlightService for sermon highlight extraction"
```

---

### Task 3: Integrate Highlights into Processing Pipeline

**Files:**
- Modify: `backend/routers/process.py` (lines 59-231)

**Step 1: Add the extract_highlights step to the pipeline**

After the quote extraction block (line ~208), add:

```python
# After saving quotes to database...

# Extract sermon highlights
from services.highlight_service import HighlightService

# Update status: extracting highlights
supabase.table("projects").update({
    "status": "extracting_highlights"
}).eq("id", project_id).execute()

highlight_service = HighlightService()
# Prepare quotes data for highlight extraction
quote_dicts = [
    {"text": q.text, "start_time": q.start_time, "end_time": q.end_time}
    for q in quotes
]
# Prepare segments data
segment_dicts = [
    {"start": seg.start, "end": seg.end, "text": seg.text}
    for seg in transcript.segments
]

highlights = await asyncio.to_thread(
    highlight_service.extract_highlights, segment_dicts, quote_dicts
)

# Save highlights to database
for highlight in highlights:
    supabase.table("sermon_highlights").insert({
        "project_id": project_id,
        "church_id": church_id,
        "title": highlight.title,
        "transcript_excerpt": highlight.transcript_excerpt,
        "quote_text": highlight.quote_text,
        "start_time": highlight.start_time,
        "end_time": highlight.end_time,
        "duration_tier": highlight.duration_tier,
    }).execute()
```

**Step 2: Update the StatusResponse model and status endpoint**

Add `highlights_count` to the `StatusResponse` model:

```python
class StatusResponse(BaseModel):
    project_id: str
    status: str
    video_url: Optional[str] = None
    transcript_id: Optional[str] = None
    quotes_count: int = 0
    highlights_count: int = 0  # ADD THIS
    progress_percent: Optional[int] = None
    progress_message: Optional[str] = None
```

In `get_processing_status`, add highlight count query after the quotes count:

```python
# Get highlight count
highlights_result = supabase.table("sermon_highlights").select("id", count="exact").eq("project_id", project_id).execute()
highlights_count = highlights_result.count or 0
```

And add `highlights_count=highlights_count` to the returned `StatusResponse`.

**Step 3: Add "extracting_highlights" to the stuck detection list**

In `get_processing_status` (line 290), add `"extracting_highlights"` to `stuck_statuses`:

```python
stuck_statuses = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights"]
```

**Step 4: Update `ProcessingProgress.tsx` to handle the new status**

In `frontend/src/components/projects/ProcessingProgress.tsx`, add `"extracting_highlights"` to the status label map and the `isProcessing` check in the project page.

In `frontend/src/app/(dashboard)/projects/[id]/page.tsx` line 72:
```typescript
const isProcessing = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights", "cancelling"].includes(project.status);
```

**Step 5: Verify pipeline runs end-to-end**

Run: `curl -s -X POST http://localhost:8000/process/project/<test_project_id>`
Expected: Processing completes with highlights in database.

**Step 6: Commit**

```bash
git add backend/routers/process.py frontend/src/components/projects/ProcessingProgress.tsx frontend/src/app/\(dashboard\)/projects/\[id\]/page.tsx
git commit -m "feat: add highlight extraction step to processing pipeline"
```

---

### Task 4: Highlight Clip API Endpoint

**Files:**
- Modify: `backend/routers/clip.py`

**Step 1: Add highlight clip endpoint**

Add a new endpoint after the existing `generate_quote_clip`:

```python
@router.post("/highlight/{highlight_id}", response_model=ClipResponse)
async def generate_highlight_clip(highlight_id: str):
    """Generate a video clip for a sermon highlight."""
    if not FFmpegService.is_ffmpeg_available():
        raise HTTPException(status_code=500, detail="FFmpeg is not installed")

    supabase = get_supabase()

    # Fetch highlight
    highlight_result = supabase.table("sermon_highlights").select("*").eq("id", highlight_id).single().execute()
    if not highlight_result.data:
        raise HTTPException(status_code=404, detail="Highlight not found")

    highlight = highlight_result.data

    # Fetch project for video URL
    project_result = supabase.table("projects").select("video_url").eq("id", highlight["project_id"]).single().execute()
    if not project_result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    video_url = project_result.data.get("video_url", "")
    if not video_url:
        raise HTTPException(status_code=500, detail="Video unavailable")

    start_time = float(highlight["start_time"])
    end_time = float(highlight["end_time"])
    duration = end_time - start_time

    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid highlight time range")

    try:
        clip_service = ClipService()
        mp4_bytes = clip_service.generate_quote_clip(
            video_url=video_url,
            start_time=start_time,
            end_time=end_time,
            quote_text=highlight["quote_text"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Clip generation failed for highlight {highlight_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Clip generation failed")

    base64_video = base64.b64encode(mp4_bytes).decode("utf-8")
    data_url = f"data:video/mp4;base64,{base64_video}"

    slug = slugify(highlight["title"][:50])
    filename = f"clip-{slug}.mp4"

    return ClipResponse(
        video=data_url,
        quote_id=highlight_id,
        filename=filename,
        duration=duration,
    )
```

**Step 2: Verify endpoint works**

Run: `curl -s -X POST "http://localhost:8000/clip/highlight/<highlight_id>" -w "\nHTTP: %{http_code}"`
Expected: HTTP 200 with base64 video response

**Step 3: Commit**

```bash
git add backend/routers/clip.py
git commit -m "feat: add highlight clip generation endpoint"
```

---

### Task 5: Frontend — HighlightCard Component

**Files:**
- Create: `frontend/src/components/projects/HighlightCard.tsx`

**Step 1: Create the HighlightCard component**

Based on the existing `QuoteCard.tsx` pattern but adapted for highlights:

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Image, Video, Clock } from "lucide-react";
import { toast } from "sonner";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { ClipPreviewModal } from "./ClipPreviewModal";

interface HighlightCardProps {
  highlight: {
    id: string;
    title: string;
    transcript_excerpt: string;
    quote_text: string;
    start_time: number;
    end_time: number;
    duration_tier: string;
  };
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

const TIER_LABELS: Record<string, string> = {
  short: "~30s",
  medium: "~1 min",
  long: "~1:30",
};

const API_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

export function HighlightCard({ highlight }: HighlightCardProps) {
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageFilename, setImageFilename] = useState("quote.png");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const [showClipModal, setShowClipModal] = useState(false);
  const [clipData, setClipData] = useState<string | null>(null);
  const [clipFilename, setClipFilename] = useState("clip.mp4");
  const [clipDuration, setClipDuration] = useState(0);
  const [isGeneratingClip, setIsGeneratingClip] = useState(false);

  const duration = highlight.end_time - highlight.start_time;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(highlight.quote_text);
    toast.success("Quote copied to clipboard");
  };

  const generateImage = async () => {
    setIsGeneratingImage(true);
    setShowImageModal(true);
    try {
      const response = await fetch(`${API_URL}/image/highlight/${highlight.id}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to generate image");
      const data = await response.json();
      setImageData(data.image);
      setImageFilename(data.filename);
    } catch {
      toast.error("Failed to generate image");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleImageClick = () => {
    if (imageData) setShowImageModal(true);
    else generateImage();
  };

  const generateClip = async () => {
    setIsGeneratingClip(true);
    setShowClipModal(true);
    try {
      const response = await fetch(`${API_URL}/clip/highlight/${highlight.id}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to generate clip");
      const data = await response.json();
      setClipData(data.video);
      setClipFilename(data.filename);
      setClipDuration(data.duration);
    } catch {
      toast.error("Failed to generate clip");
    } finally {
      setIsGeneratingClip(false);
    }
  };

  const handleClipClick = () => {
    if (clipData) setShowClipModal(true);
    else generateClip();
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-2 mb-3">
            <h3 className="font-semibold text-base">{highlight.title}</h3>
            <Badge variant="secondary" className="shrink-0">
              {formatDuration(duration)}
            </Badge>
          </div>
          <blockquote className="text-sm italic text-muted-foreground border-l-4 border-primary pl-3">
            &quot;{highlight.quote_text}&quot;
          </blockquote>
        </CardContent>
        <CardFooter className="flex justify-between items-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              {formatTime(highlight.start_time)} - {formatTime(highlight.end_time)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImageClick}
              disabled={isGeneratingImage}
            >
              <Image className={`h-4 w-4 mr-1 ${isGeneratingImage ? "animate-pulse" : ""}`} />
              Image
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClipClick}
              disabled={isGeneratingClip}
            >
              <Video className={`h-4 w-4 mr-1 ${isGeneratingClip ? "animate-pulse" : ""}`} />
              Clip
            </Button>
          </div>
        </CardFooter>
      </Card>

      <ImagePreviewModal
        open={showImageModal}
        onOpenChange={setShowImageModal}
        imageData={imageData}
        filename={imageFilename}
        isLoading={isGeneratingImage}
        onRegenerate={generateImage}
      />

      <ClipPreviewModal
        open={showClipModal}
        onOpenChange={setShowClipModal}
        videoData={clipData}
        filename={clipFilename}
        duration={clipDuration}
        isLoading={isGeneratingClip}
        onRegenerate={generateClip}
      />
    </>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/projects/HighlightCard.tsx
git commit -m "feat: add HighlightCard component"
```

---

### Task 6: Frontend — Replace Quotes with Sermon Highlights on Project Page

**Files:**
- Modify: `frontend/src/app/(dashboard)/projects/[id]/page.tsx`

**Step 1: Update the project page**

Replace the quotes section with sermon highlights grouped by duration tier:

1. Import `HighlightCard` instead of `QuoteCard`
2. Query `sermon_highlights` table instead of `quotes`
3. Group highlights by `duration_tier` and render in sections

Changes to `page.tsx`:

```tsx
// Replace QuoteCard import with:
import { HighlightCard } from "@/components/projects/HighlightCard";

// Replace the quotes query (lines 66-70) with:
const { data: highlights } = await supabase
  .from("sermon_highlights")
  .select("*")
  .eq("project_id", id)
  .order("start_time", { ascending: true });

// Group highlights by tier
const shortHighlights = highlights?.filter((h) => h.duration_tier === "short") || [];
const mediumHighlights = highlights?.filter((h) => h.duration_tier === "medium") || [];
const longHighlights = highlights?.filter((h) => h.duration_tier === "long") || [];
const hasHighlights = (highlights?.length ?? 0) > 0;

// Replace the Quotes Section JSX (lines 137-149) with:
{hasHighlights && (
  <div className="space-y-6">
    <h2 className="text-xl font-semibold">Sermon Highlights</h2>

    {shortHighlights.length > 0 && (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Short (~30s)</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {shortHighlights.map((h) => (
            <HighlightCard key={h.id} highlight={h} />
          ))}
        </div>
      </div>
    )}

    {mediumHighlights.length > 0 && (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Medium (~1 min)</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {mediumHighlights.map((h) => (
            <HighlightCard key={h.id} highlight={h} />
          ))}
        </div>
      </div>
    )}

    {longHighlights.length > 0 && (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Long (~1:30)</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {longHighlights.map((h) => (
            <HighlightCard key={h.id} highlight={h} />
          ))}
        </div>
      </div>
    )}
  </div>
)}
```

**Step 2: Verify the page renders correctly**

Open: `http://localhost:3000/projects/<project_id>`
Expected: Sermon Highlights section with cards grouped by duration tier.

**Step 3: Commit**

```bash
git add frontend/src/app/\(dashboard\)/projects/\[id\]/page.tsx
git commit -m "feat: replace quotes section with sermon highlights on project page"
```

---

### Task 7: Image Generation for Highlights

**Files:**
- Modify: `backend/routers/image.py` (or wherever image generation lives)

**Step 1: Find the image endpoint**

Check: `grep -r "image/quote" backend/routers/`

**Step 2: Add highlight image endpoint**

Add a `POST /image/highlight/{highlight_id}` endpoint that fetches the highlight's `quote_text` and generates an image using the same logic as the quote image endpoint.

**Step 3: Verify endpoint**

Run: `curl -s -X POST "http://localhost:8000/image/highlight/<highlight_id>" -w "\nHTTP: %{http_code}"`
Expected: HTTP 200 with base64 image

**Step 4: Commit**

```bash
git add backend/routers/image.py
git commit -m "feat: add highlight image generation endpoint"
```

---

### Task 8: End-to-End Test

**Step 1: Re-process a project to generate highlights**

Run: `curl -s -X POST http://localhost:8000/process/project/<project_id>`

**Step 2: Monitor progress**

Run: `curl -s http://localhost:8000/process/project/<project_id>/status`
Expected: Status progresses through `transcribing` -> `analyzing` -> `extracting_highlights` -> `completed`

**Step 3: Verify highlights in database**

Run: `curl -s "http://127.0.0.1:54421/rest/v1/sermon_highlights?project_id=eq.<project_id>" -H "apikey: <key>" -H "Authorization: Bearer <key>"`
Expected: JSON array of highlights with short/medium/long tiers

**Step 4: Verify frontend**

Open: `http://localhost:3000/projects/<project_id>`
Expected: Sermon Highlights section with grouped cards, working Copy/Image/Clip buttons

**Step 5: Test clip generation**

Click "Clip" on a highlight card.
Expected: Video clip preview modal with correct duration.

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: end-to-end adjustments for sermon highlights"
```
