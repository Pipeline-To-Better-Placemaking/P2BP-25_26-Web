
namespace BetterPlacemaking.Models.Dtos
{
    public sealed record RequestUploadUrlDto(
        string PathFromRoot,
        string FileName,
        string Extension,
        long SizeBytes
    );

    public sealed record UploadUrlResponseDto(
        string PathFromRoot,
        string SignedUrl,
        DateTimeOffset ExpiresAt
    );

    public sealed record RequestDownloadUrlDto(
        string PathFromRoot
    );

    public sealed record DownloadUrlResponseDto(
        string PathFromRoot,
        string SignedUrl,
        DateTimeOffset ExpiresAt
    );

    public sealed record ConfirmUploadedMediaDto(
        string PathFromRoot,
        string FileName,
        string Extension
    );

    public sealed record MediaRecordResponseDto(
        string Id,
        string Name,
        string PathFromRoot,
        string Extension
    );
}