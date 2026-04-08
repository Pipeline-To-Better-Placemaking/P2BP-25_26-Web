using Microsoft.AspNetCore.Http;

namespace BetterPlacemaking.Models.Dtos
{
    public sealed class UploadFloorplanLibraryItemForm
    {
        public IFormFile? Image { get; set; }

        public string? Nickname { get; set; }

        public string? ProjectId { get; set; }
    }

    public sealed record FloorplanCalibrationDto(
        List<List<double>> ReferencePoints,
        double ReferenceDistanceMm,
        double MmPerPixel,
        List<double> OriginFp,
        string CalibratedAtUtc
    );

    public sealed record FloorplanLibraryItemDto(
        string Id,
        string? ProjectId,
        string Nickname,
        string ImagePath,
        string? ImageDownloadUrl,
        DateTimeOffset? ImageDownloadUrlExpiresAt,
        string ImageContentType,
        long ImageSizeBytes,
        int ImageWidth,
        int ImageHeight,
        FloorplanCalibrationDto? Calibration,
        string CreatedAtUtc,
        string UpdatedAtUtc
    );

    public sealed record UpdateFloorplanLibraryItemDto(
        string? Nickname,
        string? ProjectId,
        List<List<double>>? ReferencePoints,
        double? ReferenceDistanceMm,
        double? MmPerPixel,
        List<double>? OriginFp
    );
}
