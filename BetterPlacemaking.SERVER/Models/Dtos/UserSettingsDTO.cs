namespace BetterPlacemaking.Models.Dtos;

public class UserSettingsDto
{
    public string? DisplayName { get; set; }

    public bool? EmailAlerts { get; set; }
    public bool? ScanCompletionAlerts { get; set; }
    public bool? ChangeDetectionAlerts { get; set; }
}
