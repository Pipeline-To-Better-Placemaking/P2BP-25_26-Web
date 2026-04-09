namespace BetterPlacemaking.Models.Dtos;

public class ProjectNotificationPrefsUpdateDto
{
    public bool NotifyOnOwnScan { get; set; }
    public bool NotifyOnOthersScan { get; set; }
    public bool NotifyOnScheduledScan { get; set; }
    public bool NotifyOnSystemToggle { get; set; }
    public bool NotifyOnHealthAlert { get; set; }
    public bool EmailPdfOnSystemOff { get; set; }
}
