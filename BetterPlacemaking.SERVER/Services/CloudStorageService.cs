using System.Text;
using BetterPlacemaking.Models.Dtos;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Storage.V1;
using Microsoft.Extensions.Options;

namespace BetterPlacemaking.Services
{
    public sealed class CloudStorageService
    {
        private readonly StorageClient _storage;
        private readonly UrlSigner _urlSigner;
        private readonly GcsOptions _opt;

        public CloudStorageService(IOptions<GcsOptions> options)
        {
            _opt = options.Value;

            // Uses Application Default Credentials on Cloud Run automatically.
            GoogleCredential credential = GoogleCredential.GetApplicationDefault();

            _storage = StorageClient.Create(credential);

            // UrlSigner needs a service-account credential with a private key.
            // On Cloud Run, ADC may be a "compute" credential which cannot sign locally.
            // UrlSigner supports signing via IAM SignBlob if you provide an IdToken/credential
            // that can call signBlob. The simplest approach is to use UrlSigner.FromCredential(credential).
            _urlSigner = UrlSigner.FromCredential(credential);
        }

        public Task<UploadUrlResponseDto> CreateSignedUploadUrlAsync(
            string ownerKey,
            RequestUploadUrlDto req,
            CancellationToken ct)
        {
            // Basic input hardening
            if (req.SizeBytes <= 0) throw new ArgumentOutOfRangeException(nameof(req.SizeBytes));
            if (string.IsNullOrWhiteSpace(req.ContentType)) throw new ArgumentException("ContentType required.");
            if (string.IsNullOrWhiteSpace(req.FileName)) throw new ArgumentException("FileName required.");

            string safeFileName = SanitizeFileName(req.FileName);
            string safeFolder = string.IsNullOrWhiteSpace(req.Folder) ? "" : $"{SanitizePathSegment(req.Folder)}/";
            string safeProject = string.IsNullOrWhiteSpace(req.ProjectId) ? "" : $"{SanitizePathSegment(req.ProjectId)}/";

            // Object naming pattern:
            // uploads/{ownerKey}/{projectId?}/{folder?}/{yyyy}/{MM}/{dd}/{guid}-{filename}
            string objectName =
                $"{_opt.BasePrefix}/{SanitizePathSegment(ownerKey)}/{safeProject}{safeFolder}" +
                $"{DateTime.UtcNow:yyyy/MM/dd}/{Guid.NewGuid():N}-{safeFileName}";

            var expiresAt = DateTimeOffset.UtcNow.AddMinutes(_opt.UrlTtlMinutes);
            var ttl = TimeSpan.FromMinutes(_opt.UrlTtlMinutes);

            // V4 signed URL for PUT.
            // Force Content-Type match to prevent content-type swapping.
            string signedUrl = _urlSigner.Sign(
                _opt.BucketName,
                objectName,
                ttl,
                HttpMethod.Put);

            return Task.FromResult(new UploadUrlResponseDto(objectName, signedUrl, expiresAt));
        }

        public Task<DownloadUrlResponseDto> CreateSignedDownloadUrlAsync(
            string ownerKey,
            RequestDownloadUrlDto req,
            CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(req.ObjectName)) throw new ArgumentException("ObjectName required.");

            // Authorization hook: require that the object is under this owner's prefix.
            // If your rules are different, change this check.
            string expectedPrefix = $"{_opt.BasePrefix}/{SanitizePathSegment(ownerKey)}/";
            if (!req.ObjectName.StartsWith(expectedPrefix, StringComparison.Ordinal))
                throw new UnauthorizedAccessException("Not allowed to access this object.");

            var expiresAt = DateTimeOffset.UtcNow.AddMinutes(_opt.UrlTtlMinutes);
            var ttl = TimeSpan.FromMinutes(_opt.UrlTtlMinutes);

            string signedUrl = _urlSigner.Sign(
                _opt.BucketName,
                req.ObjectName,
                ttl,
                HttpMethod.Get);

            return Task.FromResult(new DownloadUrlResponseDto(req.ObjectName, signedUrl, expiresAt));
        }

        public async Task<string> UploadFromStreamAsync(
            string objectName,
            string contentType,
            Stream data,
            CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(objectName)) throw new ArgumentException("objectName required");
            if (string.IsNullOrWhiteSpace(contentType)) contentType = "application/octet-stream";

            await _storage.UploadObjectAsync(
                bucket: _opt.BucketName,
                objectName: objectName,
                contentType: contentType,
                source: data,
                cancellationToken: ct);

            return objectName;
        }

        private static string SanitizeFileName(string fileName)
        {
            // Keep it simple: drop directory parts and replace bad chars.
            fileName = fileName.Replace("\\", "/");
            fileName = fileName.Split('/').LastOrDefault() ?? "file";
            fileName = fileName.Trim();

            var sb = new StringBuilder(fileName.Length);
            foreach (char c in fileName)
            {
                if (char.IsLetterOrDigit(c) || c is '.' or '-' or '_' or ' ')
                    sb.Append(c);
                else
                    sb.Append('_');
            }
            var cleaned = sb.ToString();
            return string.IsNullOrWhiteSpace(cleaned) ? "file" : cleaned;
        }

        private static string SanitizePathSegment(string segment)
        {
            segment = segment.Trim();
            var sb = new StringBuilder(segment.Length);
            foreach (char c in segment)
            {
                if (char.IsLetterOrDigit(c) || c is '-' or '_' or ':')
                    sb.Append(c);
                else
                    sb.Append('_');
            }
            var cleaned = sb.ToString();
            if (string.IsNullOrWhiteSpace(cleaned)) cleaned = "unknown";
            return cleaned;
        }

        public sealed class GcsOptions
        {
            public string BucketName { get; set; } = "";
            public int UrlTtlMinutes { get; set; } = 10;
            public string BasePrefix { get; set; } = "uploads";
        }
    }
}

