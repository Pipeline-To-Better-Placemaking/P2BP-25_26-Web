using System.Text.Json.Serialization;

namespace BetterPlacemaking.Services.ScanCombine
{
    public class CombinedScanResult
    {
        public string OutputFilePath { get; set; } = "";
        public string OutputFileName { get; set; } = "";
    }

    public class CombineCloudInput
    {
        public required string XyzFilePath { get; set; }
        public double XTranslation { get; set; }
        public double YTranslation { get; set; }
        public double Theta { get; set; }
    }

    public class XyzPoint
    {
        public double X { get; set; }
        public double Y { get; set; }
        public double Z { get; set; }

        public XyzPoint(double x = 0, double y = 0, double z = 0)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public double Distance()
        {
            return Math.Sqrt(Math.Pow(X, 2) + Math.Pow(Y, 2));
        }
    }

    public class CombineScanItemRequest
    {
        public string ScanId { get; set; } = "";
        public double XTranslation { get; set; }
        public double YTranslation { get; set; }
        public double Theta { get; set; }
    }

    

public class CombineScansRequest
{
    public string OutputName { get; set; } = "calibrationScan";

    [JsonPropertyName("scalar_mm_per_pixel")]
    public double? ScalarMmPerPixel { get; set; }

    public List<CombineScanItemRequest> Items { get; set; } = new();
}
}