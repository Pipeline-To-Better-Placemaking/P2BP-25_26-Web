using System.Globalization;

namespace BetterPlacemaking.Services.ScanCombine
{
    public class CombineCloudsService
    {
        public CombinedScanResult CombineClouds(List<CombineCloudInput> inputs, string outputDirectory, string outputName)
        {
            if (inputs == null || inputs.Count < 2)
                throw new ArgumentException("At least two scans are required to combine point clouds.");

            Directory.CreateDirectory(outputDirectory);

            var safeBaseName = string.IsNullOrWhiteSpace(outputName) ? "calibrationScan" : outputName.Trim();
            var fileName = $"{safeBaseName}_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.xyz";
            var outputPath = Path.Combine(outputDirectory, fileName);

            using var writer = new StreamWriter(outputPath, append: false);

            foreach (var cloud in inputs)
            {
                var points = ReadXyz(cloud.XyzFilePath);
                var transformed = Manipulate(points, cloud.XTranslation, cloud.YTranslation, cloud.Theta);

                foreach (var p in transformed)
                {
                    writer.WriteLine(
                        $"{p.X.ToString(CultureInfo.InvariantCulture)} " +
                        $"{p.Y.ToString(CultureInfo.InvariantCulture)} " +
                        $"{p.Z.ToString(CultureInfo.InvariantCulture)}");
                }
            }

            return new CombinedScanResult
            {
                OutputFilePath = outputPath,
                OutputFileName = fileName
            };
        }

        private static List<XyzPoint> ReadXyz(string filePath)
        {
            if (!File.Exists(filePath))
                throw new FileNotFoundException($"XYZ file not found: {filePath}");

            var points = new List<XyzPoint>();

            using var reader = new StreamReader(filePath);
            string? line;

            while ((line = reader.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;

                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 3)
                    continue;

                points.Add(new XyzPoint(
                    Convert.ToDouble(parts[0], CultureInfo.InvariantCulture),
                    Convert.ToDouble(parts[1], CultureInfo.InvariantCulture),
                    Convert.ToDouble(parts[2], CultureInfo.InvariantCulture)
                ));
            }

            return points;
        }

        private static List<XyzPoint> Manipulate(List<XyzPoint> points, double xTranslation, double yTranslation, double theta)
        {
            var thetaRad = theta * Math.PI / 180.0;

            foreach (var n in points)
            {
                var r = n.Distance();

                // Safer than atan(y/x)
                var polarTheta = Math.Atan2(n.Y, n.X);
                var newTheta = polarTheta + thetaRad;

                n.X = r * Math.Cos(newTheta);
                n.Y = r * Math.Sin(newTheta);

                n.X += xTranslation;
                n.Y += yTranslation;
            }

            return points;
        }
    }
}