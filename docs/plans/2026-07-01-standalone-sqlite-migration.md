# Standalone SQLite Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make SermonClip a fully standalone desktop app — no Supabase, no manual FFmpeg install, no authentication required.

**Architecture:** Replace Supabase (Postgres + Auth + Storage) with SQLite via SQLModel in the Python backend. Bundle FFmpeg as a Tauri external binary. Remove authentication entirely — single-user desktop app needs no login. Store all data (database, videos, clips) in the OS app data directory, passed to the sidecar via `--data-dir`.

**Tech Stack:** SQLModel (SQLAlchemy + Pydantic), SQLite, Alembic (migrations), static FFmpeg binaries, Tauri `externalBin`

---

## Context

### Current state
- Backend uses `supabase-py` client in 6 router files + main.py (~40 database calls)
- 2 Supabase Storage buckets (videos, clips) for file storage
- Frontend uses Supabase Auth (login/register) + direct table queries in hooks
- Real-time subscriptions for project status via Supabase Postgres Changes
- FFmpeg found via system PATH (`shutil.which("ffmpeg")`)

### What changes
| Component | Before | After |
|-----------|--------|-------|
| Database | Supabase Postgres | SQLite file in app data dir |
| ORM | `supabase.table().select()` | SQLModel (SQLAlchemy) |
| File storage | Supabase Storage buckets | Local filesystem in app data dir |
| Auth | Supabase Auth (login/register) | Removed — no auth needed |
| Real-time | Postgres Changes subscription | Polling (already implemented as fallback) |
| FFmpeg | System PATH | Bundled binary via `externalBin` |
| Frontend queries | Mix of Supabase direct + FastAPI | All through FastAPI |

### Database tables (8 total)
`churches`, `users`, `projects`, `transcripts`, `quotes`, `sermon_highlights`, `merge_suggestions`, `saved_clips`

For standalone single-user: `churches` and `users` become a single `settings` record. All `church_id`/`user_id` columns are dropped.

### Files with Supabase calls (backend)
- `routers/process.py` — heaviest user (~15 calls)
- `routers/clip.py` — CRUD + storage uploads (~10 calls)
- `routers/editor.py` — SELECT queries (~5 calls)
- `routers/video.py` — SELECT + signed URLs (~3 calls)
- `routers/merge.py` — CRUD for merge workflow (~8 calls)
- `routers/image.py` — SELECT queries (~4 calls)
- `main.py` — startup recovery query

### Files with FFmpeg subprocess calls (backend)
- `services/ffmpeg_service.py` — 8 subprocess calls
- `services/clip_service.py` — 5 subprocess calls
- `services/image_service.py` — 1 subprocess call
- `services/youtube_service.py` — 1 subprocess call
- `routers/editor.py` — 1 subprocess call
- `routers/clip.py` — 1 subprocess call
- `routers/health.py` — `shutil.which("ffmpeg")`

---

## Task 1: SQLModel Database Setup

**Goal:** Create SQLModel models matching the current Supabase schema, initialize SQLite database, and add `--data-dir` CLI argument.

**Files:**
- Create: `backend/database.py`
- Create: `backend/models.py`
- Modify: `backend/main.py`
- Modify: `backend/requirements.txt`

**Step 1: Add dependencies to requirements.txt**

Add to `backend/requirements.txt`:
```
sqlmodel==0.0.22
aiosqlite==0.20.0
```

Remove `supabase==2.10.0` from requirements.txt (will break imports — that's expected, we fix them in later tasks).

**Step 2: Install new dependencies**

```bash
cd backend && ./venv/bin/pip install sqlmodel==0.0.22 aiosqlite==0.20.0
```

**Step 3: Create `backend/models.py`**

Define all SQLModel table models. Key changes from Supabase schema:
- Drop `church_id` and `user_id` from all tables (single-user app)
- Drop `churches` and `users` tables entirely
- Add a `settings` table for church name/branding
- Use `str` UUIDs as primary keys (SQLite doesn't have native UUID)
- Use `datetime` for timestamps

```python
"""SQLModel database models for SermonClip standalone."""
import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, JSON


def generate_uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Settings(SQLModel, table=True):
    id: int = Field(default=1, primary_key=True)
    church_name: str = Field(default="My Church")
    logo_path: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class Project(SQLModel, table=True):
    __tablename__ = "projects"
    id: str = Field(default_factory=generate_uuid, primary_key=True)
    title: str
    video_url: Optional[str] = None
    audio_url: Optional[str] = None
    video_duration_seconds: Optional[int] = None
    source_type: Optional[str] = None  # 'upload' or 'youtube'
    youtube_url: Optional[str] = None
    sermon_language: Optional[str] = None
    status: str = Field(default="uploading")
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Transcript(SQLModel, table=True):
    __tablename__ = "transcripts"
    id: str = Field(default_factory=generate_uuid, primary_key=True)
    project_id: str = Field(foreign_key="projects.id")
    full_text: Optional[str] = None
    segments: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class Quote(SQLModel, table=True):
    __tablename__ = "quotes"
    id: str = Field(default_factory=generate_uuid, primary_key=True)
    project_id: str = Field(foreign_key="projects.id")
    transcript_id: Optional[str] = Field(default=None, foreign_key="transcripts.id")
    text: str
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    context: Optional[str] = None
    status: str = Field(default="pending")
    shareability_score: Optional[int] = None
    context_caption: Optional[str] = None
    selected: Optional[bool] = None
    highlight_id: Optional[str] = Field(default=None, foreign_key="sermon_highlights.id")
    created_at: datetime = Field(default_factory=utcnow)


class SermonHighlight(SQLModel, table=True):
    __tablename__ = "sermon_highlights"
    id: str = Field(default_factory=generate_uuid, primary_key=True)
    project_id: str = Field(foreign_key="projects.id")
    title: Optional[str] = None
    transcript_excerpt: Optional[str] = None
    quote_text: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    time_ranges: Optional[list] = Field(default=None, sa_column=Column(JSON))
    duration_tier: Optional[str] = None  # 'short', 'medium', 'long'
    is_merged: Optional[bool] = Field(default=False)
    created_at: datetime = Field(default_factory=utcnow)


class MergeSuggestion(SQLModel, table=True):
    __tablename__ = "merge_suggestions"
    id: str = Field(default_factory=generate_uuid, primary_key=True)
    project_id: str = Field(foreign_key="projects.id")
    highlight_ids: Optional[list] = Field(default=None, sa_column=Column(JSON))
    reason: Optional[str] = None
    merged_title: Optional[str] = None
    merged_start_time: Optional[float] = None
    merged_end_time: Optional[float] = None
    confidence: Optional[str] = None  # 'high', 'medium', 'low'
    status: str = Field(default="pending")
    created_at: datetime = Field(default_factory=utcnow)


class SavedClip(SQLModel, table=True):
    __tablename__ = "saved_clips"
    id: str = Field(default_factory=generate_uuid, primary_key=True)
    project_id: str = Field(foreign_key="projects.id")
    highlight_id: str = Field(foreign_key="sermon_highlights.id")
    title: Optional[str] = None
    filename: Optional[str] = None
    video_path: Optional[str] = None
    thumbnail_path: Optional[str] = None
    duration_seconds: Optional[float] = None
    quote_text: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
```

**Step 4: Create `backend/database.py`**

```python
"""SQLite database initialization and session management."""
import os
from sqlmodel import SQLModel, Session, create_engine

_engine = None
_data_dir = None


def init_db(data_dir: str):
    """Initialize SQLite database in the given data directory."""
    global _engine, _data_dir
    _data_dir = data_dir
    os.makedirs(data_dir, exist_ok=True)

    db_path = os.path.join(data_dir, "sermonclip.db")
    _engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )

    # Import models so SQLModel knows about them
    import models  # noqa: F401
    SQLModel.metadata.create_all(_engine)


def get_session() -> Session:
    """Get a new database session."""
    if _engine is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return Session(_engine)


def get_data_dir() -> str:
    """Get the app data directory path."""
    if _data_dir is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _data_dir
```

**Step 5: Update `backend/main.py` to accept --data-dir and init database**

Read the current `main.py` first. Modify the `__main__` block to add `--data-dir`:

```python
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="SermonClip API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    parser.add_argument("--data-dir", default=None, help="App data directory for SQLite and media files")
    args = parser.parse_args()

    # Initialize database
    data_dir = args.data_dir or os.path.join(os.path.expanduser("~"), ".sermonclip")
    from database import init_db
    init_db(data_dir)

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
```

Also add database init in the FastAPI lifespan (for `uvicorn main:app` dev mode):

```python
@asynccontextmanager
async def lifespan(app):
    # Initialize database with default data dir if not already initialized
    from database import _engine
    if _engine is None:
        data_dir = os.environ.get("SERMONCLIP_DATA_DIR", os.path.join(os.path.expanduser("~"), ".sermonclip"))
        from database import init_db
        init_db(data_dir)

    # ... existing startup recovery logic (will be migrated in Task 3)
    yield
```

**Step 6: Test database creation**

```bash
cd backend && ./venv/bin/python -c "
from database import init_db, get_session
from models import Project, Settings
init_db('/tmp/sermonclip-test')
with get_session() as session:
    session.add(Settings(church_name='Test Church'))
    session.commit()
    settings = session.get(Settings, 1)
    print(f'Church: {settings.church_name}')
    print('Database created successfully')
import os; os.remove('/tmp/sermonclip-test/sermonclip.db')
"
```

Expected: `Church: Test Church` and `Database created successfully`.

**Step 7: Commit**

```bash
git add backend/models.py backend/database.py backend/main.py backend/requirements.txt
git commit -m "feat: add SQLModel database models and SQLite initialization"
```

---

## Task 2: Bundle FFmpeg Binary

**Goal:** Bundle FFmpeg/FFprobe with the app and make the backend find bundled binaries.

**Files:**
- Create: `backend/services/ffmpeg_path.py`
- Modify: `backend/services/ffmpeg_service.py`
- Modify: `backend/services/clip_service.py`
- Modify: `backend/services/image_service.py`
- Modify: `backend/services/youtube_service.py`
- Modify: `backend/routers/editor.py`
- Modify: `backend/routers/clip.py`
- Modify: `backend/routers/health.py`
- Modify: `desktop/src-tauri/tauri.conf.json`

**Step 1: Create FFmpeg path resolver**

Create `backend/services/ffmpeg_path.py`:

```python
"""Resolve FFmpeg/FFprobe binary paths — bundled or system PATH."""
import os
import sys
import shutil


def _bundled_dir() -> str | None:
    """Get directory where bundled binaries would live."""
    if getattr(sys, "frozen", False):
        # PyInstaller: binaries are next to the executable
        return os.path.dirname(sys.executable)
    return None


def get_ffmpeg_path() -> str:
    """Get the path to the ffmpeg binary."""
    bundled = _bundled_dir()
    if bundled:
        candidate = os.path.join(bundled, "ffmpeg")
        if os.path.isfile(candidate):
            return candidate

    # Check Tauri externalBin location (passed via FFMPEG_DIR env var)
    ffmpeg_dir = os.environ.get("FFMPEG_DIR")
    if ffmpeg_dir:
        candidate = os.path.join(ffmpeg_dir, "ffmpeg")
        if os.path.isfile(candidate):
            return candidate

    # Fall back to system PATH
    system = shutil.which("ffmpeg")
    if system:
        return system

    return "ffmpeg"  # Let subprocess raise the error


def get_ffprobe_path() -> str:
    """Get the path to the ffprobe binary."""
    bundled = _bundled_dir()
    if bundled:
        candidate = os.path.join(bundled, "ffprobe")
        if os.path.isfile(candidate):
            return candidate

    ffmpeg_dir = os.environ.get("FFMPEG_DIR")
    if ffmpeg_dir:
        candidate = os.path.join(ffmpeg_dir, "ffprobe")
        if os.path.isfile(candidate):
            return candidate

    system = shutil.which("ffprobe")
    if system:
        return system

    return "ffprobe"


def is_ffmpeg_available() -> bool:
    """Check if ffmpeg is available."""
    path = get_ffmpeg_path()
    if path == "ffmpeg":
        return shutil.which("ffmpeg") is not None
    return os.path.isfile(path)
```

**Step 2: Update all files that call ffmpeg/ffprobe**

In each file, replace hardcoded `"ffmpeg"` and `"ffprobe"` strings in subprocess calls with `get_ffmpeg_path()` / `get_ffprobe_path()`.

**`backend/services/ffmpeg_service.py`:**
Add import at top: `from services.ffmpeg_path import get_ffmpeg_path, get_ffprobe_path, is_ffmpeg_available`
Replace all `subprocess.run(["ffmpeg", ...]` with `subprocess.run([get_ffmpeg_path(), ...]`
Replace all `subprocess.run(["ffprobe", ...]` with `subprocess.run([get_ffprobe_path(), ...]`
Replace the existing `is_ffmpeg_available` method to use the centralized function.

**`backend/services/clip_service.py`:**
Add import: `from services.ffmpeg_path import get_ffmpeg_path`
Replace all `["ffmpeg",` with `[get_ffmpeg_path(),`

**`backend/services/image_service.py`:**
Add import: `from services.ffmpeg_path import get_ffmpeg_path`
Replace `["ffmpeg",` with `[get_ffmpeg_path(),`

**`backend/services/youtube_service.py`:**
Add import: `from services.ffmpeg_path import get_ffmpeg_path`
Replace `["ffmpeg",` with `[get_ffmpeg_path(),`

**`backend/routers/editor.py`:**
Add import: `from services.ffmpeg_path import get_ffmpeg_path`
Replace `["ffmpeg",` with `[get_ffmpeg_path(),`

**`backend/routers/clip.py`:**
Add import: `from services.ffmpeg_path import get_ffmpeg_path`
Replace `["ffmpeg",` with `[get_ffmpeg_path(),`

**`backend/routers/health.py`:**
Replace `shutil.which("ffmpeg") is not None` with:
```python
from services.ffmpeg_path import is_ffmpeg_available
ffmpeg_available = is_ffmpeg_available()
```

**Step 3: Add FFmpeg to Tauri externalBin**

Update `desktop/src-tauri/tauri.conf.json` bundle section:
```json
"externalBin": ["binaries/sermonclip-api", "binaries/ffmpeg", "binaries/ffprobe"]
```

**Step 4: Update `desktop/src-tauri/src/lib.rs` to pass FFMPEG_DIR env var to sidecar**

In the production sidecar launch, set the `FFMPEG_DIR` environment variable to the directory containing the bundled binaries. For Tauri, `externalBin` binaries are placed next to the app binary.

In the release branch of `lib.rs`, before spawning the sidecar:
```rust
// Production: set FFMPEG_DIR to the app's binary directory
let bin_dir = app.path().resource_dir()
    .unwrap_or_default()
    .parent()
    .unwrap_or(&std::path::PathBuf::from("."))
    .to_path_buf();

app
    .shell()
    .sidecar("sermonclip-api")
    .expect("failed to create sidecar command")
    .args(["--host", "127.0.0.1", "--port", "8000", "--data-dir", &data_dir_string])
    .env("FFMPEG_DIR", bin_dir.to_string_lossy().to_string())
    .spawn()
```

**Step 5: Download static FFmpeg binaries for local testing**

For macOS ARM (your dev machine):
```bash
mkdir -p desktop/src-tauri/binaries
# Download from evermeet.cx or build from source
# For now, symlink system ffmpeg for testing:
ln -sf $(which ffmpeg) desktop/src-tauri/binaries/ffmpeg-aarch64-apple-darwin
ln -sf $(which ffprobe) desktop/src-tauri/binaries/ffprobe-aarch64-apple-darwin
```

For CI builds, the GitHub Actions workflow should download platform-specific static builds.

**Step 6: Test**

```bash
cd backend && FFMPEG_DIR=/opt/homebrew/bin ./venv/bin/python -c "
from services.ffmpeg_path import get_ffmpeg_path, get_ffprobe_path, is_ffmpeg_available
print(f'ffmpeg: {get_ffmpeg_path()}')
print(f'ffprobe: {get_ffprobe_path()}')
print(f'available: {is_ffmpeg_available()}')
"
```

Expected: Prints paths and `available: True`.

**Step 7: Commit**

```bash
git add backend/services/ffmpeg_path.py backend/services/ffmpeg_service.py backend/services/clip_service.py backend/services/image_service.py backend/services/youtube_service.py backend/routers/editor.py backend/routers/clip.py backend/routers/health.py desktop/src-tauri/tauri.conf.json desktop/src-tauri/src/lib.rs
git commit -m "feat: bundle FFmpeg and add centralized binary path resolution"
```

---

## Task 3: Migrate `process.py` Router to SQLite

**Goal:** Replace all Supabase calls in the heaviest router with SQLModel queries. This is the most critical router — it orchestrates the entire processing pipeline.

**Files:**
- Modify: `backend/routers/process.py`
- Modify: `backend/main.py` (startup recovery)

**Step 1: Read `backend/routers/process.py` completely**

Understand every Supabase call. The key operations are:
- SELECT project by ID
- UPDATE project status
- INSERT/SELECT/DELETE transcripts, quotes, highlights, merge_suggestions
- Status checks and error handling

**Step 2: Replace Supabase client with SQLModel session**

Remove: `from supabase import create_client, Client` and the `get_supabase()` function.
Add: `from database import get_session` and `from models import Project, Transcript, Quote, SermonHighlight, MergeSuggestion`

**Step 3: Replace each Supabase call**

Pattern mapping (apply to each call in process.py):

| Supabase | SQLModel |
|----------|----------|
| `supabase.table("projects").select("*").eq("id", id).single().execute()` | `session.get(Project, id)` |
| `supabase.table("projects").update({"status": s}).eq("id", id).execute()` | `project.status = s; session.add(project); session.commit()` |
| `supabase.table("transcripts").insert({...}).execute()` | `session.add(Transcript(**data)); session.commit()` |
| `supabase.table("quotes").select("*").eq("project_id", id).execute()` | `session.exec(select(Quote).where(Quote.project_id == id)).all()` |
| `supabase.table("quotes").delete().eq("project_id", id).execute()` | `for q in quotes: session.delete(q); session.commit()` |

**Step 4: Update main.py startup recovery**

Replace the Supabase startup recovery in the lifespan function with SQLModel queries:

```python
# Recover stuck projects
with get_session() as session:
    stuck = session.exec(
        select(Project).where(Project.status.in_(["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights"]))
    ).all()
    for project in stuck:
        project.status = "failed"
        project.error_message = "Server restarted during processing"
        session.add(project)
    session.commit()
```

**Step 5: Test the processing pipeline**

Start the backend and create a project:
```bash
cd backend && ./venv/bin/python main.py --data-dir /tmp/sermonclip-test --port 8000
```

Test creating a project via curl and starting processing.

**Step 6: Commit**

```bash
git add backend/routers/process.py backend/main.py
git commit -m "feat: migrate process router from Supabase to SQLite"
```

---

## Task 4: Migrate Remaining Routers to SQLite

**Goal:** Replace Supabase calls in clip.py, editor.py, video.py, merge.py, and image.py.

**Files:**
- Modify: `backend/routers/clip.py`
- Modify: `backend/routers/editor.py`
- Modify: `backend/routers/video.py`
- Modify: `backend/routers/merge.py`
- Modify: `backend/routers/image.py`

**Step 1: Read each router file and apply the same pattern as Task 3**

For each file:
1. Remove `from supabase import create_client, Client` and `get_supabase()`
2. Add `from database import get_session, get_data_dir` and model imports
3. Replace every `.table().select().eq().execute()` with SQLModel queries
4. Replace every `.table().insert().execute()` with `session.add()` + `session.commit()`
5. Replace every `.table().update().eq().execute()` with attribute assignment + `session.commit()`
6. Replace every `.table().delete().eq().execute()` with `session.delete()` + `session.commit()`

**Step 2: Special handling for clip.py storage operations**

`clip.py` uses `supabase.storage.from_("clips").upload()` and `create_signed_url()`. Replace with local file operations:

```python
import shutil
from database import get_data_dir

# Instead of supabase.storage.from_("clips").upload(path, data)
clips_dir = os.path.join(get_data_dir(), "clips")
os.makedirs(clips_dir, exist_ok=True)
file_path = os.path.join(clips_dir, filename)
with open(file_path, "wb") as f:
    f.write(data)

# Instead of create_signed_url() — return a local file URL
# The frontend will fetch via a new /clips/file/{filename} endpoint
```

**Step 3: Special handling for video.py signed URLs**

Replace `supabase.storage.from_("videos").create_signed_url()` with a local file serving endpoint. Add a new route:

```python
from fastapi.responses import FileResponse

@router.get("/video/file/{project_id}")
async def serve_video(project_id: str):
    with get_session() as session:
        project = session.get(Project, project_id)
        if not project or not project.video_url:
            raise HTTPException(404, "Video not found")
        return FileResponse(project.video_url)
```

**Step 4: Special handling for image.py churches table**

`image.py` queries the `churches` table for branding. Replace with `Settings`:

```python
from models import Settings
with get_session() as session:
    settings = session.get(Settings, 1)
    church_name = settings.church_name if settings else "My Church"
```

**Step 5: Test each router**

Start backend and test each endpoint with curl. Key endpoints:
- `GET /clip/highlight/{id}` — clip generation
- `GET /video/{id}` — video info
- `POST /merge/suggestion/{id}/accept` — merge workflow
- `GET /editor/highlight/{id}/waveform` — editor data

**Step 6: Commit**

```bash
git add backend/routers/clip.py backend/routers/editor.py backend/routers/video.py backend/routers/merge.py backend/routers/image.py
git commit -m "feat: migrate all remaining routers from Supabase to SQLite"
```

---

## Task 5: Local File Storage

**Goal:** Replace Supabase Storage (videos and clips buckets) with local filesystem. Add file serving endpoints.

**Files:**
- Create: `backend/routers/files.py`
- Modify: `backend/main.py` (register new router)
- Modify: `backend/routers/process.py` (video storage path)

**Step 1: Create file serving router**

Create `backend/routers/files.py`:

```python
"""Serve local video and clip files."""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from database import get_data_dir

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/video/{project_id}/{filename}")
async def serve_video(project_id: str, filename: str):
    path = os.path.join(get_data_dir(), "videos", project_id, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type="video/mp4")


@router.get("/clip/{filename}")
async def serve_clip(filename: str):
    path = os.path.join(get_data_dir(), "clips", filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    media_type = "video/mp4" if filename.endswith(".mp4") else "image/jpeg"
    return FileResponse(path, media_type=media_type)


@router.get("/thumbnail/{project_id}/{filename}")
async def serve_thumbnail(project_id: str, filename: str):
    path = os.path.join(get_data_dir(), "thumbnails", project_id, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type="image/jpeg")
```

**Step 2: Register the router in main.py**

```python
from routers import files
app.include_router(files.router)
```

**Step 3: Update video upload handling**

In the upload form / process router, save uploaded videos to:
```
{data_dir}/videos/{project_id}/video.mp4
```

Set `project.video_url` to this local path instead of a Supabase storage URL.

**Step 4: Update clip storage**

In `routers/clip.py`, save generated clips to:
```
{data_dir}/clips/{clip_id}.mp4
{data_dir}/clips/{clip_id}.jpg  (thumbnail)
```

Return URLs like `http://localhost:8000/files/clip/{clip_id}.mp4` instead of Supabase signed URLs.

**Step 5: Update CSP in Tauri**

The `media-src` CSP already allows `http://127.0.0.1:*` and `http://localhost:*`, so local file serving should work without changes.

**Step 6: Commit**

```bash
git add backend/routers/files.py backend/main.py backend/routers/process.py backend/routers/clip.py
git commit -m "feat: add local file storage and serving endpoints"
```

---

## Task 6: Remove Auth and Add Local Onboarding

**Goal:** Remove Supabase Auth from the frontend. Replace login/register with a simple onboarding screen that asks for church name.

**Files:**
- Delete: `desktop/src/routes/Login.tsx`
- Delete: `desktop/src/routes/Register.tsx`
- Modify: `desktop/src/hooks/useAuth.tsx` (remove Supabase, use local settings)
- Modify: `desktop/src/App.tsx` (remove auth routes, add onboarding)
- Delete: `desktop/src/lib/supabase.ts`
- Modify: `desktop/src/components/layout/Navbar.tsx` (remove sign out, email)
- Modify: `desktop/src/components/layout/RequireAuth.tsx` (remove or simplify)
- Create: `desktop/src/components/setup/Onboarding.tsx`

**Step 1: Create onboarding component**

Create `desktop/src/components/setup/Onboarding.tsx`:

```tsx
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

interface OnboardingProps {
  onComplete: (churchName: string) => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [churchName, setChurchName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!churchName.trim()) return;

    setSaving(true);
    try {
      await fetch(`${API_URL}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ church_name: churchName.trim() }),
      });
      onComplete(churchName.trim());
    } catch {
      // Still complete — settings can be updated later
      onComplete(churchName.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to SermonClip</CardTitle>
          <p className="text-muted-foreground">Let's get you set up</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="churchName">Church Name</Label>
              <Input
                id="churchName"
                value={churchName}
                onChange={(e) => setChurchName(e.target.value)}
                placeholder="e.g., Grace Community Church"
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={!churchName.trim() || saving}>
              {saving ? "Setting up..." : "Get Started"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Add settings endpoint to backend**

Create `backend/routers/settings.py`:

```python
from fastapi import APIRouter
from pydantic import BaseModel
from database import get_session
from models import Settings

router = APIRouter(tags=["settings"])


class SettingsUpdate(BaseModel):
    church_name: str


@router.get("/settings")
async def get_settings():
    with get_session() as session:
        settings = session.get(Settings, 1)
        if not settings:
            settings = Settings()
            session.add(settings)
            session.commit()
            session.refresh(settings)
        return {"church_name": settings.church_name}


@router.put("/settings")
async def update_settings(data: SettingsUpdate):
    with get_session() as session:
        settings = session.get(Settings, 1)
        if not settings:
            settings = Settings(church_name=data.church_name)
        else:
            settings.church_name = data.church_name
        session.add(settings)
        session.commit()
        return {"church_name": settings.church_name}
```

Register in `main.py`: `from routers import settings` and `app.include_router(settings.router)`.

**Step 3: Replace useAuth hook**

Replace `desktop/src/hooks/useAuth.tsx` — remove all Supabase imports:

```tsx
import { createContext, useContext, useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

interface AuthContext {
  churchName: string | null;
  loading: boolean;
  setChurchName: (name: string) => void;
}

const AuthContext = createContext<AuthContext>({
  churchName: null,
  loading: true,
  setChurchName: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [churchName, setChurchName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/settings`)
      .then((r) => r.json())
      .then((data) => {
        setChurchName(data.church_name || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ churchName, loading, setChurchName }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

**Step 4: Update App.tsx**

- Remove Login/Register routes
- Remove RequireAuth wrapper (or simplify it to just check `churchName`)
- Add Onboarding screen when `churchName` is null
- Remove `supabase` import

**Step 5: Update Navbar.tsx**

- Remove email display and Sign Out button
- Show church name instead
- Remove Supabase imports

**Step 6: Delete `desktop/src/lib/supabase.ts`**

**Step 7: Update all hooks that use Supabase**

- `useProjects.ts` — replace Supabase query with `fetch(`${API_URL}/projects`)`
- `useProject.ts` — replace Supabase queries with `fetch(`${API_URL}/project/${id}`)`

This requires corresponding FastAPI endpoints for project listing and detail. Add them to `backend/routers/process.py` or a new `projects.py` router:

```python
@router.get("/projects")
async def list_projects():
    with get_session() as session:
        projects = session.exec(
            select(Project).order_by(Project.created_at.desc())
        ).all()
        return [p.model_dump() for p in projects]

@router.get("/project/{project_id}")
async def get_project(project_id: str):
    with get_session() as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(404, "Project not found")

        transcripts = session.exec(
            select(Transcript).where(Transcript.project_id == project_id)
            .order_by(Transcript.created_at.desc()).limit(1)
        ).all()

        highlights = session.exec(
            select(SermonHighlight).where(SermonHighlight.project_id == project_id)
            .order_by(SermonHighlight.start_time)
        ).all()

        quotes = session.exec(
            select(Quote).where(Quote.project_id == project_id)
            .order_by(Quote.start_time)
        ).all()

        merge_suggestions = session.exec(
            select(MergeSuggestion).where(
                MergeSuggestion.project_id == project_id,
                MergeSuggestion.status == "pending"
            )
        ).all()

        return {
            "project": project.model_dump(),
            "transcript": transcripts[0].model_dump() if transcripts else None,
            "highlights": [h.model_dump() for h in highlights],
            "quotes": [q.model_dump() for q in quotes],
            "merge_suggestions": [m.model_dump() for m in merge_suggestions],
        }
```

**Step 8: Remove ProcessingProgress Supabase real-time**

In `desktop/src/components/projects/ProcessingProgress.tsx`:
- Remove `import { supabase } from "@/lib/supabase"`
- Remove the Supabase channel subscription in the useEffect
- Keep only the polling-based status updates (already implemented)

**Step 9: Remove Supabase npm packages**

```bash
cd desktop && npm uninstall @supabase/supabase-js
```

**Step 10: Test**

```bash
cd desktop && npx tauri dev
```

Expected: App opens with Onboarding screen (first run) or directly to Projects page.

**Step 11: Commit**

```bash
git add -A
git commit -m "feat: remove Supabase auth, add local onboarding, move all queries to FastAPI"
```

---

## Task 7: Update Tauri Sidecar to Pass --data-dir

**Goal:** Make Tauri pass the OS app data directory to the Python sidecar so SQLite and media files are stored in the correct location.

**Files:**
- Modify: `desktop/src-tauri/src/lib.rs`

**Step 1: Get app data dir and pass to sidecar**

In `lib.rs`, before spawning the sidecar (both dev and production branches), resolve the app data directory and pass it as `--data-dir`:

```rust
// Get app data directory
let data_dir = app.path().app_data_dir()
    .expect("failed to get app data dir");
std::fs::create_dir_all(&data_dir).ok();
let data_dir_string = data_dir.to_string_lossy().to_string();
log::info!("App data directory: {}", data_dir_string);
```

For the **dev mode** branch, add `--data-dir` to the args:
```rust
app
    .shell()
    .command(venv_python.to_string_lossy().to_string())
    .args(["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"])
    .current_dir(backend_dir)
    .spawn()
```

Note: In dev mode with `uvicorn main:app`, the `--data-dir` arg goes to uvicorn, not main.py. Instead, set it as an environment variable:
```rust
.env("SERMONCLIP_DATA_DIR", &data_dir_string)
```

For the **production** branch:
```rust
app
    .shell()
    .sidecar("sermonclip-api")
    .expect("failed to create sidecar command")
    .args(["--host", "127.0.0.1", "--port", "8000", "--data-dir", &data_dir_string])
    .spawn()
```

**Step 2: Commit**

```bash
git add desktop/src-tauri/src/lib.rs
git commit -m "feat: pass app data directory to backend sidecar"
```

---

## Task 8: Update Build Pipeline and Cleanup

**Goal:** Update PyInstaller spec, GitHub Actions, and remove all remaining Supabase references.

**Files:**
- Modify: `backend/sermonclip-api.spec` (remove supabase hidden imports, add sqlmodel)
- Modify: `.github/workflows/build-desktop.yml` (add FFmpeg download step)
- Modify: `backend/requirements.txt` (verify supabase removed)
- Modify: `desktop/.env` and `desktop/.env.production.example` (remove Supabase vars)
- Modify: `desktop/src-tauri/tauri.conf.json` (remove supabase from CSP)

**Step 1: Update PyInstaller hidden imports**

In `backend/sermonclip-api.spec`:
- Remove: `supabase`, `gotrue`, `postgrest`, `storage3`, `realtime` from hiddenimports
- Add: `sqlmodel`, `sqlalchemy`, `sqlite3`, `aiosqlite`

**Step 2: Update GitHub Actions to download FFmpeg**

Add a step in the `build-sidecar` job:
```yaml
- name: Download FFmpeg (macOS)
  if: runner.os == 'macOS'
  run: |
    brew install ffmpeg
    mkdir -p desktop/src-tauri/binaries
    cp $(which ffmpeg) desktop/src-tauri/binaries/ffmpeg-${{ matrix.target }}
    cp $(which ffprobe) desktop/src-tauri/binaries/ffprobe-${{ matrix.target }}

- name: Download FFmpeg (Linux)
  if: runner.os == 'Linux'
  run: |
    sudo apt-get install -y ffmpeg
    mkdir -p desktop/src-tauri/binaries
    cp $(which ffmpeg) desktop/src-tauri/binaries/ffmpeg-${{ matrix.target }}
    cp $(which ffprobe) desktop/src-tauri/binaries/ffprobe-${{ matrix.target }}

- name: Download FFmpeg (Windows)
  if: runner.os == 'Windows'
  run: |
    choco install ffmpeg -y
    mkdir -p desktop/src-tauri/binaries
    cp $(which ffmpeg) desktop/src-tauri/binaries/ffmpeg-${{ matrix.target }}.exe
    cp $(which ffprobe) desktop/src-tauri/binaries/ffprobe-${{ matrix.target }}.exe
```

**Step 3: Clean up environment files**

`desktop/.env` — remove `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, keep only:
```
VITE_FASTAPI_URL=http://localhost:8000
```

`desktop/.env.production.example` — same cleanup.

`backend/.env.production.example` — remove `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.

**Step 4: Update CSP**

In `desktop/src-tauri/tauri.conf.json`, remove Supabase from CSP:
- Remove `https://*.supabase.co` from `connect-src`
- Remove `wss://*.supabase.co` from `connect-src`
- Remove `https://*.supabase.co` from `img-src`

**Step 5: Remove dependency check for Supabase connection**

The setup screen (`DependencyCheck.tsx`) no longer needs to worry about Supabase. It should just check FFmpeg and optionally Ollama.

**Step 6: Final verification**

```bash
# Clean build
cd desktop && npm run build
cd desktop && source ~/.cargo/env && npx tauri dev
```

Verify:
- [ ] App starts without any Supabase connection
- [ ] Onboarding screen appears on first run
- [ ] Can create a project and upload a video
- [ ] Processing pipeline works end-to-end
- [ ] Generated clips are stored locally and playable
- [ ] No errors in console about Supabase

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: complete standalone migration — remove all Supabase dependencies"
```

---

## Summary

| Task | What it does | Key files |
|------|-------------|-----------|
| 1 | SQLModel database setup + models | `models.py`, `database.py`, `main.py` |
| 2 | Bundle FFmpeg binary + path resolver | `ffmpeg_path.py`, 7 files updated, `tauri.conf.json` |
| 3 | Migrate process.py (heaviest router) | `routers/process.py`, `main.py` |
| 4 | Migrate remaining 5 routers | `clip.py`, `editor.py`, `video.py`, `merge.py`, `image.py` |
| 5 | Local file storage + serving | `routers/files.py`, `main.py` |
| 6 | Remove auth + onboarding + frontend cleanup | `Onboarding.tsx`, `useAuth.tsx`, `App.tsx`, hooks, remove supabase.ts |
| 7 | Pass --data-dir from Tauri to sidecar | `lib.rs` |
| 8 | Build pipeline cleanup | spec, CI/CD, env files, CSP |

**After this plan:** The app is fully standalone. User downloads `.dmg`, opens it, enters church name, and starts processing sermons. No Python, no FFmpeg install, no database setup, no internet required (except for YouTube downloads).
