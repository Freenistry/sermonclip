"""Settings management for standalone app."""
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
        return {"church_name": settings.church_name, "setup_complete": True}


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
