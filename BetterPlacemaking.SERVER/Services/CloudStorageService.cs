using System.Text;
using BetterPlacemaking.Models.Dtos;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Storage.V1;
using Microsoft.Extensions.Options;

namespace BetterPlacemaking.Services
{
    public sealed class GcsFileInfo
    {
        public string         StoragePath  { get; init; } = "";
        public DateTimeOffset LastModified { get; init; }
    }


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
            RequestUploadUrlDto req,
            CancellationToken ct)
        {
            // Basic input hardening
            if (req.SizeBytes <= 0) throw new ArgumentOutOfRangeException(nameof(req.SizeBytes));
            if (string.IsNullOrWhiteSpace(req.Extension)) throw new ArgumentException("Extension required.");
            if (string.IsNullOrWhiteSpace(req.FileName)) throw new ArgumentException("FileName required.");

            string objectName = BuildObjectPath(req.PathFromRoot, req.FileName, req.Extension);

            var expiresAt = DateTimeOffset.UtcNow.AddMinutes(_opt.UrlTtlMinutes);
            var ttl = TimeSpan.FromMinutes(_opt.UrlTtlMinutes);

            // V4 signed URL for PUT.
            string signedUrl = _urlSigner.Sign(
                _opt.BucketName,
                objectName,
                ttl,
                HttpMethod.Put);

            return Task.FromResult(new UploadUrlResponseDto(objectName, signedUrl, expiresAt));
        }

        public Task<DownloadUrlResponseDto> CreateSignedDownloadUrlAsync(
            RequestDownloadUrlDto req,
            CancellationToken ct)
        {
            string objectName = NormalizeObjectPath(req.PathFromRoot);

            var expiresAt = DateTimeOffset.UtcNow.AddMinutes(_opt.UrlTtlMinutes);
            var ttl = TimeSpan.FromMinutes(_opt.UrlTtlMinutes);

            string signedUrl = _urlSigner.Sign(
                _opt.BucketName,
                objectName,
                ttl,
                HttpMethod.Get);

            return Task.FromResult(new DownloadUrlResponseDto(objectName, signedUrl, expiresAt));
        }

        public string NormalizeObjectPath(string rawPath)
        {
            string objectPath = SanitizeObjectPath(rawPath);

            return objectPath;
        }

        public string BuildObjectPath(
            string rawDirectoryPath,
            string rawFileName,
            string rawExtension)
        {
            string directoryPath = NormalizeObjectPath(rawDirectoryPath).TrimEnd('/');
            string fileNameWithoutExtension = SanitizeFileName(rawFileName);
            string extension = NormalizeExtension(rawExtension);

            string fullPath = $"{directoryPath}/{fileNameWithoutExtension}{extension}";
            return NormalizeObjectPath(fullPath);
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

        public async Task DownloadToStreamAsync(string objectName, Stream destination, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(objectName)) throw new ArgumentException("objectName required");

            await _storage.DownloadObjectAsync(
                bucket: _opt.BucketName,
                objectName: objectName,
                destination: destination,
                cancellationToken: ct);
        }

        
        public async Task<IReadOnlyList<GcsFileInfo>> ListFilesAsync(
            string folder, CancellationToken ct = default)
        {
            // Ensure the prefix ends with '/' so we don't accidentally match
            // sibling folders that share a common prefix (e.g. "tracks-raw2").
            string prefix = folder.TrimEnd('/') + '/';

            var result  = new List<GcsFileInfo>();
            var request = _storage.ListObjectsAsync(_opt.BucketName, prefix);

            await foreach (var obj in request.WithCancellation(ct))
            {
                // Skip the folder placeholder object itself
                if (obj.Name.EndsWith('/')) continue;

                result.Add(new GcsFileInfo
                {
                    StoragePath  = obj.Name,
                    LastModified = obj.UpdatedDateTimeOffset ?? DateTimeOffset.MinValue
                });
            }

            return result;
        }

        private static string SanitizeObjectPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("PathFromRoot required.");

            path = path.Replace("\\", "/").Trim().Trim('/');
            if (path.Length == 0) throw new ArgumentException("PathFromRoot required.");

            var sb = new StringBuilder(path.Length);
            bool lastWasSlash = false;

            foreach (char c in path)
            {
                if (c == '/')
                {
                    if (!lastWasSlash)
                    {
                        sb.Append('/');
                        lastWasSlash = true;
                    }

                    continue;
                }

                lastWasSlash = false;
                if (char.IsLetterOrDigit(c) || c is '-' or '_' or ':' or '.' or ' ')
                    sb.Append(c);
                else
                    sb.Append('_');
            }

            var cleaned = sb.ToString().Trim('/');
            if (string.IsNullOrWhiteSpace(cleaned)) throw new ArgumentException("PathFromRoot required.");

            return cleaned;
        }

        private static string SanitizeFileName(string fileName)
        {
            if (string.IsNullOrWhiteSpace(fileName)) throw new ArgumentException("FileName required.");

            fileName = fileName.Replace("\\", "/");
            fileName = fileName.Split('/').LastOrDefault() ?? "file";
            fileName = Path.GetFileNameWithoutExtension(fileName).Trim();

            var sb = new StringBuilder(fileName.Length);
            foreach (char c in fileName)
            {
                if (char.IsLetterOrDigit(c) || c is '-' or '_' or ' ')
                    sb.Append(c);
                else
                    sb.Append('_');
            }

            string cleaned = sb.ToString();
            if (string.IsNullOrWhiteSpace(cleaned)) throw new ArgumentException("FileName required.");

            return cleaned;
        }

        private static string NormalizeExtension(string rawExtension)
        {
            if (string.IsNullOrWhiteSpace(rawExtension)) throw new ArgumentException("Extension required.");

            string ext = rawExtension.Trim();
            if (!ext.StartsWith('.')) ext = $".{ext}";
            ext = ext.TrimEnd('.');

            if (ext.Length < 2) throw new ArgumentException("Extension must be a file extension like .ply");

            var sb = new StringBuilder(ext.Length);
            sb.Append('.');
            for (int i = 1; i < ext.Length; i++)
            {
                char c = ext[i];
                if (char.IsLetterOrDigit(c))
                    sb.Append(char.ToLowerInvariant(c));
                else
                    throw new ArgumentException("Extension must be a file extension like .ply");
            }

            return sb.ToString();
        }

        public sealed class GcsOptions
        {
            public string BucketName    { get; set; } = "";
            public int    UrlTtlMinutes { get; set; } = 10;
            public string BasePrefix    { get; set; } = "uploads";
        }
    }
}