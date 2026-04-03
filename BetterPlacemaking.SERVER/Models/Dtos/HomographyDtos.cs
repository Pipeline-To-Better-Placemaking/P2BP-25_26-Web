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
        List<double>? DistortionCoefficients = null
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
}
