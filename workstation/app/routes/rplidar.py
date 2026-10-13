from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from ..auth import current_user
from ..models import NOT_IMPLEMENTED, ScanFileInfo, XyzUploadRequest, XyzUploadResponse
from ._stub import not_implemented

router = APIRouter(prefix="/rplidar", tags=["rplidar"], dependencies=[Depends(current_user)])


@router.get("/scans", response_model=list[ScanFileInfo], responses=NOT_IMPLEMENTED)
def list_scans():
    """List `.xyz` scan files in the scan directory, newest first (Express: listScanFiles)."""
    not_implemented()


@router.get("/scans/{filename}/download", response_class=FileResponse, responses=NOT_IMPLEMENTED)
def download_scan(filename: str):
    """Download one `.xyz` scan; filename is confined under DATA_ROOT via safe_path."""
    not_implemented()


@router.post("/upload", response_model=XyzUploadResponse, responses=NOT_IMPLEMENTED)
def upload_scan(body: XyzUploadRequest):
    """Write a base64-encoded `.xyz` file into the scan directory."""
    not_implemented()
