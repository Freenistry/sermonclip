import os
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import select

from database import get_session, get_data_dir
from models import SermonHighlight, MergeSuggestion

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/merge", tags=["merge"])


class MergeSuggestionResponse(BaseModel):
    id: str
    project_id: str
    highlight_ids: list[str]
    reason: str
    merged_title: str
    merged_start_time: float
    merged_end_time: float
    confidence: str
    status: str
    highlights: list[dict]  # populated from sermon_highlights


class SuggestionsListResponse(BaseModel):
    suggestions: list[MergeSuggestionResponse]


class AcceptResponse(BaseModel):
    suggestion_id: str
    new_highlight_id: str
    message: str


class DismissResponse(BaseModel):
    suggestion_id: str
    message: str


def _classify_tier(duration: float) -> str:
    if duration <= 50:
        return "short"
    elif duration <= 90:
        return "medium"
    else:
        return "long"


@router.get("/project/{project_id}/suggestions", response_model=SuggestionsListResponse)
async def get_suggestions(project_id: str):
    """Fetch pending merge suggestions for a project."""
    with get_session() as session:
        suggestions = session.exec(
            select(MergeSuggestion)
            .where(MergeSuggestion.project_id == project_id, MergeSuggestion.status == "pending")
            .order_by(MergeSuggestion.created_at)
        ).all()

        if not suggestions:
            return SuggestionsListResponse(suggestions=[])

        # Collect all highlight IDs across suggestions
        all_highlight_ids = set()
        for s in suggestions:
            if s.highlight_ids:
                all_highlight_ids.update(s.highlight_ids)

        # Fetch highlight details
        highlights_list = session.exec(
            select(SermonHighlight).where(SermonHighlight.id.in_(list(all_highlight_ids)))  # type: ignore[union-attr]
        ).all()
        highlights_by_id = {h.id: h.model_dump() for h in highlights_list}

        response_suggestions = []
        for s in suggestions:
            highlight_details = [
                highlights_by_id[hid] for hid in (s.highlight_ids or []) if hid in highlights_by_id
            ]
            response_suggestions.append(MergeSuggestionResponse(
                id=s.id,
                project_id=s.project_id,
                highlight_ids=s.highlight_ids or [],
                reason=s.reason or "",
                merged_title=s.merged_title or "",
                merged_start_time=float(s.merged_start_time or 0),
                merged_end_time=float(s.merged_end_time or 0),
                confidence=str(s.confidence or ""),
                status=s.status or "",
                highlights=highlight_details,
            ))

    return SuggestionsListResponse(suggestions=response_suggestions)


@router.post("/suggestion/{suggestion_id}/accept", response_model=AcceptResponse)
async def accept_suggestion(suggestion_id: str):
    """Accept a merge suggestion -- creates a new merged highlight."""
    with get_session() as session:
        suggestion = session.get(MergeSuggestion, suggestion_id)
        if not suggestion:
            raise HTTPException(status_code=404, detail="Suggestion not found")

        if suggestion.status != "pending":
            raise HTTPException(status_code=400, detail="Suggestion already processed")

        # Fetch constituent highlights ordered by start_time
        highlights = session.exec(
            select(SermonHighlight)
            .where(SermonHighlight.id.in_(suggestion.highlight_ids or []))  # type: ignore[union-attr]
            .order_by(SermonHighlight.start_time)
        ).all()

        if len(highlights) < 2:
            raise HTTPException(status_code=400, detail="Source highlights not found")

        # Build merged highlight with multi-segment time ranges
        combined_excerpt = " ".join(h.transcript_excerpt or "" for h in highlights)
        best_quote = max(highlights, key=lambda h: len(h.quote_text or "")).quote_text

        # Build time_ranges from source highlights (already ordered by start_time)
        time_ranges = [
            {"start": float(h.start_time), "end": float(h.end_time)}
            for h in highlights
        ]
        combined_duration = sum(r["end"] - r["start"] for r in time_ranges)
        tier = _classify_tier(combined_duration)

        new_highlight = SermonHighlight(
            project_id=suggestion.project_id,
            title=suggestion.merged_title,
            transcript_excerpt=combined_excerpt,
            quote_text=best_quote,
            start_time=time_ranges[0]["start"],
            end_time=time_ranges[-1]["end"],
            time_ranges=time_ranges,
            duration_tier=tier,
            is_merged=True,
        )
        session.add(new_highlight)

        # Mark suggestion as accepted
        suggestion.status = "accepted"
        session.add(suggestion)

        session.commit()
        session.refresh(new_highlight)

        new_id = new_highlight.id

    return AcceptResponse(
        suggestion_id=suggestion_id,
        new_highlight_id=new_id,
        message="Merge accepted -- new highlight created.",
    )


@router.post("/suggestion/{suggestion_id}/dismiss", response_model=DismissResponse)
async def dismiss_suggestion(suggestion_id: str):
    """Dismiss a merge suggestion."""
    with get_session() as session:
        suggestion = session.get(MergeSuggestion, suggestion_id)
        if not suggestion:
            raise HTTPException(status_code=404, detail="Suggestion not found")

        if suggestion.status != "pending":
            raise HTTPException(status_code=400, detail="Suggestion already processed")

        suggestion.status = "dismissed"
        session.add(suggestion)
        session.commit()

    return DismissResponse(
        suggestion_id=suggestion_id,
        message="Suggestion dismissed.",
    )
