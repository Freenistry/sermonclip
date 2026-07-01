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

from routers import video, transcribe, analyze, process, image, clip, youtube, editor, merge, health, files, settings_router

logger = logging.getLogger(__name__)

async def recover_stuck_projects():
    """On startup, find projects stuck in processing states and resume them."""
    try:
        from sqlmodel import select
        from database import get_session
        from models import Project

        stuck_statuses = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights"]

        with get_session() as session:
            stuck = session.exec(select(Project).where(Project.status.in_(stuck_statuses))).all()
            for project in stuck:
                project.status = "failed"
                project.error_message = "Server restarted during processing"
                session.add(project)
            if stuck:
                session.commit()
                logger.info(f"Recovered {len(stuck)} stuck project(s)")
    except Exception as e:
        logger.error(f"Failed to recover stuck projects: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure database is initialised when running via `uvicorn main:app`
    from database import _engine
    if _engine is None:
        data_dir = os.environ.get(
            "SERMONCLIP_DATA_DIR",
            os.path.join(os.path.expanduser("~"), ".sermonclip"),
        )
        from database import init_db
        init_db(data_dir)

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
        "http://localhost:18080",
        "http://127.0.0.1:18080",
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
app.include_router(files.router)
app.include_router(settings_router.router)


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
    parser.add_argument("--port", type=int, default=18080, help="Port to bind to")
    parser.add_argument("--data-dir", default=None, help="App data directory")
    args = parser.parse_args()

    data_dir = args.data_dir or os.path.join(os.path.expanduser("~"), ".sermonclip")
    from database import init_db
    init_db(data_dir)

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
