import os
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/merge", tags=["merge"])


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54421")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    return create_client(url, key)


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
    supabase = get_supabase()

    result = supabase.table("merge_suggestions").select("*").eq(
        "project_id", project_id
    ).eq("status", "pending").order("created_at").execute()

    suggestions = result.data or []
    if not suggestions:
        return SuggestionsListResponse(suggestions=[])

    # Collect all highlight IDs across suggestions
    all_highlight_ids = set()
    for s in suggestions:
        all_highlight_ids.update(s["highlight_ids"])

    # Fetch highlight details
    highlights_result = supabase.table("sermon_highlights").select("*").in_(
        "id", list(all_highlight_ids)
    ).execute()
    highlights_by_id = {h["id"]: h for h in (highlights_result.data or [])}

    response_suggestions = []
    for s in suggestions:
        highlight_details = [
            highlights_by_id[hid] for hid in s["highlight_ids"] if hid in highlights_by_id
        ]
        response_suggestions.append(MergeSuggestionResponse(
            id=s["id"],
            project_id=s["project_id"],
            highlight_ids=s["highlight_ids"],
            reason=s["reason"],
            merged_title=s["merged_title"],
            merged_start_time=float(s["merged_start_time"]),
            merged_end_time=float(s["merged_end_time"]),
            confidence=s["confidence"],
            status=s["status"],
            highlights=highlight_details,
        ))

    return SuggestionsListResponse(suggestions=response_suggestions)


@router.post("/suggestion/{suggestion_id}/accept", response_model=AcceptResponse)
async def accept_suggestion(suggestion_id: str):
    """Accept a merge suggestion — creates a new merged highlight."""
    supabase = get_supabase()

    # Fetch the suggestion
    result = supabase.table("merge_suggestions").select("*").eq(
        "id", suggestion_id
    ).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    suggestion_data = result.data[0]

    suggestion = suggestion_data
    if suggestion["status"] != "pending":
        raise HTTPException(status_code=400, detail="Suggestion already processed")

    # Fetch constituent highlights
    highlights_result = supabase.table("sermon_highlights").select("*").in_(
        "id", suggestion["highlight_ids"]
    ).order("start_time").execute()
    highlights = highlights_result.data or []

    if len(highlights) < 2:
        raise HTTPException(status_code=400, detail="Source highlights not found")

    # Build merged highlight with multi-segment time ranges
    combined_excerpt = " ".join(h["transcript_excerpt"] for h in highlights)
    best_quote = max(highlights, key=lambda h: len(h["quote_text"]))["quote_text"]

    # Build time_ranges from source highlights (already ordered by start_time)
    time_ranges = [
        {"start": float(h["start_time"]), "end": float(h["end_time"])}
        for h in highlights
    ]
    combined_duration = sum(r["end"] - r["start"] for r in time_ranges)
    tier = _classify_tier(combined_duration)

    new_highlight = supabase.table("sermon_highlights").insert({
        "project_id": suggestion["project_id"],
        "church_id": suggestion.get("church_id"),
        "title": suggestion["merged_title"],
        "transcript_excerpt": combined_excerpt,
        "quote_text": best_quote,
        "start_time": time_ranges[0]["start"],
        "end_time": time_ranges[-1]["end"],
        "time_ranges": time_ranges,
        "duration_tier": tier,
        "is_merged": True,
    }).execute()

    # Mark suggestion as accepted
    supabase.table("merge_suggestions").update({
        "status": "accepted"
    }).eq("id", suggestion_id).execute()

    return AcceptResponse(
        suggestion_id=suggestion_id,
        new_highlight_id=new_highlight.data[0]["id"],
        message="Merge accepted — new highlight created.",
    )


@router.post("/suggestion/{suggestion_id}/dismiss", response_model=DismissResponse)
async def dismiss_suggestion(suggestion_id: str):
    """Dismiss a merge suggestion."""
    supabase = get_supabase()

    result = supabase.table("merge_suggestions").select("id, status").eq(
        "id", suggestion_id
    ).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    if result.data[0]["status"] != "pending":
        raise HTTPException(status_code=400, detail="Suggestion already processed")

    supabase.table("merge_suggestions").update({
        "status": "dismissed"
    }).eq("id", suggestion_id).execute()

    return DismissResponse(
        suggestion_id=suggestion_id,
        message="Suggestion dismissed.",
    )
