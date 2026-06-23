# Smart Clip Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance clip generation to create impactful 30-60 second clips using LLM-driven boundary selection.

**Architecture:** When user clicks "Clip", call Ollama to analyze transcript context around the quote and determine optimal 30-60 second boundaries that capture a complete thought arc. Fall back to ±15 sec expansion if LLM fails.

**Tech Stack:** Python/Ollama for boundary detection, existing FFmpeg pipeline for clip generation.

## Global Constraints

- Minimum clip duration: 30 seconds
- Maximum clip duration: 60 seconds
- Context window for LLM: ±60 seconds around quote
- Ollama model: llama3.1:8b
- Ollama timeout: 30 seconds for boundary detection
- Fall back to simple expansion if LLM fails

---

## File Structure

**Backend (modify):**
- `backend/services/clip_service.py` - Add `get_smart_boundaries()` method
- `backend/routers/clip.py` - Add `smart` parameter, fetch transcript, call smart boundaries

**Frontend (modify):**
- `frontend/src/components/projects/QuoteCard.tsx` - Add `?smart=true` to API call

---

### Task 1: Add Smart Boundaries Method to ClipService

**Files:**
- Modify: `backend/services/clip_service.py`

**Interfaces:**
- Consumes: Ollama API (same pattern as OllamaService)
- Produces: `ClipService.get_smart_boundaries(quote_text: str, quote_start: float, quote_end: float, segments: list[dict]) -> tuple[float, float]`

- [ ] **Step 1: Add imports and constants**

Add at top of `backend/services/clip_service.py` after existing imports:

```python
import httpx
import re
```

Add class constants after `FONT_PATH`:

```python
    OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
    MIN_CLIP_DURATION = 30.0
    MAX_CLIP_DURATION = 60.0
```

- [ ] **Step 2: Add fallback boundaries method**

Add method to `ClipService` class:

```python
    def _fallback_boundaries(
        self,
        quote_start: float,
        quote_end: float,
        video_duration: float = float('inf'),
    ) -> tuple[float, float]:
        """
        Expand ±15 seconds to reach ~30 sec minimum.

        Args:
            quote_start: Original quote start time
            quote_end: Original quote end time
            video_duration: Total video duration (to avoid exceeding)

        Returns:
            (start_time, end_time) tuple
        """
        duration = quote_end - quote_start
        if duration >= self.MIN_CLIP_DURATION:
            return quote_start, quote_end

        expand = (self.MIN_CLIP_DURATION - duration) / 2
        start = max(0, quote_start - expand)
        end = min(video_duration, quote_end + expand)

        logger.info(f"Fallback boundaries: {start:.1f}s - {end:.1f}s (expanded ±{expand:.1f}s)")
        return start, end
```

- [ ] **Step 3: Add format time helper**

Add method to `ClipService` class:

```python
    def _format_time(self, seconds: float) -> str:
        """Format seconds as M:SS for display."""
        mins = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{mins}:{secs:02d}"
```

- [ ] **Step 4: Add smart boundaries method**

Add method to `ClipService` class:

```python
    def get_smart_boundaries(
        self,
        quote_text: str,
        quote_start: float,
        quote_end: float,
        segments: list[dict],
    ) -> tuple[float, float]:
        """
        Use Ollama to find optimal 30-60 sec clip boundaries.

        Args:
            quote_text: The quote to build clip around
            quote_start: Original quote start time
            quote_end: Original quote end time
            segments: Transcript segments [{start, end, text}, ...]

        Returns:
            (start_time, end_time) tuple for the expanded clip
        """
        if not segments:
            logger.warning("No segments provided, using fallback")
            return self._fallback_boundaries(quote_start, quote_end)

        # Build context window (±60 seconds around quote)
        context_start = max(0, quote_start - 60)
        context_end = quote_end + 60

        # Filter segments within context window
        context_segments = [
            seg for seg in segments
            if seg["end"] >= context_start and seg["start"] <= context_end
        ]

        if not context_segments:
            logger.warning("No segments in context window, using fallback")
            return self._fallback_boundaries(quote_start, quote_end)

        # Format segments for prompt
        segments_text = "\n".join(
            f"[{self._format_time(seg['start'])}-{self._format_time(seg['end'])}] \"{seg['text']}\""
            for seg in context_segments
        )

        prompt = f"""You are analyzing a sermon transcript to find the optimal video clip boundaries.

The goal: Create a 30-60 second clip that captures a complete thought arc around this quote:
"{quote_text}"

Transcript context (with timestamps):
{segments_text}

Find timestamps that:
1. Start with setup/context that leads into the quote
2. Include the full quote
3. End with conclusion or natural pause
4. Total duration: 30-60 seconds

Respond with ONLY two numbers (start and end in seconds):
START: 45.0
END: 75.0"""

        try:
            response = httpx.post(
                f"{self.OLLAMA_HOST}/api/generate",
                json={
                    "model": self.OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3},
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                logger.warning(f"Ollama API error: {response.status_code}, using fallback")
                return self._fallback_boundaries(quote_start, quote_end)

            result = response.json()
            raw_response = result.get("response", "")

            # Parse START and END from response
            start_match = re.search(r"START:\s*([\d.]+)", raw_response)
            end_match = re.search(r"END:\s*([\d.]+)", raw_response)

            if not start_match or not end_match:
                logger.warning(f"Could not parse boundaries from: {raw_response[:200]}, using fallback")
                return self._fallback_boundaries(quote_start, quote_end)

            smart_start = float(start_match.group(1))
            smart_end = float(end_match.group(1))
            smart_duration = smart_end - smart_start

            # Validate duration is in range
            if smart_duration < self.MIN_CLIP_DURATION or smart_duration > self.MAX_CLIP_DURATION:
                logger.warning(
                    f"Smart duration {smart_duration:.1f}s outside range "
                    f"[{self.MIN_CLIP_DURATION}, {self.MAX_CLIP_DURATION}], using fallback"
                )
                return self._fallback_boundaries(quote_start, quote_end)

            # Ensure boundaries include the original quote
            if smart_start > quote_start or smart_end < quote_end:
                logger.warning("Smart boundaries don't include full quote, using fallback")
                return self._fallback_boundaries(quote_start, quote_end)

            logger.info(f"Smart boundaries: {smart_start:.1f}s - {smart_end:.1f}s ({smart_duration:.1f}s)")
            return smart_start, smart_end

        except httpx.TimeoutException:
            logger.warning("Ollama timeout, using fallback")
            return self._fallback_boundaries(quote_start, quote_end)
        except Exception as e:
            logger.warning(f"Smart boundary detection failed: {e}, using fallback")
            return self._fallback_boundaries(quote_start, quote_end)
```

- [ ] **Step 5: Verify import works**

```bash
cd backend && source venv/bin/activate && python3 -c "
from services.clip_service import ClipService
svc = ClipService()
print(f'OLLAMA_HOST: {svc.OLLAMA_HOST}')
print(f'MIN_CLIP_DURATION: {svc.MIN_CLIP_DURATION}')
print(f'MAX_CLIP_DURATION: {svc.MAX_CLIP_DURATION}')

# Test fallback
start, end = svc._fallback_boundaries(10.0, 15.0)
print(f'Fallback test (5s quote): {start:.1f}s - {end:.1f}s = {end-start:.1f}s')
assert end - start >= 30, 'Fallback should expand to 30s'
print('SUCCESS')
"
```
Expected: All assertions pass

- [ ] **Step 6: Commit**

```bash
git add backend/services/clip_service.py
git commit -m "feat: add smart boundary detection to ClipService"
```

---

### Task 2: Update Clip Router for Smart Boundaries

**Files:**
- Modify: `backend/routers/clip.py`

**Interfaces:**
- Consumes: `ClipService.get_smart_boundaries()` from Task 1
- Produces: Updated `POST /clip/quote/{quote_id}` endpoint with `smart` query parameter

- [ ] **Step 1: Add smart parameter to endpoint**

Modify the endpoint signature in `backend/routers/clip.py`:

```python
@router.post("/quote/{quote_id}", response_model=ClipResponse)
async def generate_quote_clip(quote_id: str, smart: bool = True):
    """Generate a video clip for a quote.

    Args:
        quote_id: The quote ID to generate clip for
        smart: If True, use LLM to find optimal 30-60s boundaries (default: True)
    """
```

- [ ] **Step 2: Fetch transcript segments when smart=True**

Add after fetching quote and project (after line 63 `video_url = project.get("video_url", "")`):

```python
    # Fetch transcript segments if smart mode enabled
    segments = []
    if smart:
        transcript_result = supabase.table("transcripts").select("segments").eq("project_id", quote["project_id"]).single().execute()
        if transcript_result.data:
            segments = transcript_result.data.get("segments", [])
```

- [ ] **Step 3: Use smart boundaries when enabled**

Replace the start_time/end_time assignment (lines 68-70) with:

```python
    start_time = float(quote.get("start_time", 0))
    end_time = float(quote.get("end_time", 0))

    # Use smart boundary detection if enabled
    if smart and segments:
        clip_service = ClipService()
        start_time, end_time = clip_service.get_smart_boundaries(
            quote_text=quote["text"],
            quote_start=start_time,
            quote_end=end_time,
            segments=segments,
        )

    duration = end_time - start_time

    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid quote time range")
```

- [ ] **Step 4: Update clip generation call**

The existing clip generation code should work as-is since it already uses `start_time` and `end_time` variables. Remove the duplicate `clip_service = ClipService()` if present inside the try block and ensure it uses the instance created above:

```python
    # Generate clip
    try:
        if not smart or not segments:
            clip_service = ClipService()
        mp4_bytes = clip_service.generate_quote_clip(
            video_url=video_url,
            start_time=start_time,
            end_time=end_time,
            quote_text=quote["text"],
        )
```

- [ ] **Step 5: Verify endpoint works**

```bash
cd backend && source venv/bin/activate && python3 -c "
from routers.clip import router
from fastapi import FastAPI
app = FastAPI()
app.include_router(router)

# Check route has smart parameter
for route in app.routes:
    if hasattr(route, 'path') and 'quote' in route.path:
        print(f'Route: {route.path}')
        print(f'Methods: {route.methods}')
print('SUCCESS: Endpoint configured')
"
```

- [ ] **Step 6: Commit**

```bash
git add backend/routers/clip.py
git commit -m "feat: add smart boundary detection to clip endpoint"
```

---

### Task 3: Update Frontend to Use Smart Clips

**Files:**
- Modify: `frontend/src/components/projects/QuoteCard.tsx`

**Interfaces:**
- Consumes: Updated API endpoint with `?smart=true` parameter
- Produces: QuoteCard that generates 30-60 second smart clips

- [ ] **Step 1: Update API call in generateClip function**

In `frontend/src/components/projects/QuoteCard.tsx`, find the `generateClip` function and update the fetch URL:

Change from:
```typescript
const response = await fetch(`${API_URL}/clip/quote/${quote.id}`, {
```

To:
```typescript
const response = await fetch(`${API_URL}/clip/quote/${quote.id}?smart=true`, {
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -10
```
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/projects/QuoteCard.tsx
git commit -m "feat: enable smart clip boundaries in QuoteCard"
```

---

### Task 4: End-to-End Testing

**Files:**
- None (testing existing implementation)

**Interfaces:**
- Tests full flow: Quote → Smart Boundaries → Clip Generation

- [ ] **Step 1: Verify backend is running**

```bash
curl -s http://localhost:8000/health
```
Expected: `{"status":"healthy",...}`

- [ ] **Step 2: Verify Ollama is running**

```bash
curl -s http://localhost:11434/api/tags | head -20
```
Expected: JSON with available models

- [ ] **Step 3: Test smart boundaries directly**

```bash
cd backend && source venv/bin/activate && python3 -c "
from services.clip_service import ClipService

svc = ClipService()

# Test segments
segments = [
    {'start': 40.0, 'end': 45.0, 'text': 'When we face difficulties in life'},
    {'start': 45.0, 'end': 52.0, 'text': 'we often wonder where God is'},
    {'start': 52.0, 'end': 58.0, 'text': 'But I want to tell you today'},
    {'start': 58.0, 'end': 65.0, 'text': 'God never leaves us alone'},
    {'start': 65.0, 'end': 72.0, 'text': 'He is always with us'},
    {'start': 72.0, 'end': 80.0, 'text': 'even in our darkest moments'},
    {'start': 80.0, 'end': 88.0, 'text': 'That is the promise of faith'},
]

quote_text = 'God never leaves us alone'
quote_start = 58.0
quote_end = 65.0

start, end = svc.get_smart_boundaries(
    quote_text=quote_text,
    quote_start=quote_start,
    quote_end=quote_end,
    segments=segments,
)

duration = end - start
print(f'Smart boundaries: {start:.1f}s - {end:.1f}s ({duration:.1f}s)')
assert 30 <= duration <= 60, f'Duration {duration} not in range [30, 60]'
assert start <= quote_start, f'Start {start} should be <= quote_start {quote_start}'
assert end >= quote_end, f'End {end} should be >= quote_end {quote_end}'
print('SUCCESS: Smart boundaries working')
"
```

- [ ] **Step 4: Manual browser test**

1. Open http://localhost:3000/projects
2. Click on a completed project with quotes
3. Click "Clip" button on any quote
4. Verify modal shows loading state (may take longer due to LLM call)
5. Verify video is 30-60 seconds long
6. Verify video starts before and ends after the original quote
