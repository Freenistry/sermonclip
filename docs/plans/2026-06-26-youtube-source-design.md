# YouTube Video Link Support

## Summary

Add YouTube video link as an alternative video source alongside file upload. Users choose between "Upload Video" and "YouTube Link" tabs on the project creation form.

## Data Flow

```
User pastes YouTube URL
    ↓
Frontend calls POST /youtube/validate with URL
    ↓
Backend runs yt-dlp --dump-json (no download)
    → Returns: title, thumbnail_url, duration
    ↓
Frontend shows preview (thumbnail, title, duration)
    → User can edit title
    ↓
User clicks "Create Project"
    ↓
Frontend creates project in Supabase:
    source_type="youtube", youtube_url=<url>, title=<title>, status="processing"
    (no file upload to Storage)
    ↓
Frontend calls POST /process/project/{id}
    ↓
Backend pipeline detects source_type="youtube"
    → Download step uses yt-dlp (bestvideo+bestaudio/best) instead of signed URL fetch
    → Rest of pipeline unchanged
```

## Database Changes

Add to `projects` table:
- `source_type` (text, default "upload") — "upload" or "youtube"
- `youtube_url` (text, nullable) — original YouTube URL

## Backend Changes

### New: `/backend/routers/youtube.py`

`POST /youtube/validate`
- Input: `{ "url": string }`
- Validates URL format and accessibility via `yt-dlp --dump-json`
- Returns: `{ "title": string, "thumbnail_url": string, "duration_seconds": number }`
- Errors: invalid URL, private/unavailable video, age-restricted

### New: `/backend/services/youtube_service.py`

- `validate_and_get_metadata(url)` — runs `yt-dlp --dump-json`, returns parsed metadata
- `download_video(url, output_path)` — downloads best quality video with `yt-dlp -f bestvideo+bestaudio/best`

### Modified: `/backend/routers/process.py`

- Download step branches on `source_type`:
  - `"upload"` → existing signed URL download (unchanged)
  - `"youtube"` → calls `youtube_service.download_video()`
- Rest of pipeline unchanged

### Dependency

- Add `yt-dlp` to `requirements.txt`

## Frontend Changes

### Modified: `/frontend/src/components/projects/UploadForm.tsx`

- Add tab toggle: "Upload Video" | "YouTube Link"
- "Upload Video" tab: existing drag-and-drop (unchanged)
- "YouTube Link" tab:
  - URL text input
  - "Validate" button → calls `POST /youtube/validate`
  - Shows preview: thumbnail, title (editable), duration
  - "Create Project" button
- On submit: creates project with `source_type="youtube"`, `youtube_url`, no file upload

## Error Handling

- Invalid/private/unavailable URLs caught at validation with clear error message
- yt-dlp download failures during processing set project status to "failed" with error message
- Same error UX as existing upload failures

## What stays the same

- Entire pipeline after download (audio extraction, transcription, highlights)
- Project detail page, processing progress UI
- Clip and image generation
- All existing file upload functionality
