# Quote Image Generation Design

**Date:** 2026-06-23
**Status:** Approved

## Overview

Generate shareable social media images from extracted sermon quotes using Pillow. Images feature video frame backgrounds with text overlay.

## Requirements

- **Format:** 1080x1080 square (Facebook-optimized, adaptable to other platforms)
- **Background:** Video frame extracted at quote timestamp, fallback to solid color
- **Text styling:** Auto-styled with white text, dark overlay for readability
- **Branding:** Church name at bottom
- **Delivery:** Preview modal with download/regenerate options
- **Generation:** On-demand (no pre-generation or storage)

## Architecture

```
Frontend (QuoteCard)
  └─ Click "Image" → POST /image/quote/{id}
        │
        ▼
Backend (routers/image.py)
  └─ Fetch quote → project → church
        │
        ▼
ImageService (services/image_service.py)
  1. Extract frame from video (FFmpeg)
  2. Resize/crop to 1080x1080
  3. Apply dark overlay
  4. Render quote text (Pillow)
  5. Add church name
  6. Return PNG as base64
        │
        ▼
Frontend Modal
  └─ Preview → Download / Regenerate
```

## Backend Components

### ImageService (`backend/services/image_service.py`)

```python
class ImageService:
    def generate_quote_image(
        self,
        quote_text: str,
        video_url: str,
        timestamp: float,
        church_name: str,
        fallback_color: str = "#1a1a2e"
    ) -> bytes:
        """Generate a 1080x1080 quote image, returns PNG bytes."""
```

**Processing steps:**

1. **Extract frame** - FFmpeg grabs frame at timestamp
   - Command: `ffmpeg -ss {timestamp} -i {video_url} -frames:v 1 -f image2 -`
   - On failure: use solid color fallback

2. **Resize/crop** - Center crop to 1080x1080 square

3. **Apply overlay** - Semi-transparent black gradient, darker at bottom

4. **Render quote text**
   - Font: Montserrat Bold (bundled)
   - Size: Auto-scaled (32px - 60px based on text length)
   - Position: Centered with padding
   - Word wrap for long quotes

5. **Add church name** - Bottom center, smaller font

6. **Return PNG bytes**

### API Endpoint (`backend/routers/image.py`)

```python
@router.post("/quote/{quote_id}")
async def generate_quote_image(quote_id: str) -> ImageResponse:
    """Generate shareable image for a quote."""
```

**Response:**
```python
class ImageResponse(BaseModel):
    image: str        # base64 data URL (data:image/png;base64,...)
    quote_id: str
    filename: str     # suggested download filename
```

**Error handling:**
- Quote not found → 404
- Video unavailable → fallback to solid color
- Generation fails → 500

## Frontend Components

### QuoteCard.tsx (modify)

- Enable "Image" button
- On click: show loading → call API → open modal
- State: `isGenerating`, `imageData`, `showModal`

### ImagePreviewModal.tsx (new)

Modal with:
- Image preview (scaled to fit viewport)
- "Regenerate" button - calls API again
- "Download" button - triggers browser download
- Close button

## File Structure

```
backend/
  services/
    image_service.py       # NEW - Pillow generation
  routers/
    image.py               # NEW - API endpoint
  assets/
    fonts/
      Montserrat-Bold.ttf  # NEW - Bundled font

frontend/
  src/components/projects/
    ImagePreviewModal.tsx  # NEW - Preview modal
    QuoteCard.tsx          # MODIFY - Enable button
```

## Dependencies

**Backend (add to requirements.txt):**
```
Pillow>=10.0.0
```

**Frontend:** No new dependencies (uses existing shadcn/ui Dialog)

## Future Enhancements (Out of Scope)

- Multiple style options (minimal, branded templates)
- Additional formats (Instagram Story 1080x1920, etc.)
- Custom font/color selection
- Church logo overlay
- Batch generation
