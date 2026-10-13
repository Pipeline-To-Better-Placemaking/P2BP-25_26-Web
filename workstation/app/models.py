"""Pydantic models mirroring the Express API JSON shapes (field casing preserved)."""
from pydantic import BaseModel, Field


class NotImplementedNote(BaseModel):
    detail: str = "Not implemented"


NOT_IMPLEMENTED = {501: {"model": NotImplementedNote, "description": "Skeleton only"}}


# --- tracking (models/tracking.ts) ---
class TrackingPosition(BaseModel):
    GlobalId: int
    CameraId: str
    FrameIdx: int
    Timestamp: str
    XGround: float | None = None
    YGround: float | None = None
    X1: float
    Y1: float
    X2: float
    Y2: float
    Confidence: float


class Point3D(BaseModel):
    X: float
    Y: float
    Z: float


class PathPoint(BaseModel):
    Position: Point3D
    Timestamp: str


class TrackingPath(BaseModel):
    GlobalId: int
    CameraId: str
    Id: str
    IndividualId: str
    Points: list[PathPoint]
    StartTime: str
    EndTime: str
    FirstSeenFrame: int
    LastSeenFrame: int
    NumDetections: int


# --- rplidar scans ---
class ScanFileInfo(BaseModel):
    filename: str
    sizeBytes: int
    modified: str


class XyzUploadRequest(BaseModel):
    """Base64 JSON upload, matching the Express adapter (raw base64 or data: URL)."""
    FileName: str = Field(description="Must end in .xyz")
    FileBase64: str


class XyzUploadResponse(BaseModel):
    filename: str
    sizeBytes: int


# --- visualizer files ---
class VisualizerUploadRequest(BaseModel):
    FileName: str = Field(description="Must end in .obj, .xyz or .ply")
    FileBase64: str


class VisualizerUploadResponse(BaseModel):
    fileName: str


class VisualizerFileInfo(BaseModel):
    fileName: str
    sizeBytes: int


# --- calibration files ---
class CalibrationFileWrite(BaseModel):
    FileName: str = Field(description="Must end in .obj or .xyz")
    FileBase64: str


class CalibrationFileInfo(BaseModel):
    Id: str
    FileName: str
    SizeBytes: int
