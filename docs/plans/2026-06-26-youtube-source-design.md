# YouTube Video Link Support - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add YouTube video link as an alternative video source alongside file upload.

**Architecture:** New YouTube service wraps yt-dlp for metadata validation and video download. The processing pipeline branches at the download step based on `source_type`. Frontend adds a tab toggle to switch between upload and YouTube URL input.

**Tech Stack:** yt-dlp (Python), FastAPI, Next.js 16, Supabase (PostgreSQL)

---

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

---

## Implementation Tasks

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260626000000_add_youtube_source.sql`

**Step 1: Write the migration**

```sql
-- Add source_type and youtube_url columns to projects
ALTER TABLE projects ADD COLUMN source_type text NOT NULL DEFAULT 'upload';
ALTER TABLE projects ADD COLUMN youtube_url text;
```

**Step 2: Apply migration**

Run: `npx supabase db reset` (or `npx supabase migration up` if data should be preserved)
Expected: Migration applies successfully, projects table has new columns.

**Step 3: Commit**

```bash
git add supabase/migrations/20260626000000_add_youtube_source.sql
git commit -m "feat: add source_type and youtube_url columns to projects"
```

---

### Task 2: YouTube Service

**Files:**
- Create: `backend/services/youtube_service.py`

**Step 1: Install yt-dlp dependency**

Run: `cd backend && pip install yt-dlp && echo "yt-dlp" >> requirements.txt`

**Step 2: Create the YouTube service**

```python
import asyncio
import json
import re
import subprocess
from dataclasses import dataclass
from typing import Optional


@dataclass
class YouTubeMetadata:
    title: str
    thumbnail_url: str
    duration_seconds: int


class YouTubeService:
    """Service for validating YouTube URLs and downloading videos using yt-dlp."""

    YOUTUBE_URL_PATTERN = re.compile(
        r"^(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w-]+"
    )

    @staticmethod
    def is_valid_url(url: str) -> bool:
        """Check if string looks like a YouTube URL."""
        return bool(YouTubeService.YOUTUBE_URL_PATTERN.match(url))

    @staticmethod
    async def validate_and_get_metadata(url: str) -> YouTubeMetadata:
        """Fetch video metadata without downloading. Raises ValueError on failure."""
        if not YouTubeService.is_valid_url(url):
            raise ValueError("Invalid YouTube URL format")

        try:
            result = await asyncio.to_thread(
                subprocess.run,
                ["yt-dlp", "--dump-json", "--no-download", url],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            raise ValueError("Timed out fetching video info")

        if result.returncode != 0:
            stderr = result.stderr.lower()
            if "private" in stderr:
                raise ValueError("This video is private")
            if "unavailable" in stderr or "not available" in stderr:
                raise ValueError("This video is unavailable")
            if "age" in stderr:
                raise ValueError("This video is age-restricted")
            raise ValueError(f"Could not fetch video info: {result.stderr.strip()}")

        info = json.loads(result.stdout)
        return YouTubeMetadata(
            title=info.get("title", "Untitled"),
            thumbnail_url=info.get("thumbnail", ""),
            duration_seconds=int(info.get("duration", 0)),
        )

    @staticmethod
    async def download_video(url: str, output_path: str) -> None:
        """Download best quality video to output_path. Raises ValueError on failure."""
        result = await asyncio.to_thread(
            subprocess.run,
            [
                "yt-dlp",
                "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "--merge-output-format", "mp4",
                "-o", output_path,
                url,
            ],
            capture_output=True,
            text=True,
            timeout=1800,  # 30 min max for large videos
        )
        if result.returncode != 0:
            raise ValueError(f"Failed to download video: {result.stderr.strip()}")
```

**Step 3: Verify yt-dlp is installed and importable**

Run: `cd backend && python -c "from services.youtube_service import YouTubeService; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/services/youtube_service.py backend/requirements.txt
git commit -m "feat: add YouTube service for metadata and video download"
```

---

### Task 3: YouTube Router

**Files:**
- Create: `backend/routers/youtube.py`
- Modify: `backend/main.py:6,29-34`

**Step 1: Create the YouTube router**

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.youtube_service import YouTubeService

router = APIRouter(prefix="/youtube", tags=["youtube"])


class ValidateRequest(BaseModel):
    url: str


class ValidateResponse(BaseModel):
    title: str
    thumbnail_url: str
    duration_seconds: int


@router.post("/validate", response_model=ValidateResponse)
async def validate_youtube_url(request: ValidateRequest):
    """Validate a YouTube URL and return video metadata."""
    try:
        metadata = await YouTubeService.validate_and_get_metadata(request.url)
        return ValidateResponse(
            title=metadata.title,
            thumbnail_url=metadata.thumbnail_url,
            duration_seconds=metadata.duration_seconds,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

**Step 2: Register router in main.py**

In `backend/main.py`, add to the import line:

```python
from routers import video, transcribe, analyze, process, image, clip, youtube
```

And add after the clip router registration:

```python
app.include_router(youtube.router)
```

**Step 3: Verify the endpoint starts**

Run: `cd backend && timeout 5 python -c "from routers.youtube import router; print('Router OK')" || true`
Expected: `Router OK`

**Step 4: Commit**

```bash
git add backend/routers/youtube.py backend/main.py
git commit -m "feat: add YouTube validate endpoint"
```

---

### Task 4: Modify Processing Pipeline

**Files:**
- Modify: `backend/routers/process.py:1-15,87-126`

**Step 1: Add YouTube import**

At `backend/routers/process.py:14` (after the highlight_service import), add:

```python
from services.youtube_service import YouTubeService
```

**Step 2: Branch download step on source_type**

Replace the download section in `process_project_pipeline` (lines 94-125). The current code fetches `video_url` and downloads via httpx. Replace with logic that checks `source_type`:

In `backend/routers/process.py`, replace:

```python
        video_url = project.get("video_url")
        if not video_url:
            raise ValueError("No video URL for project")

        church_id = project.get("church_id")

        # Create temp directory
        temp_dir = tempfile.mkdtemp(prefix=f"sermonclip_{project_id}_")
        video_path = os.path.join(temp_dir, "video.mp4")
        audio_path = os.path.join(temp_dir, "audio.wav")

        # Update status: downloading
        supabase.table("projects").update({
            "status": "downloading"
        }).eq("id", project_id).execute()

        # Check for cancellation
        check_cancelled(project_id, supabase, temp_dir)

        # Download video with chunked streaming (allows cancellation mid-download)
        import httpx
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("GET", video_url, follow_redirects=True) as response:
                if response.status_code != 200:
                    raise ValueError(f"Failed to download video: {response.status_code}")

                with open(video_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):  # 1MB chunks
                        # Check for cancellation every chunk
                        if project_id in cancelled_projects:
                            check_cancelled(project_id, supabase, temp_dir)
                        f.write(chunk)
```

With:

```python
        source_type = project.get("source_type", "upload")
        church_id = project.get("church_id")

        # Create temp directory
        temp_dir = tempfile.mkdtemp(prefix=f"sermonclip_{project_id}_")
        video_path = os.path.join(temp_dir, "video.mp4")
        audio_path = os.path.join(temp_dir, "audio.wav")

        # Update status: downloading
        supabase.table("projects").update({
            "status": "downloading"
        }).eq("id", project_id).execute()

        # Check for cancellation
        check_cancelled(project_id, supabase, temp_dir)

        if source_type == "youtube":
            # Download from YouTube using yt-dlp
            youtube_url = project.get("youtube_url")
            if not youtube_url:
                raise ValueError("No YouTube URL for project")
            await YouTubeService.download_video(youtube_url, video_path)
        else:
            # Download from Supabase storage via signed URL
            video_url = project.get("video_url")
            if not video_url:
                raise ValueError("No video URL for project")
            import httpx
            async with httpx.AsyncClient(timeout=300.0) as client:
                async with client.stream("GET", video_url, follow_redirects=True) as response:
                    if response.status_code != 200:
                        raise ValueError(f"Failed to download video: {response.status_code}")

                    with open(video_path, "wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):  # 1MB chunks
                            # Check for cancellation every chunk
                            if project_id in cancelled_projects:
                                check_cancelled(project_id, supabase, temp_dir)
                            f.write(chunk)
```

**Step 3: Verify syntax**

Run: `cd backend && python -c "import py_compile; py_compile.compile('routers/process.py', doraise=True); print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add backend/routers/process.py
git commit -m "feat: support YouTube download in processing pipeline"
```

---

### Task 5: Frontend - Tab Toggle and YouTube Form

**Files:**
- Modify: `frontend/src/components/projects/UploadForm.tsx`

**Step 1: Update the UploadForm component**

This is the largest change. The component needs:
- A `sourceTab` state: `"upload" | "youtube"`
- Tab toggle buttons above the form
- YouTube-specific state: `youtubeUrl`, `youtubeMetadata`, `validating`
- Validation call to `POST /youtube/validate`
- YouTube submit handler that creates project with `source_type: "youtube"`, `youtube_url`

Replace the full content of `frontend/src/components/projects/UploadForm.tsx` with:

```tsx
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, File, X, Link, Loader2 } from "lucide-react";

interface UploadFormProps {
  userId: string;
  churchId: string;
}

interface YouTubeMetadata {
  title: string;
  thumbnail_url: string;
  duration_seconds: number;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function UploadForm({ userId, churchId }: UploadFormProps) {
  const [sourceTab, setSourceTab] = useState<"upload" | "youtube">("upload");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<globalThis.File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);

  // YouTube state
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeMetadata, setYoutubeMetadata] = useState<YouTubeMetadata | null>(null);
  const [validating, setValidating] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  const FASTAPI_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (isValidVideoFile(droppedFile)) {
        setFile(droppedFile);
        if (!title) {
          setTitle(droppedFile.name.replace(/\.[^/.]+$/, ""));
        }
      } else {
        toast.error("Please upload a video file (MP4, MOV, or WebM)");
      }
    }
  }, [title]);

  const isValidVideoFile = (file: globalThis.File) => {
    const validTypes = ["video/mp4", "video/quicktime", "video/webm"];
    return validTypes.includes(file.type);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (isValidVideoFile(selectedFile)) {
        setFile(selectedFile);
        if (!title) {
          setTitle(selectedFile.name.replace(/\.[^/.]+$/, ""));
        }
      } else {
        toast.error("Please upload a video file (MP4, MOV, or WebM)");
      }
    }
  };

  const handleValidateYoutube = async () => {
    if (!youtubeUrl.trim()) return;

    setValidating(true);
    setYoutubeMetadata(null);

    try {
      const res = await fetch(`${FASTAPI_URL}/youtube/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to validate URL");
      }

      const metadata: YouTubeMetadata = await res.json();
      setYoutubeMetadata(metadata);
      if (!title) {
        setTitle(metadata.title);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid YouTube URL");
    } finally {
      setValidating(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) return;

    setUploading(true);
    setProgress(0);

    try {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          title,
          church_id: churchId,
          user_id: userId,
          status: "uploading",
        })
        .select()
        .single();

      if (projectError) throw projectError;

      setProgress(10);

      const fileExt = file.name.split(".").pop();
      const filePath = `${churchId}/${project.id}/video.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("videos")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      setProgress(80);

      const { data: urlData } = await supabase.storage
        .from("videos")
        .createSignedUrl(filePath, 60 * 60 * 24 * 7);

      const { error: updateError } = await supabase
        .from("projects")
        .update({
          video_url: urlData?.signedUrl || filePath,
          status: "processing",
        })
        .eq("id", project.id);

      if (updateError) throw updateError;

      setProgress(100);
      toast.success("Video uploaded successfully!");
      router.push(`/projects/${project.id}`);
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload video. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleYoutubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeMetadata || !title) return;

    setUploading(true);

    try {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          title,
          church_id: churchId,
          user_id: userId,
          source_type: "youtube",
          youtube_url: youtubeUrl.trim(),
          status: "processing",
        })
        .select()
        .single();

      if (projectError) throw projectError;

      toast.success("Project created! Processing will begin shortly.");
      router.push(`/projects/${project.id}`);
    } catch (error) {
      console.error("YouTube project error:", error);
      toast.error("Failed to create project. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Sermon Project</CardTitle>
        <CardDescription>
          Upload a video or paste a YouTube link to generate quotes and clips
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Tab Toggle */}
        <div className="flex border-b mb-6">
          <button
            type="button"
            className={`flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium transition-colors ${
              sourceTab === "upload"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setSourceTab("upload")}
          >
            <Upload className="h-4 w-4" />
            Upload Video
          </button>
          <button
            type="button"
            className={`flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium transition-colors ${
              sourceTab === "youtube"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setSourceTab("youtube")}
          >
            <Link className="h-4 w-4" />
            YouTube Link
          </button>
        </div>

        {sourceTab === "upload" ? (
          <form onSubmit={handleUpload} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title">Project Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Sunday Sermon - June 22, 2026"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Video File</Label>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                {file ? (
                  <div className="flex items-center justify-center gap-4">
                    <File className="h-8 w-8 text-muted-foreground" />
                    <div className="text-left">
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setFile(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-2">
                      Drag and drop your video file here, or
                    </p>
                    <label>
                      <Input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <span className="text-primary cursor-pointer hover:underline">
                        browse to upload
                      </span>
                    </label>
                    <p className="text-xs text-muted-foreground mt-2">
                      Supports MP4, MOV, WebM up to 5GB
                    </p>
                  </>
                )}
              </div>
            </div>

            {uploading && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-sm text-muted-foreground text-center">
                  {progress < 80
                    ? "Uploading video..."
                    : progress < 100
                    ? "Creating project..."
                    : "Complete!"}
                </p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!file || !title || uploading}
            >
              {uploading ? "Uploading..." : "Upload Video"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleYoutubeSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="youtube-url">YouTube URL</Label>
              <div className="flex gap-2">
                <Input
                  id="youtube-url"
                  value={youtubeUrl}
                  onChange={(e) => {
                    setYoutubeUrl(e.target.value);
                    setYoutubeMetadata(null);
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  required
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleValidateYoutube}
                  disabled={!youtubeUrl.trim() || validating}
                >
                  {validating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Fetch"
                  )}
                </Button>
              </div>
            </div>

            {youtubeMetadata && (
              <>
                <div className="rounded-lg border p-4 space-y-3">
                  {youtubeMetadata.thumbnail_url && (
                    <img
                      src={youtubeMetadata.thumbnail_url}
                      alt="Video thumbnail"
                      className="w-full rounded-md aspect-video object-cover"
                    />
                  )}
                  <p className="text-sm text-muted-foreground">
                    Duration: {formatDuration(youtubeMetadata.duration_seconds)}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="yt-title">Project Title</Label>
                  <Input
                    id="yt-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
              </>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!youtubeMetadata || !title || uploading}
            >
              {uploading ? "Creating..." : "Create Project"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
```

**Step 2: Verify build**

Run: `cd frontend && npx next build 2>&1 | tail -5`
Expected: Build succeeds (or at least no TypeScript errors in UploadForm.tsx)

**Step 3: Commit**

```bash
git add frontend/src/components/projects/UploadForm.tsx
git commit -m "feat: add YouTube link tab to upload form"
```

---

### Task 6: Trigger Processing for YouTube Projects

**Files:**
- Modify: `frontend/src/app/(dashboard)/projects/[id]/page.tsx`

The project detail page currently triggers `POST /process/project/{id}` when `status === "processing"`. This already works for YouTube projects since we set `status: "processing"` on creation. Verify this is the case by reading the file and confirming no changes are needed.

If the page checks for `video_url` before triggering processing, update it to also allow `source_type === "youtube"` projects without a `video_url`.

**Step 1: Read the project detail page and verify processing trigger works for YouTube projects**

Run: Read `frontend/src/app/(dashboard)/projects/[id]/page.tsx` and check the processing trigger logic.

**Step 2: Commit (if changes needed)**

```bash
git add frontend/src/app/(dashboard)/projects/[id]/page.tsx
git commit -m "fix: support YouTube projects in processing trigger"
```

---

### Task 7: End-to-End Verification

**Step 1: Start backend**

Run: `cd backend && uvicorn main:app --reload`

**Step 2: Test YouTube validate endpoint**

Run: `curl -X POST http://localhost:8000/youtube/validate -H "Content-Type: application/json" -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'`
Expected: JSON response with title, thumbnail_url, duration_seconds

**Step 3: Test invalid URL**

Run: `curl -X POST http://localhost:8000/youtube/validate -H "Content-Type: application/json" -d '{"url": "https://not-youtube.com/fake"}'`
Expected: 400 error with message about invalid URL

**Step 4: Manual frontend test**

1. Open http://localhost:3000/projects/new
2. Click "YouTube Link" tab
3. Paste a YouTube URL and click "Fetch"
4. Verify thumbnail, title, and duration appear
5. Edit title if desired and click "Create Project"
6. Verify redirect to project page and processing begins
