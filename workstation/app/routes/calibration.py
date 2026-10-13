from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from ..auth import current_user
from ..models import NOT_IMPLEMENTED, CalibrationFileInfo, CalibrationFileWrite
from ._stub import not_implemented

router = APIRouter(prefix="/calibration", tags=["calibration"], dependencies=[Depends(current_user)])


@router.get("/{project_id}/{device_id}/{scan_id}", response_class=FileResponse, responses=NOT_IMPLEMENTED)
def read_calibration_file(project_id: str, device_id: str, scan_id: str):
    """Read a calibration .xyz/.obj file (Express: resolveLocalXyzPath + download)."""
    not_implemented()


@router.post("/{project_id}/{device_id}", response_model=CalibrationFileInfo, responses=NOT_IMPLEMENTED)
def write_calibration_file(project_id: str, device_id: str, body: CalibrationFileWrite):
    """Write an uploaded calibration file under DATA_ROOT (Express: upload-xyz)."""
    not_implemented()
