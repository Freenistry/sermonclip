from dotenv import load_dotenv
load_dotenv()

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from routers import video, transcribe, analyze, process, image, clip, youtube, editor, merge

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


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "sermonclip-api"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "SermonClip API", "docs": "/docs"}
