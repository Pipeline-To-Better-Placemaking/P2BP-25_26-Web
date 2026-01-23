
namespace BetterPlacemaking.Models.Dtos
{
    public sealed record RequestUploadUrlDto(
        string FileName,
        string ContentType,
        long SizeBytes,
        string? ProjectId = null,
        string? Folder = null
    );

    public sealed record UploadUrlResponseDto(
        string ObjectName,
        string SignedUrl,
        DateTimeOffset ExpiresAt
    );

    public sealed record RequestDownloadUrlDto(
        string ObjectName
    );

    public sealed record DownloadUrlResponseDto(
        string ObjectName,
        string SignedUrl,
        DateTimeOffset ExpiresAt
    );
}