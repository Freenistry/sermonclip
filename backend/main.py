from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

from routers import video

load_dotenv()

app = FastAPI(
    title="SermonClip API",
    description="Backend API for AI-powered sermon content generation",
    version="0.1.0",
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


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "sermonclip-api"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "SermonClip API", "docs": "/docs"}
