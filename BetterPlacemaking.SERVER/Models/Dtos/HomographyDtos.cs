namespace BetterPlacemaking.Models.Dtos
{
    public sealed record SubmitLocalHomographyDto(
        string CameraMac,
        List<List<double>> Matrix,
        List<int> FrameSize,
        int Inliers,
        double RmseBoard,
        int CornersUsed,
        int MarkersDetected,
        string ArucoDict,
        int SquaresX,
        int SquaresY,
        double SquareLength,
        double MarkerLength,
        double TimestampUnix,
        string? SnapshotPath = null,
        List<List<double>>? CameraMatrix = null,
        List<double>? DistortionCoefficients = null,
        bool? UsedUndistortedImage = null
    );

    public sealed record LocalHomographyResponseDto(
        string HomographyId,
        string CameraMac
    );

    public sealed record ArucoMarkerSightingDto(
        int MarkerId,
        List<List<double>> CornersPx
    );

    public sealed record SubmitArucoSightingsDto(
        string CameraMac,
        string ArucoDict,
        string CapturedAt,
        List<ArucoMarkerSightingDto> Markers,
        string? SessionId = null,
        string? LocalHomographyHash = null
    );

    public sealed record ArucoSightingsResponseDto(
        string SessionId,
        string Status,
        List<string> CamerasCheckedIn,
        int CamerasTotal
    );

    public sealed record CameraIntrinsicsResponseDto(
        string CameraMac,
        List<List<double>> CameraMatrix,
        List<double> DistortionCoefficients,
        double TimestampUnix
    );

    public sealed record ComputeLockResponseDto(
        string Status,
        int CamerasComputed
    );

    public sealed record SessionStatusResponseDto(
        string SessionId,
        string Status,
        List<string> CamerasCheckedIn,
        int CamerasTotal,
        string CreatedAt
    );

    public sealed record IntrinsicsSightingDto(
        int CornerCount,
        List<List<double>> ImagePoints,  // [[x,y], ...]
        List<int> CornerIds,
        List<int> FrameSize,             // [width, height]
        double Rmse,
        string CapturedAt
    );

    public sealed record SubmitIntrinsicsSightingsDto(
        string CameraMac,
        bool IsPerUnit,
        string? ModelId,
        List<IntrinsicsSightingDto> Sightings
    );

    public sealed record IntrinsicsSightingsResponseDto(
        int SightingsStored
    );

    public sealed record SubmitIntrinsicsResultDto(
        string CameraMac,
        bool IsPerUnit,
        string? ModelId,
        List<List<double>> CameraMatrix,
        List<double> DistortionCoefficients,
        double ReprojectionError,
        int SightingsUsed
    );

    public sealed record IntrinsicsResultResponseDto(
        string Id,
        string? CameraMac,
        string? ModelId,
        bool IsPerUnit,
        List<List<double>> CameraMatrix,
        List<double> DistortionCoefficients,
        double ReprojectionError,
        int SightingsUsed,
        double ComputedAtUnix
    );

    public sealed record PuzzlePieceMetadataDto(
        string PuzzlePieceId,
        string DeviceId,
        string CameraMac,
        string LocalHomographyId,
        string LocalHomographyHash,
        List<List<double>> HLocalCanvas,
        List<int> SourceFrameSize,
        List<int> PuzzlePieceSize,
        string? SourceSnapshotPath,
        bool UsedUndistortedImage,
        string UndistortMode,
        double BboxTrimPct,
        string HomographyFile,
        string? MetadataPath,
        string? MetadataDownloadUrl,
        DateTimeOffset? MetadataDownloadUrlExpiresAt,
        string GeneratedAt
    );

    public sealed record PuzzlePieceDto(
        string PuzzlePieceId,
        string DeviceId,
        string CameraMac,
        string Status,
        string? PuzzlePiecePath,
        string? PuzzlePieceDownloadUrl,
        DateTimeOffset? PuzzlePieceDownloadUrlExpiresAt,
        PuzzlePieceMetadataDto? Metadata,
        string? Error
    );

    public sealed record LocalHomographyWorkspaceDto(
        string HomographyId,
        string DeviceId,
        string CameraMac,
        List<List<double>> Matrix,
        List<int> FrameSize,
        double TimestampUnix,
        string? SnapshotPath,
        bool? UsedUndistortedImage,
        string LocalHomographyHash
    );

    public sealed record HomographyLockGroupDto(
        string GroupId,
        List<string> CameraMacs
    );

    public sealed record GlobalHomographyPlacementDto(
        string PuzzlePieceId,
        string DeviceId,
        string CameraMac,
        List<double> CenterFp,
        double AngleDeg,
        double Scale,
        List<List<double>> HLocalCanvas,
        List<int> LocalCanvasSize,
        List<List<double>> GlobalHomographyFloorplan,
        List<List<double>> GlobalHomography
    );

    public sealed record GlobalHomographySetDto(
        string ProjectId,
        string? FloorplanId,
        double MmPerFpPx,
        List<double> OriginFp,
        List<int> FloorplanSize,
        List<GlobalHomographyPlacementDto> Placements,
        List<HomographyLockGroupDto> LockedGroups,
        string SavedAt,
        string? SavedByUserId
    );

    public sealed record PuzzleWorkspaceResponseDto(
        string ProjectId,
        List<PuzzlePieceDto> PuzzlePieces,
        List<PuzzlePieceMetadataDto> PuzzlePieceMetaFiles,
        List<LocalHomographyWorkspaceDto> LocalHomographies,
        GlobalHomographySetDto? GlobalHomographies,
        List<HomographyLockGroupDto> LockedGroups
    );

    public sealed record SaveGlobalHomographyPlacementDto(
        string PuzzlePieceId,
        string DeviceId,
        string CameraMac,
        List<double> CenterFp,
        double AngleDeg,
        double Scale,
        List<List<double>> HLocalCanvas,
        List<int> LocalCanvasSize
    );

    public sealed record SaveGlobalHomographiesDto(
        string? FloorplanId,
        double MmPerFpPx,
        List<double> OriginFp,
        List<int> FloorplanSize,
        List<SaveGlobalHomographyPlacementDto> Placements,
        List<HomographyLockGroupDto>? LockedGroups = null
    );

    public sealed record SaveGlobalHomographiesResponseDto(
        string ProjectId,
        int PlacementsSaved,
        string SavedAt,
        GlobalHomographySetDto GlobalHomographies
    );
}
