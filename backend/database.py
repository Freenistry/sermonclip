"""SQLite database initialization and session management for SermonClip."""

import os
from sqlmodel import SQLModel, Session, create_engine

_engine = None
_data_dir = None


def init_db(data_dir: str) -> None:
    """Create the SQLite engine and all tables."""
    global _engine, _data_dir

    os.makedirs(data_dir, exist_ok=True)
    db_path = os.path.join(data_dir, "sermonclip.db")
    _data_dir = data_dir

    _engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )

    # Import models so metadata knows about all tables
    import models  # noqa: F401

    SQLModel.metadata.create_all(_engine)


def get_session() -> Session:
    """Return a new Session bound to the engine."""
    if _engine is None:
        raise RuntimeError("Database not initialised. Call init_db() first.")
    return Session(_engine)


def get_data_dir() -> str:
    """Return the configured data directory path."""
    if _data_dir is None:
        raise RuntimeError("Database not initialised. Call init_db() first.")
    return _data_dir
