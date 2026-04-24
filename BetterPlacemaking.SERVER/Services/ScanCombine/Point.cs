namespace BetterPlacemaking.Services.ScanCombine
{
    public class Point
    {
        public double x
        {get; set;}
        public double y
        {get; set;}

        public Point(double x = 0, double y = 0)
        {
            this.x = x;
            this.y = y;
        }

        public double distance()
        {
            double distance = Math.Sqrt(Math.Pow(this.x, 2) + Math.Pow(this.y, 2));
            return distance;
        }
    }
}