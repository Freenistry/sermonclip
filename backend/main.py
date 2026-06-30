import sys
import os

# In PyInstaller bundle, load .env.production from the bundle directory
if getattr(sys, "frozen", False):
    bundle_dir = os.path.dirname(sys.executable)
    env_file = os.path.join(bundle_dir, ".env.production")
    if os.path.exists(env_file):
        from dotenv import load_dotenv
        load_dotenv(env_file)
    os.environ.setdefault("SERMONCLIP_BUNDLED", "1")
else:
    from dotenv import load_dotenv
    load_dotenv()

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import video, transcribe, analyze, process, image, clip, youtube, editor, merge, health

logger = logging.getLogger(__name__)

async def recover_stuck_projects():
    """On startup, find projects stuck in processing states and resume them."""
    try:
        supabase = process.get_supabase()
        stuck_statuses = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights"]
        result = supabase.table("projects").select("id, status").in_("status", stuck_statuses).execute()

        if not result.data:
            return

        for project in result.data:
            pid = project["id"]
            old_status = project["status"]
            logger.warning(f"Recovering stuck project {pid} (was: {old_status})")
            asyncio.create_task(process.process_project_pipeline(pid))

        logger.info(f"Recovering {len(result.data)} stuck project(s)")
    except Exception as e:
        logger.error(f"Failed to recover stuck projects: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await recover_stuck_projects()
    yield


app = FastAPI(
    title="SermonClip API",
    description="Backend API for AI-powered sermon content generation",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(video.router)
app.include_router(transcribe.router)
app.include_router(analyze.router)
app.include_router(process.router)
app.include_router(image.router)
app.include_router(clip.router)
app.include_router(youtube.router)
app.include_router(editor.router)
app.include_router(merge.router)
app.include_router(health.router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "sermonclip-api"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "SermonClip API", "docs": "/docs"}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="SermonClip API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    args = parser.parse_args()

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
