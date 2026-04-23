using Google.Cloud.Firestore;

namespace BetterPlacemaking.Models;

[FirestoreData]
public class ScanSchedule
{
    [FirestoreDocumentId]
    public string? Id { get; set; }

    [FirestoreProperty]
    public string? StartDate { get; set; }

    [FirestoreProperty]
    public string? StartTime { get; set; }

    [FirestoreProperty]
    public string? Frequency { get; set; }

    [FirestoreProperty]
    public string? EndDate { get; set; }

    [FirestoreProperty]
    public string? EndTime { get; set; }

    [FirestoreProperty]
    public Timestamp CreatedAt { get; set; }

    [FirestoreProperty]
    public string? CreatedByUserId { get; set; }

    [FirestoreProperty]
    public Timestamp? LastRunAt { get; set; }
}
