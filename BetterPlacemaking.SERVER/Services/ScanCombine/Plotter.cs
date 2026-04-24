using SkiaSharp;
 
namespace BetterPlacemaking.Services.ScanCombine
{
       public class PlotOptions
    {
        public int PointRadius { get; set; } = 4;
        public SKColor PointColor { get; set; } = SKColors.Blue;
        public int Padding { get; set; } = 20;
    }
    public static class Plotter
    {
        public static byte[] Render(List<Point> points, double maxDistance, PlotOptions? options = null)
        {
            if (maxDistance <= 0)
                throw new ArgumentOutOfRangeException(nameof(maxDistance), "maxDistance must be positive.");
    
            options ??= new PlotOptions();
    
            int worldPixels = 1280;
            double scale = worldPixels / (2.0 * maxDistance);
            int canvasSize = worldPixels + options.Padding * 2;
            double cx = canvasSize / 2.0;
            double cy = canvasSize / 2.0;
    
            SKPoint ToPixel(double wx, double wy) => new((float)(cx + wx * scale), (float)(cy - wy * scale));
    
            var info = new SKImageInfo(canvasSize, canvasSize, SKColorType.Rgba8888, SKAlphaType.Premul);
            using var surface = SKSurface.Create(info);
            var canvas = surface.Canvas;
    
            canvas.Clear(SKColors.Transparent);
    
            using var fill = new SKPaint { Color = options.PointColor, IsAntialias = true, Style = SKPaintStyle.Fill };
            using var outline = new SKPaint { Color = SKColors.White, IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 1f };
    
            foreach (var pt in points)
            {
                var px = ToPixel(pt.x, pt.y);
                canvas.DrawCircle(px, options.PointRadius, fill);
                canvas.DrawCircle(px, options.PointRadius, outline);
            }
    
            using var image = surface.Snapshot();
            using var data = image.Encode(SKEncodedImageFormat.Png, 100);
            return data.ToArray();
        }
    } 
}

    