from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from ..auth import current_user
from ..models import NOT_IMPLEMENTED, VisualizerFileInfo, VisualizerUploadRequest, VisualizerUploadResponse
from ._stub import not_implemented

router = APIRouter(prefix="/visualizer", tags=["visualizer"], dependencies=[Depends(current_user)])


@router.post("/files", response_model=VisualizerUploadResponse, responses=NOT_IMPLEMENTED)
def upload_visualizer_file(body: VisualizerUploadRequest):
    """Store an uploaded .obj/.xyz/.ply file (Express: /visualizer/upload/*)."""
    not_implemented()


@router.get("/files", response_model=list[VisualizerFileInfo], responses=NOT_IMPLEMENTED)
def list_visualizer_files():
    """List stored visualizer files."""
    not_implemented()


@router.get("/files/{filename}", response_class=FileResponse, responses=NOT_IMPLEMENTED)
def download_visualizer_file(filename: str):
    """Download a stored visualizer file (Express: /visualizer/export/*)."""
    not_implemented()
