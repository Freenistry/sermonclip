"""SQLModel database models for SermonClip (local SQLite)."""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Settings (singleton, id=1)
# ---------------------------------------------------------------------------

class Settings(SQLModel, table=True):
    __tablename__ = "settings"

    id: int = Field(default=1, primary_key=True)
    church_name: Optional[str] = None
    logo_path: Optional[str] = None


# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------

class Project(SQLModel, table=True):
    __tablename__ = "projects"

    id: str = Field(default_factory=_uuid, primary_key=True)
    title: str
    video_url: Optional[str] = None
    audio_url: Optional[str] = None
    video_duration_seconds: Optional[float] = None
    source_type: str = "upload"
    youtube_url: Optional[str] = None
    sermon_language: Optional[str] = None
    status: str = "uploading"
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


# ---------------------------------------------------------------------------
# Transcript
# ---------------------------------------------------------------------------

class Transcript(SQLModel, table=True):
    __tablename__ = "transcripts"

    id: str = Field(default_factory=_uuid, primary_key=True)
    project_id: str = Field(foreign_key="projects.id")
    full_text: Optional[str] = None
    segments: Optional[Any] = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_now)


# ---------------------------------------------------------------------------
# SermonHighlight
# ---------------------------------------------------------------------------

class SermonHighlight(SQLModel, table=True):
    __tablename__ = "sermon_highlights"

    id: str = Field(default_factory=_uuid, primary_key=True)
    project_id: str = Field(foreign_key="projects.id")
    title: Optional[str] = None
    transcript_excerpt: Optional[str] = None
    quote_text: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    time_ranges: Optional[Any] = Field(default=None, sa_column=Column(JSON))
    duration_tier: Optional[str] = None
    is_merged: bool = Field(default=False)
    created_at: datetime = Field(default_factory=_now)


# ---------------------------------------------------------------------------
# Quote
# ---------------------------------------------------------------------------

class Quote(SQLModel, table=True):
    __tablename__ = "quotes"

    id: str = Field(default_factory=_uuid, primary_key=True)
    project_id: str = Field(foreign_key="projects.id")
    transcript_id: Optional[str] = Field(default=None, foreign_key="transcripts.id")
    text: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    context: Optional[str] = None
    status: Optional[str] = None
    shareability_score: Optional[int] = None
    context_caption: Optional[str] = None
    selected: bool = Field(default=False)
    highlight_id: Optional[str] = Field(default=None, foreign_key="sermon_highlights.id")
    created_at: datetime = Field(default_factory=_now)


# ---------------------------------------------------------------------------
# MergeSuggestion
# ---------------------------------------------------------------------------

class MergeSuggestion(SQLModel, table=True):
    __tablename__ = "merge_suggestions"

    id: str = Field(default_factory=_uuid, primary_key=True)
    project_id: str = Field(foreign_key="projects.id")
    highlight_ids: Optional[Any] = Field(default=None, sa_column=Column(JSON))
    reason: Optional[str] = None
    merged_title: Optional[str] = None
    merged_start_time: Optional[float] = None
    merged_end_time: Optional[float] = None
    confidence: Optional[float] = None
    status: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)


# ---------------------------------------------------------------------------
# SavedClip
# ---------------------------------------------------------------------------

class SavedClip(SQLModel, table=True):
    __tablename__ = "saved_clips"

    id: str = Field(default_factory=_uuid, primary_key=True)
    project_id: str = Field(foreign_key="projects.id")
    highlight_id: Optional[str] = Field(default=None, foreign_key="sermon_highlights.id")
    title: Optional[str] = None
    filename: Optional[str] = None
    video_path: Optional[str] = None
    thumbnail_path: Optional[str] = None
    duration_seconds: Optional[float] = None
    quote_text: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)
