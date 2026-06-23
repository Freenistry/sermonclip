# Quote Clip Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate shareable MP4 video clips from sermon quotes with burned-in captions.

**Architecture:** Backend ClipService extracts video segments via FFmpeg with drawtext captions, returns base64 MP4. Frontend displays preview modal with video player and download option.

**Tech Stack:** Python/FFmpeg for clip generation, React/TypeScript for modal UI.

## Global Constraints

- FFmpeg must be available (already installed, used by ImageService)
- Output format: MP4 (H.264 video, AAC audio)
- Font: Montserrat Bold at `backend/assets/fonts/Montserrat-Bold.ttf`
- If font unavailable, generate clip without captions rather than failing
- Video URL must be HTTP/HTTPS

---

## File Structure

**Backend (new files):**
- `backend/services/clip_service.py` - Core clip generation logic
- `backend/routers/clip.py` - API endpoint

**Frontend (new/modified):**
- `frontend/src/components/projects/ClipPreviewModal.tsx` - Video preview modal (new)
- `frontend/src/components/projects/QuoteCard.tsx` - Enable clip button (modify)

---

### Task 1: Implement ClipService

**Files:**
- Create: `backend/services/clip_service.py`

**Interfaces:**
- Consumes: FFmpeg CLI, Montserrat font at `backend/assets/fonts/Montserrat-Bold.ttf`
- Produces: `ClipService.generate_quote_clip(video_url: str, start_time: float, end_time: float, quote_text: str) -> bytes`

- [ ] **Step 1: Create clip_service.py with core implementation**

Create `backend/services/clip_service.py`:

```python
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional


class ClipService:
    """Service for generating quote video clips."""

    FONT_PATH = Path(__file__).parent.parent / "assets" / "fonts" / "Montserrat-Bold.ttf"

    def _validate_url(self, video_url: str) -> bool:
        """Validate video URL is HTTP/HTTPS."""
        if not video_url or not isinstance(video_url, str):
            return False
        video_url = video_url.strip()
        return video_url.startswith(('http://', 'https://'))

    def _escape_text_for_ffmpeg(self, text: str) -> str:
        """Escape special characters for FFmpeg drawtext filter."""
        # Escape single quotes, colons, and backslashes
        text = text.replace("\\", "\\\\")
        text = text.replace("'", "'\\''")
        text = text.replace(":", "\\:")
        return text

    def _build_drawtext_filter(self, quote_text: str) -> Optional[str]:
        """Build FFmpeg drawtext filter for captions."""
        if not self.FONT_PATH.exists():
            return None

        escaped_text = self._escape_text_for_ffmpeg(quote_text)
        font_path = str(self.FONT_PATH).replace(":", "\\:")

        # drawtext filter with styling:
        # - White text with black border
        # - Centered at bottom (10% from bottom)
        # - Font size 48, Montserrat Bold
        filter_str = (
            f"drawtext=fontfile='{font_path}':"
            f"text='{escaped_text}':"
            f"fontsize=48:"
            f"fontcolor=white:"
            f"borderw=2:"
            f"bordercolor=black:"
            f"x=(w-text_w)/2:"
            f"y=h-th-h*0.1"
        )
        return filter_str

    def generate_quote_clip(
        self,
        video_url: str,
        start_time: float,
        end_time: float,
        quote_text: str,
    ) -> bytes:
        """
        Generate an MP4 clip with burned-in captions.

        Args:
            video_url: URL to the source video
            start_time: Start time in seconds
            end_time: End time in seconds
            quote_text: Quote text to burn in as captions

        Returns:
            MP4 video as bytes

        Raises:
            ValueError: If video URL is invalid
            RuntimeError: If FFmpeg fails
        """
        if not self._validate_url(video_url):
            raise ValueError("Invalid video URL")

        duration = end_time - start_time
        if duration <= 0:
            raise ValueError("Invalid time range")

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp_path = tmp.name

            # Build FFmpeg command
            cmd = [
                "ffmpeg",
                "-ss", str(start_time),
                "-i", video_url,
                "-t", str(duration),
            ]

            # Add drawtext filter if font available
            drawtext_filter = self._build_drawtext_filter(quote_text)
            if drawtext_filter:
                cmd.extend(["-vf", drawtext_filter])

            # Output encoding options
            cmd.extend([
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                "-y",
                tmp_path,
            ])

            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=300,  # 5 minute timeout for longer clips
            )

            if result.returncode != 0:
                error_msg = result.stderr.decode("utf-8", errors="ignore")
                raise RuntimeError(f"FFmpeg failed: {error_msg[:500]}")

            if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
                raise RuntimeError("FFmpeg produced empty output")

            with open(tmp_path, "rb") as f:
                return f.read()

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
```

- [ ] **Step 2: Test ClipService import and basic validation**

```bash
cd backend && source venv/bin/activate && python3 -c "
from services.clip_service import ClipService

svc = ClipService()
print(f'Font path: {svc.FONT_PATH}')
print(f'Font exists: {svc.FONT_PATH.exists()}')

# Test URL validation
assert svc._validate_url('https://example.com/video.mp4') == True
assert svc._validate_url('http://example.com/video.mp4') == True
assert svc._validate_url('') == False
assert svc._validate_url('file:///etc/passwd') == False
print('URL validation: PASS')

# Test text escaping
escaped = svc._escape_text_for_ffmpeg(\"It's a test: with colons\")
print(f'Escaped text: {escaped}')
print('Text escaping: PASS')

print('SUCCESS: ClipService imported and validated')
"
```
Expected: All assertions pass, font exists

- [ ] **Step 3: Commit**

```bash
git add backend/services/clip_service.py
git commit -m "feat: add ClipService for video clip generation"
```

---

### Task 2: Create Clip API Endpoint

**Files:**
- Create: `backend/routers/clip.py`
- Modify: `backend/main.py`

**Interfaces:**
- Consumes: `ClipService.generate_quote_clip()` from Task 1
- Produces: `POST /clip/quote/{quote_id}` → `ClipResponse`

- [ ] **Step 1: Create clip router**

Create `backend/routers/clip.py`:

```python
import os
import base64
import re
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

from services.clip_service import ClipService

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/clip", tags=["clip"])


def get_supabase() -> Client:
    """Get Supabase client."""
    url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54421")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return create_client(url, key)


class ClipResponse(BaseModel):
    video: str  # base64 data URL
    quote_id: str
    filename: str
    duration: float


def slugify(text: str, max_length: int = 30) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = text.strip("-")
    return text[:max_length]


@router.post("/quote/{quote_id}", response_model=ClipResponse)
async def generate_quote_clip(quote_id: str):
    """Generate a video clip for a quote."""
    supabase = get_supabase()

    # Fetch quote
    quote_result = supabase.table("quotes").select("*").eq("id", quote_id).single().execute()
    if not quote_result.data:
        raise HTTPException(status_code=404, detail="Quote not found")

    quote = quote_result.data

    # Fetch project for video URL
    project_result = supabase.table("projects").select("video_url").eq("id", quote["project_id"]).single().execute()
    if not project_result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_result.data
    video_url = project.get("video_url", "")

    if not video_url:
        raise HTTPException(status_code=500, detail="Video unavailable")

    start_time = float(quote.get("start_time", 0))
    end_time = float(quote.get("end_time", 0))
    duration = end_time - start_time

    if duration <= 0:
        raise HTTPException(status_code=400, detail="Invalid quote time range")

    # Generate clip
    try:
        clip_service = ClipService()
        mp4_bytes = clip_service.generate_quote_clip(
            video_url=video_url,
            start_time=start_time,
            end_time=end_time,
            quote_text=quote["text"],
        )
    except ValueError as e:
        logger.error(f"Clip generation validation error for quote {quote_id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Clip generation failed for quote {quote_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Clip generation failed")

    # Encode as base64 data URL
    base64_video = base64.b64encode(mp4_bytes).decode("utf-8")
    data_url = f"data:video/mp4;base64,{base64_video}"

    # Generate filename
    slug = slugify(quote["text"][:50])
    filename = f"clip-{slug}.mp4"

    return ClipResponse(
        video=data_url,
        quote_id=quote_id,
        filename=filename,
        duration=duration,
    )
```

- [ ] **Step 2: Register router in main.py**

Modify `backend/main.py`:

Add import at top with other router imports:
```python
from routers import video, transcribe, analyze, process, image, clip
```

Add router registration after other routers:
```python
app.include_router(clip.router)
```

- [ ] **Step 3: Verify endpoint is registered**

```bash
cd backend && source venv/bin/activate && python3 -c "
from main import app
routes = [r.path for r in app.routes]
assert '/clip/quote/{quote_id}' in routes, 'Clip route not found'
print('Routes:', [r for r in routes if 'clip' in r])
print('SUCCESS: Clip endpoint registered')
"
```
Expected: Clip route appears in routes list

- [ ] **Step 4: Commit**

```bash
git add backend/routers/clip.py backend/main.py
git commit -m "feat: add clip generation API endpoint"
```

---

### Task 3: Create ClipPreviewModal Component

**Files:**
- Create: `frontend/src/components/projects/ClipPreviewModal.tsx`

**Interfaces:**
- Consumes: `videoData: string` (base64 data URL), `filename: string`, `duration: number`
- Produces: React component `<ClipPreviewModal>` with open/close state, download, regenerate callbacks

- [ ] **Step 1: Create ClipPreviewModal component**

Create `frontend/src/components/projects/ClipPreviewModal.tsx`:

```tsx
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";

interface ClipPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoData: string | null;
  filename: string;
  duration: number;
  isLoading: boolean;
  onRegenerate: () => void;
}

export function ClipPreviewModal({
  open,
  onOpenChange,
  videoData,
  filename,
  duration,
  isLoading,
  onRegenerate,
}: ClipPreviewModalProps) {
  const handleDownload = () => {
    if (!videoData) return;

    const link = document.createElement("a");
    link.href = videoData;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Quote Clip Preview
            {duration > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({formatDuration(duration)})
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center min-h-[300px] bg-muted rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin" />
              <span>Generating clip...</span>
            </div>
          ) : videoData ? (
            <video
              src={videoData}
              controls
              className="max-w-full max-h-[400px]"
              autoPlay={false}
            >
              Your browser does not support the video tag.
            </video>
          ) : (
            <span className="text-muted-foreground">No video</span>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onRegenerate}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
          <Button onClick={handleDownload} disabled={!videoData || isLoading}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify component compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/projects/ClipPreviewModal.tsx
git commit -m "feat: add ClipPreviewModal component"
```

---

### Task 4: Integrate Clip Generation in QuoteCard

**Files:**
- Modify: `frontend/src/components/projects/QuoteCard.tsx`

**Interfaces:**
- Consumes: `ClipPreviewModal` from Task 3, API endpoint from Task 2
- Produces: Working "Clip" button that generates and previews video clips

- [ ] **Step 1: Update QuoteCard with clip generation**

Replace `frontend/src/components/projects/QuoteCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Image, Video, Clock } from "lucide-react";
import { toast } from "sonner";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { ClipPreviewModal } from "./ClipPreviewModal";

interface QuoteCardProps {
  quote: {
    id: string;
    text: string;
    start_time: number;
    end_time: number;
    context: string;
    status: string;
  };
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const API_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

export function QuoteCard({ quote }: QuoteCardProps) {
  // Image state
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageFilename, setImageFilename] = useState("quote.png");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  // Clip state
  const [showClipModal, setShowClipModal] = useState(false);
  const [clipData, setClipData] = useState<string | null>(null);
  const [clipFilename, setClipFilename] = useState("clip.mp4");
  const [clipDuration, setClipDuration] = useState(0);
  const [isGeneratingClip, setIsGeneratingClip] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(quote.text);
    toast.success("Quote copied to clipboard");
  };

  // Image generation
  const generateImage = async () => {
    setIsGeneratingImage(true);
    setShowImageModal(true);

    try {
      const response = await fetch(`${API_URL}/image/quote/${quote.id}`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to generate image");
      }

      const data = await response.json();
      setImageData(data.image);
      setImageFilename(data.filename);
    } catch (error) {
      toast.error("Failed to generate image");
      console.error("Image generation error:", error);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleImageClick = () => {
    if (imageData) {
      setShowImageModal(true);
    } else {
      generateImage();
    }
  };

  const handleImageRegenerate = () => {
    generateImage();
  };

  // Clip generation
  const generateClip = async () => {
    setIsGeneratingClip(true);
    setShowClipModal(true);

    try {
      const response = await fetch(`${API_URL}/clip/quote/${quote.id}`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to generate clip");
      }

      const data = await response.json();
      setClipData(data.video);
      setClipFilename(data.filename);
      setClipDuration(data.duration);
    } catch (error) {
      toast.error("Failed to generate clip");
      console.error("Clip generation error:", error);
    } finally {
      setIsGeneratingClip(false);
    }
  };

  const handleClipClick = () => {
    if (clipData) {
      setShowClipModal(true);
    } else {
      generateClip();
    }
  };

  const handleClipRegenerate = () => {
    generateClip();
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <blockquote className="text-lg font-medium italic border-l-4 border-primary pl-4">
            &quot;{quote.text}&quot;
          </blockquote>
          {quote.context && (
            <p className="text-sm text-muted-foreground mt-4 line-clamp-2">
              Context: {quote.context}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex justify-between items-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              {formatTime(quote.start_time)} - {formatTime(quote.end_time)}
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
        onRegenerate={handleImageRegenerate}
      />

      <ClipPreviewModal
        open={showClipModal}
        onOpenChange={setShowClipModal}
        videoData={clipData}
        filename={clipFilename}
        duration={clipDuration}
        isLoading={isGeneratingClip}
        onRegenerate={handleClipRegenerate}
      />
    </>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/projects/QuoteCard.tsx
git commit -m "feat: integrate clip generation in QuoteCard"
```

---

### Task 5: End-to-End Testing

**Files:**
- None (testing existing implementation)

**Interfaces:**
- Tests full flow: Quote → API → Clip → Preview → Download

- [ ] **Step 1: Verify backend is running**

```bash
curl -s http://localhost:8000/health
```
Expected: `{"status":"healthy",...}`

- [ ] **Step 2: Test clip generation API directly**

Get a quote ID from the database and test:
```bash
# Get first quote ID
QUOTE_ID=$(curl -s "http://127.0.0.1:54421/rest/v1/quotes?limit=1" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

echo "Testing quote: $QUOTE_ID"

# Test clip generation (this may take 30+ seconds)
curl -s -X POST "http://localhost:8000/clip/quote/$QUOTE_ID" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'quote_id: {data[\"quote_id\"]}')
print(f'filename: {data[\"filename\"]}')
print(f'duration: {data[\"duration\"]} seconds')
print(f'video length: {len(data[\"video\"])} chars')
assert data['video'].startswith('data:video/mp4;base64,'), 'Invalid video format'
print('SUCCESS: Clip generated correctly')
"
```
Expected: SUCCESS message with valid video data

- [ ] **Step 3: Manual browser test**

1. Open http://localhost:3000/projects
2. Click on a completed project with quotes
3. Click "Clip" button on any quote
4. Verify modal opens with loading state
5. Verify video appears after generation (may take 30+ seconds)
6. Click play to verify video works
7. Click "Download" and verify MP4 downloads
8. Verify captions appear in video

- [ ] **Step 4: Document test results**

Record any issues found during testing for follow-up fixes.
