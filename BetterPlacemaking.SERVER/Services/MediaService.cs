using BetterPlacemaking.Models;
using Google.Cloud.Firestore;

namespace BetterPlacemaking.Services
{
    public sealed class MediaService(FirestoreDb db)
    {
        private readonly FirestoreDb _db = db;
        private const string CollectionName = "media";

        public Media Create(string pathFromRoot, string fileName, string extension)
        {
            if (string.IsNullOrWhiteSpace(pathFromRoot))
                throw new ArgumentException("PathFromRoot required.");

            string normalizedPath = pathFromRoot.Replace('\\', '/').Trim().Trim('/');
            if (string.IsNullOrWhiteSpace(normalizedPath))
                throw new ArgumentException("PathFromRoot required.");

            if (string.IsNullOrWhiteSpace(fileName))
                throw new ArgumentException("FileName required.");

            string nameWithoutExtension = Path.GetFileNameWithoutExtension(fileName.Replace('\\', '/'));
            nameWithoutExtension = nameWithoutExtension.Trim();
            if (string.IsNullOrWhiteSpace(nameWithoutExtension))
                throw new ArgumentException("FileName must not be empty.");

            if (string.IsNullOrWhiteSpace(extension))
                throw new ArgumentException("Extension required.");

            string normalizedExt = extension.Trim();
            if (!normalizedExt.StartsWith('.')) normalizedExt = $".{normalizedExt}";
            if (normalizedExt.Length < 2) throw new ArgumentException("Extension must be like .ply");

            for (int i = 1; i < normalizedExt.Length; i++)
                if (!char.IsLetterOrDigit(normalizedExt[i]))
                    throw new ArgumentException("Extension must be like .ply");

            var media = new Media
            {
                Id = string.Empty,
                Name = nameWithoutExtension,
                PathFromRoot = normalizedPath,
                Extension = normalizedExt,
                UploadedAtUtc = DateTime.UtcNow
            };

            var docRef = _db.Collection(CollectionName).Document();
            media.Id = docRef.Id;
            docRef.SetAsync(media).Wait();

            return media;
        }
    }
}
