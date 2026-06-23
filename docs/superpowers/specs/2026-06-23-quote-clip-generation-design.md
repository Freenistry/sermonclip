# Quote Clip Generation Design

**Date:** 2026-06-23
**Status:** Approved

## Overview

Generate shareable video clips from extracted sermon quotes using FFmpeg. Clips include burned-in captions for social media sharing.

## Requirements

- **Format:** MP4 (H.264 video, AAC audio) - optimized for Facebook/YouTube
- **Aspect Ratio:** 16:9 horizontal (original video aspect)
- **Captions:** Burned-in subtitles showing quote text (white with black outline)
- **Branding:** None
- **Delivery:** On-demand generation with progress indicator, preview modal with download
- **Duration:** Defined by quote's start_time and end_time

## Architecture

```
Frontend (QuoteCard)
  └─ Click "Clip" → POST /clip/quote/{id}
        │
        ▼
Backend (routers/clip.py)
  └─ Fetch quote → project → video_url
        │
        ▼
ClipService (services/clip_service.py)
  1. Extract video segment (start_time to end_time)
  2. Burn in captions using drawtext filter
  3. Encode to MP4 (H.264, optimized for web)
  4. Return video bytes
        │
        ▼
Frontend Modal (ClipPreviewModal)
  └─ Video player → Download
```

## Backend Components

### ClipService (`backend/services/clip_service.py`)

```python
class ClipService:
    def generate_quote_clip(
        self,
        video_url: str,
        start_time: float,
        end_time: float,
        quote_text: str,
    ) -> bytes:
        """Generate an MP4 clip with burned-in captions, returns video bytes."""
```

**FFmpeg pipeline:**
1. `-ss {start_time}` - Seek to start position
2. `-t {duration}` - Clip length (end_time - start_time)
3. `-i {video_url}` - Input video URL
4. `-vf drawtext=...` - Burn captions with styling
5. `-c:v libx264 -preset fast -crf 23` - H.264 encoding (good quality/size balance)
6. `-c:a aac -b:a 128k` - AAC audio
7. `-movflags +faststart` - Optimize for web streaming
8. Output to temp file, return bytes

**Caption styling (drawtext filter):**
- Font: Montserrat Bold (bundled at `backend/assets/fonts/Montserrat-Bold.ttf`)
- Font size: 48px (scales well on 1080p)
- Position: Bottom center, 10% from bottom
- Color: White with black outline (2px border)
- Word wrap: Enabled for longer quotes

### API Endpoint (`backend/routers/clip.py`)

```python
@router.post("/quote/{quote_id}")
async def generate_quote_clip(quote_id: str) -> ClipResponse:
    """Generate a video clip for a quote."""
```

**Response:**
```python
class ClipResponse(BaseModel):
    video: str        # base64 data URL (data:video/mp4;base64,...)
    quote_id: str
    filename: str     # suggested download filename
    duration: float   # clip length in seconds
```

**Error handling:**
- Quote not found → 404
- Video URL invalid/unavailable → 500 with "Video unavailable"
- FFmpeg fails → 500 with "Clip generation failed"

## Frontend Components

### ClipPreviewModal.tsx (new)

Modal with:
- `<video>` element with native controls (play/pause, volume, fullscreen)
- Loading state with "Generating clip..." message
- Download button - triggers browser download of MP4
- Regenerate button - calls API again
- Close button

### QuoteCard.tsx (modify)

- Enable "Clip" button (currently disabled)
- Add state: `isGeneratingClip`, `clipData`, `clipFilename`, `showClipModal`
- On click: show modal with loading state → call API → display video when ready
- Cache clip data to avoid regeneration on repeated clicks

## File Structure

```
backend/
  services/
    clip_service.py        # NEW - FFmpeg clip generation
  routers/
    clip.py                # NEW - API endpoint

frontend/
  src/components/projects/
    ClipPreviewModal.tsx   # NEW - Video preview modal
    QuoteCard.tsx          # MODIFY - Enable clip button
```

## Dependencies

**Backend:** No new dependencies (FFmpeg already available, used by ImageService)

**Frontend:** No new dependencies (uses existing shadcn/ui Dialog)

## Constraints

- Maximum clip duration: Defined by quote timestamps (typically 10-60 seconds)
- Video URL must be HTTP/HTTPS (same validation as ImageService)
- Font file must exist (if unavailable, generate clip without captions rather than failing)

## Future Enhancements (Out of Scope)

- Vertical format (9:16) for Instagram Reels/TikTok
- Square format (1:1) for cross-platform
- Church branding/outro cards
- Background music options
- Caption style customization
- Batch clip generation
