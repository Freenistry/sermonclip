# Quote Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate shareable 1080x1080 social media images from sermon quotes with video frame backgrounds.

**Architecture:** Backend ImageService extracts video frames via FFmpeg, composites quote text using Pillow, returns base64 PNG. Frontend displays preview modal with download/regenerate options.

**Tech Stack:** Python/Pillow for image generation, FFmpeg for frame extraction, React/TypeScript for modal UI.

## Global Constraints

- Python 3.9+
- Pillow>=10.0.0
- Output format: 1080x1080 PNG
- Font: Montserrat Bold (bundled)
- Fallback: solid color #1a1a2e when video frame extraction fails

---

## File Structure

**Backend (new files):**
- `backend/services/image_service.py` - Core image generation logic
- `backend/routers/image.py` - API endpoint
- `backend/assets/fonts/Montserrat-Bold.ttf` - Bundled font

**Frontend (new/modified):**
- `frontend/src/components/projects/ImagePreviewModal.tsx` - Preview modal (new)
- `frontend/src/components/projects/QuoteCard.tsx` - Enable button, add modal (modify)

---

### Task 1: Add Pillow Dependency and Font Asset

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/assets/fonts/Montserrat-Bold.ttf`

**Interfaces:**
- Produces: Font file at `backend/assets/fonts/Montserrat-Bold.ttf` for ImageService

- [ ] **Step 1: Add Pillow to requirements.txt**

Add to `backend/requirements.txt`:
```
Pillow>=10.0.0
```

- [ ] **Step 2: Create assets directory and download font**

```bash
mkdir -p backend/assets/fonts
curl -L "https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Bold.ttf" -o backend/assets/fonts/Montserrat-Bold.ttf
```

- [ ] **Step 3: Install dependencies**

```bash
cd backend && source venv/bin/activate && pip install Pillow>=10.0.0
```

- [ ] **Step 4: Verify font file exists**

```bash
ls -la backend/assets/fonts/Montserrat-Bold.ttf
```
Expected: File exists, ~200KB

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/assets/fonts/Montserrat-Bold.ttf
git commit -m "chore: add Pillow dependency and Montserrat font"
```

---

### Task 2: Implement ImageService - Frame Extraction

**Files:**
- Create: `backend/services/image_service.py`

**Interfaces:**
- Consumes: FFmpeg CLI (already available)
- Produces: `ImageService.extract_frame(video_url: str, timestamp: float) -> Image | None`

- [ ] **Step 1: Create image_service.py with frame extraction**

Create `backend/services/image_service.py`:

```python
import os
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from PIL import Image


class ImageService:
    """Service for generating quote images."""

    IMAGE_SIZE = (1080, 1080)
    FONT_PATH = Path(__file__).parent.parent / "assets" / "fonts" / "Montserrat-Bold.ttf"

    def extract_frame(self, video_url: str, timestamp: float) -> Image.Image | None:
        """
        Extract a frame from video at the given timestamp.

        Args:
            video_url: URL to the video file
            timestamp: Time in seconds to extract frame

        Returns:
            PIL Image or None if extraction fails
        """
        try:
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                tmp_path = tmp.name

            cmd = [
                "ffmpeg",
                "-ss", str(timestamp),
                "-i", video_url,
                "-frames:v", "1",
                "-q:v", "2",
                "-y",
                tmp_path,
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=30,
            )

            if result.returncode != 0:
                return None

            if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 0:
                img = Image.open(tmp_path)
                img.load()  # Load into memory before deleting file
                os.unlink(tmp_path)
                return img

            return None

        except Exception:
            return None
        finally:
            if 'tmp_path' in locals() and os.path.exists(tmp_path):
                os.unlink(tmp_path)
```

- [ ] **Step 2: Test frame extraction manually**

```bash
cd backend && source venv/bin/activate && python -c "
from services.image_service import ImageService
svc = ImageService()
# Test with a sample video URL (this will fail without valid URL, but verifies import works)
print('ImageService imported successfully')
print(f'Font path: {svc.FONT_PATH}')
print(f'Font exists: {svc.FONT_PATH.exists()}')
"
```
Expected: Import succeeds, font path printed, font exists = True

- [ ] **Step 3: Commit**

```bash
git add backend/services/image_service.py
git commit -m "feat: add ImageService with frame extraction"
```

---

### Task 3: Implement ImageService - Image Composition

**Files:**
- Modify: `backend/services/image_service.py`

**Interfaces:**
- Consumes: `extract_frame()` from Task 2
- Produces: `ImageService.generate_quote_image(quote_text: str, video_url: str, timestamp: float, church_name: str, fallback_color: str) -> bytes`

- [ ] **Step 1: Add image composition methods**

Add to `backend/services/image_service.py` (append after existing code):

```python
from PIL import ImageDraw, ImageFont, ImageFilter


class ImageService:
    # ... existing code ...

    def _create_fallback_background(self, color: str) -> Image.Image:
        """Create a solid color background."""
        return Image.new("RGB", self.IMAGE_SIZE, color)

    def _resize_and_crop(self, img: Image.Image) -> Image.Image:
        """Resize and center-crop image to square."""
        # Calculate dimensions for center crop
        width, height = img.size
        min_dim = min(width, height)

        # Center crop to square
        left = (width - min_dim) // 2
        top = (height - min_dim) // 2
        right = left + min_dim
        bottom = top + min_dim

        img = img.crop((left, top, right, bottom))
        img = img.resize(self.IMAGE_SIZE, Image.Resampling.LANCZOS)
        return img

    def _apply_overlay(self, img: Image.Image) -> Image.Image:
        """Apply dark gradient overlay for text readability."""
        overlay = Image.new("RGBA", self.IMAGE_SIZE, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # Gradient from top (lighter) to bottom (darker)
        for y in range(self.IMAGE_SIZE[1]):
            # Alpha increases from 80 at top to 180 at bottom
            alpha = int(80 + (100 * y / self.IMAGE_SIZE[1]))
            draw.line([(0, y), (self.IMAGE_SIZE[0], y)], fill=(0, 0, 0, alpha))

        img = img.convert("RGBA")
        img = Image.alpha_composite(img, overlay)
        return img.convert("RGB")

    def _wrap_text(self, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
        """Wrap text to fit within max_width."""
        words = text.split()
        lines = []
        current_line = []

        for word in words:
            test_line = " ".join(current_line + [word])
            bbox = font.getbbox(test_line)
            width = bbox[2] - bbox[0]

            if width <= max_width:
                current_line.append(word)
            else:
                if current_line:
                    lines.append(" ".join(current_line))
                current_line = [word]

        if current_line:
            lines.append(" ".join(current_line))

        return lines

    def _calculate_font_size(self, text: str, max_width: int, max_height: int) -> int:
        """Calculate optimal font size to fit text in bounds."""
        for size in range(60, 28, -2):
            font = ImageFont.truetype(str(self.FONT_PATH), size)
            lines = self._wrap_text(text, font, max_width)

            # Calculate total height
            line_height = size * 1.4
            total_height = len(lines) * line_height

            if total_height <= max_height and len(lines) <= 8:
                return size

        return 30

    def _render_text(self, img: Image.Image, quote_text: str, church_name: str) -> Image.Image:
        """Render quote text and church name on image."""
        draw = ImageDraw.Draw(img)
        padding = 80
        max_width = self.IMAGE_SIZE[0] - (padding * 2)
        max_height = self.IMAGE_SIZE[1] - (padding * 3)  # Leave room for church name

        # Calculate font size and wrap text
        font_size = self._calculate_font_size(quote_text, max_width, max_height)
        font = ImageFont.truetype(str(self.FONT_PATH), font_size)
        lines = self._wrap_text(quote_text, font, max_width)

        # Calculate text block height
        line_height = font_size * 1.4
        text_height = len(lines) * line_height

        # Center text vertically (slightly above center)
        start_y = (self.IMAGE_SIZE[1] - text_height) // 2 - 40

        # Draw quote text with shadow
        for i, line in enumerate(lines):
            bbox = font.getbbox(line)
            text_width = bbox[2] - bbox[0]
            x = (self.IMAGE_SIZE[0] - text_width) // 2
            y = start_y + (i * line_height)

            # Shadow
            draw.text((x + 2, y + 2), line, font=font, fill=(0, 0, 0, 128))
            # Main text
            draw.text((x, y), line, font=font, fill="white")

        # Draw church name at bottom
        church_font = ImageFont.truetype(str(self.FONT_PATH), 24)
        bbox = church_font.getbbox(church_name)
        church_width = bbox[2] - bbox[0]
        church_x = (self.IMAGE_SIZE[0] - church_width) // 2
        church_y = self.IMAGE_SIZE[1] - 60

        draw.text((church_x, church_y), church_name, font=church_font, fill=(255, 255, 255, 200))

        return img

    def generate_quote_image(
        self,
        quote_text: str,
        video_url: str,
        timestamp: float,
        church_name: str,
        fallback_color: str = "#1a1a2e",
    ) -> bytes:
        """
        Generate a quote image with video frame background.

        Args:
            quote_text: The quote text to display
            video_url: URL to the video for frame extraction
            timestamp: Time in seconds for frame extraction
            church_name: Church name to display at bottom
            fallback_color: Hex color for fallback background

        Returns:
            PNG image as bytes
        """
        # Try to extract frame from video
        background = self.extract_frame(video_url, timestamp)

        if background is None:
            # Use fallback solid color
            background = self._create_fallback_background(fallback_color)
        else:
            background = self._resize_and_crop(background)

        # Apply overlay and render text
        img = self._apply_overlay(background)
        img = self._render_text(img, quote_text, church_name)

        # Convert to PNG bytes
        buffer = BytesIO()
        img.save(buffer, format="PNG", quality=95)
        buffer.seek(0)
        return buffer.getvalue()
```

- [ ] **Step 2: Test image generation with fallback**

```bash
cd backend && source venv/bin/activate && python -c "
from services.image_service import ImageService
svc = ImageService()

# Test with fallback (no video URL)
png_bytes = svc.generate_quote_image(
    quote_text='Praise God, praise God, praise God, praise God.',
    video_url='',
    timestamp=0,
    church_name='Grace Church',
)

print(f'Generated image: {len(png_bytes)} bytes')
assert len(png_bytes) > 10000, 'Image too small'
print('SUCCESS: Image generated with fallback background')
"
```
Expected: Image generated, ~100KB+ bytes

- [ ] **Step 3: Commit**

```bash
git add backend/services/image_service.py
git commit -m "feat: add image composition to ImageService"
```

---

### Task 4: Create Image API Endpoint

**Files:**
- Create: `backend/routers/image.py`
- Modify: `backend/main.py`

**Interfaces:**
- Consumes: `ImageService.generate_quote_image()` from Task 3
- Produces: `POST /image/quote/{quote_id}` → `ImageResponse`

- [ ] **Step 1: Create image router**

Create `backend/routers/image.py`:

```python
import os
import base64
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

from services.image_service import ImageService


router = APIRouter(prefix="/image", tags=["image"])


def get_supabase() -> Client:
    """Get Supabase client."""
    url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54421")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return create_client(url, key)


class ImageResponse(BaseModel):
    image: str  # base64 data URL
    quote_id: str
    filename: str


def slugify(text: str, max_length: int = 30) -> str:
    """Convert text to URL-friendly slug."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = text.strip("-")
    return text[:max_length]


@router.post("/quote/{quote_id}", response_model=ImageResponse)
async def generate_quote_image(quote_id: str):
    """Generate a shareable image for a quote."""
    supabase = get_supabase()

    # Fetch quote
    quote_result = supabase.table("quotes").select("*").eq("id", quote_id).single().execute()
    if not quote_result.data:
        raise HTTPException(status_code=404, detail="Quote not found")

    quote = quote_result.data

    # Fetch project for video URL
    project_result = supabase.table("projects").select("video_url, church_id").eq("id", quote["project_id"]).single().execute()
    if not project_result.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_result.data

    # Fetch church for name
    church_result = supabase.table("churches").select("name").eq("id", project["church_id"]).single().execute()
    church_name = church_result.data["name"] if church_result.data else "SermonClip"

    # Generate image
    try:
        image_service = ImageService()
        png_bytes = image_service.generate_quote_image(
            quote_text=quote["text"],
            video_url=project.get("video_url", ""),
            timestamp=float(quote.get("start_time", 0)),
            church_name=church_name,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image generation failed: {str(e)}")

    # Encode as base64 data URL
    base64_image = base64.b64encode(png_bytes).decode("utf-8")
    data_url = f"data:image/png;base64,{base64_image}"

    # Generate filename
    slug = slugify(quote["text"][:50])
    filename = f"quote-{slug}.png"

    return ImageResponse(
        image=data_url,
        quote_id=quote_id,
        filename=filename,
    )
```

- [ ] **Step 2: Register router in main.py**

Modify `backend/main.py`:

Add import at top:
```python
from routers import video, transcribe, analyze, process, image
```

Add router registration after other routers:
```python
app.include_router(image.router)
```

- [ ] **Step 3: Test the endpoint**

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --port 8000 &
sleep 3
curl http://localhost:8000/docs | grep -o "image"
pkill -f "uvicorn main:app"
```
Expected: "image" appears in docs output

- [ ] **Step 4: Commit**

```bash
git add backend/routers/image.py backend/main.py
git commit -m "feat: add image generation API endpoint"
```

---

### Task 5: Create ImagePreviewModal Component

**Files:**
- Create: `frontend/src/components/projects/ImagePreviewModal.tsx`

**Interfaces:**
- Consumes: `imageData: string` (base64 data URL), `filename: string`
- Produces: React component `<ImagePreviewModal>` with open/close state, download, regenerate callbacks

- [ ] **Step 1: Create ImagePreviewModal component**

Create `frontend/src/components/projects/ImagePreviewModal.tsx`:

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

interface ImagePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageData: string | null;
  filename: string;
  isLoading: boolean;
  onRegenerate: () => void;
}

export function ImagePreviewModal({
  open,
  onOpenChange,
  imageData,
  filename,
  isLoading,
  onRegenerate,
}: ImagePreviewModalProps) {
  const handleDownload = () => {
    if (!imageData) return;

    const link = document.createElement("a");
    link.href = imageData;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quote Image Preview</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center min-h-[300px] bg-muted rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin" />
              <span>Generating image...</span>
            </div>
          ) : imageData ? (
            <img
              src={imageData}
              alt="Quote preview"
              className="max-w-full max-h-[400px] object-contain"
            />
          ) : (
            <span className="text-muted-foreground">No image</span>
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
          <Button onClick={handleDownload} disabled={!imageData || isLoading}>
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
cd frontend && npm run build 2>&1 | tail -20
```
Expected: Build succeeds or shows only unrelated warnings

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/projects/ImagePreviewModal.tsx
git commit -m "feat: add ImagePreviewModal component"
```

---

### Task 6: Integrate Image Generation in QuoteCard

**Files:**
- Modify: `frontend/src/components/projects/QuoteCard.tsx`

**Interfaces:**
- Consumes: `ImagePreviewModal` from Task 5, API endpoint from Task 4
- Produces: Working "Image" button that generates and previews quote images

- [ ] **Step 1: Update QuoteCard with image generation**

Replace `frontend/src/components/projects/QuoteCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Image, Video, Clock } from "lucide-react";
import { toast } from "sonner";
import { ImagePreviewModal } from "./ImagePreviewModal";

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
  const [showModal, setShowModal] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [filename, setFilename] = useState("quote.png");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(quote.text);
    toast.success("Quote copied to clipboard");
  };

  const generateImage = async () => {
    setIsGenerating(true);
    setShowModal(true);

    try {
      const response = await fetch(`${API_URL}/image/quote/${quote.id}`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to generate image");
      }

      const data = await response.json();
      setImageData(data.image);
      setFilename(data.filename);
    } catch (error) {
      toast.error("Failed to generate image");
      console.error("Image generation error:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImageClick = () => {
    if (imageData) {
      setShowModal(true);
    } else {
      generateImage();
    }
  };

  const handleRegenerate = () => {
    generateImage();
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <blockquote className="text-lg font-medium italic border-l-4 border-primary pl-4">
            "{quote.text}"
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
              disabled={isGenerating}
            >
              <Image className={`h-4 w-4 mr-1 ${isGenerating ? "animate-pulse" : ""}`} />
              Image
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Video className="h-4 w-4 mr-1" />
              Clip
            </Button>
          </div>
        </CardFooter>
      </Card>

      <ImagePreviewModal
        open={showModal}
        onOpenChange={setShowModal}
        imageData={imageData}
        filename={filename}
        isLoading={isGenerating}
        onRegenerate={handleRegenerate}
      />
    </>
  );
}
```

- [ ] **Step 2: Verify build succeeds**

```bash
cd frontend && npm run build 2>&1 | tail -10
```
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/projects/QuoteCard.tsx
git commit -m "feat: integrate image generation in QuoteCard"
```

---

### Task 7: End-to-End Testing

**Files:**
- None (testing existing implementation)

**Interfaces:**
- Tests full flow: Quote → API → Image → Preview → Download

- [ ] **Step 1: Start backend**

```bash
cd backend && source venv/bin/activate
pkill -f "uvicorn main:app" 2>/dev/null
uvicorn main:app --reload --port 8000 &
sleep 3
curl -s http://localhost:8000/health
```
Expected: `{"status":"healthy",...}`

- [ ] **Step 2: Start frontend**

```bash
cd frontend && npm run dev &
sleep 5
```

- [ ] **Step 3: Test image generation API directly**

Get a quote ID from the database and test:
```bash
# Get first quote ID
QUOTE_ID=$(curl -s "http://127.0.0.1:54421/rest/v1/quotes?limit=1" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

echo "Testing quote: $QUOTE_ID"

# Test image generation
curl -s -X POST "http://localhost:8000/image/quote/$QUOTE_ID" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'quote_id: {data[\"quote_id\"]}')
print(f'filename: {data[\"filename\"]}')
print(f'image length: {len(data[\"image\"])} chars')
assert data['image'].startswith('data:image/png;base64,'), 'Invalid image format'
print('SUCCESS: Image generated correctly')
"
```
Expected: SUCCESS message with valid image data

- [ ] **Step 4: Manual browser test**

1. Open http://localhost:3000/projects
2. Click on a completed project with quotes
3. Click "Image" button on any quote
4. Verify modal opens with loading state
5. Verify image appears after generation
6. Click "Download" and verify PNG downloads
7. Click "Regenerate" and verify new image generates

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test: verify quote image generation end-to-end"
```
