using System.Globalization;

namespace BetterPlacemaking.Services.ScanCombine
{
    public class ScanFlattenPreviewService
    {
        public byte[] RenderPreviewPng(string xyzFilePath, double threshold = -2.75, bool useThreshold = true)
        {
            if (!File.Exists(xyzFilePath))
                throw new FileNotFoundException($"XYZ file not found: {xyzFilePath}");

            var points = new List<Point>();
            double maxDistance = 0;

            using var reader = new StreamReader(xyzFilePath);
            string? line;

            while ((line = reader.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;

                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 3)
                    continue;

                var x = Convert.ToDouble(parts[0], CultureInfo.InvariantCulture);
                var y = Convert.ToDouble(parts[1], CultureInfo.InvariantCulture);
                var z = Convert.ToDouble(parts[2], CultureInfo.InvariantCulture);

                if (useThreshold && z <= threshold)
                    continue;

                var point = new Point(x, y);
                points.Add(point);

                var dist = point.distance();
                if (dist > maxDistance)
                    maxDistance = dist;
            }

            if (points.Count == 0 || maxDistance <= 0)
                throw new InvalidOperationException("No valid XY points were found to render a preview.");

            return Plotter.Render(points, maxDistance);
        }
    }
}