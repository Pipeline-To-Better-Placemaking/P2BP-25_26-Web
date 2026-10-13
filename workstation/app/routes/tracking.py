from fastapi import APIRouter, Depends, Query

from ..auth import current_user
from ..models import NOT_IMPLEMENTED, TrackingPath, TrackingPosition
from ._stub import not_implemented

router = APIRouter(prefix="/tracking", tags=["tracking"], dependencies=[Depends(current_user)])


@router.get("/positions", response_model=list[TrackingPosition], responses=NOT_IMPLEMENTED)
def get_positions(limit: int = Query(1000, ge=1, le=100000)):
    """Most recent per-frame detections, newest first.

    Will read the rolling positions CSV under DATA_ROOT (Express: getRecentPositions).
    """
    not_implemented()


@router.get("/tracks", response_model=list[TrackingPath], responses=NOT_IMPLEMENTED)
def list_tracks():
    """All finished tracks, one `*.json` file each under the tracks dir (Express: getAllTracks)."""
    not_implemented()


@router.get("/tracks/{global_id}", response_model=TrackingPath, responses=NOT_IMPLEMENTED)
def get_track(global_id: int):
    """One track by GlobalId; 404 when absent (Express: getTrackByGlobalId)."""
    not_implemented()
