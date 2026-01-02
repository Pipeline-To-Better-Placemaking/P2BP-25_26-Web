using BetterPlacemaking.Models.JetsonDTOs;

namespace BetterPlacemaking.Models.Dtos
{
    public class DeviceDto
    {
        public string? Id { get; set; }

        public string? ProjectId { get; set; }

        public string? Name { get; set; }

        public Config? Config { get; set; }
    }
}
