// FusionEngine.cs
// Full C# rewrite of fusionFinal.py
// Dependencies (NuGet): YamlDotNet, OpenCvSharp4

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using OpenCvSharp;

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
public static class FusionConfig
{
    public const string InputFile       = "tracks_events.jsonl";
    public const string OutputFile      = "fused_tracks.json";
    public const string IntrinsicsFile  = "ANNKE_camera_intrinsics.yml";

    public const double SimThreshold    = 0.75;
    public const double MaxSpeedPxPerS  = 4000.0;   // pixels per second
    public const double MaxGapMs        = 12000.0;  // ms
    public const int    MinTrackPoints  = 8;
    public const double MinDurationS    = 1.0;
    public const double MaxJumpClean    = 6000.0;
    public const double DupEps          = 1e-3;
    public const int    SmoothWin       = 2;
}

// ─────────────────────────────────────────────
// DATA MODELS
// ─────────────────────────────────────────────
public class TrackEvent
{
    public double X   { get; set; }
    public double Y   { get; set; }
    public long   Time { get; set; }
    public string Cam  { get; set; } = "";
    public int    Sid  { get; set; }
}

public class TrackObject
{
    public string Cam { get; set; } = "";
    public int Sid { get; set; }
    public float[] Rep { get; set; } = Array.Empty<float>();
    public long TStart { get; set; }
    public long TEnd { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public List<TrackEvent> Events { get; set; } = new();
}

public class FusedIdentity
{
    public int Gid { get; set; }
    public float[] Rep { get; set; } = Array.Empty<float>();
    public long TStart { get; set; }
    public long TEnd { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public List<List<TrackEvent>> Tracks  { get; set; } = new();
    public List<(string Cam, int Sid)> Sources { get; set; } = new();
}

public class FusionRequest
{
    public string  InputFilePath { get; set; } = FusionConfig.InputFile;
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
}

public class FusionResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = "";
    public object? Data { get; set; }
}

// ─────────────────────────────────────────────
// MATH HELPERS  (replaces numpy + sklearn)
// ─────────────────────────────────────────────
public static class VectorMath
{
    /// <summary>Cosine similarity between two vectors (replaces sklearn cosine_similarity)</summary>
    public static double CosineSimilarity(float[] a, float[] b)
    {
        if (a.Length != b.Length)
            throw new ArgumentException("Vectors must be same length");

        double dot = 0, normA = 0, normB = 0;
        for (int i = 0; i < a.Length; i++)
        {
            dot   += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        double denom = Math.Sqrt(normA) * Math.Sqrt(normB);
        return denom < 1e-9 ? 0.0 : dot / denom;
    }

    /// <summary>Element-wise mean of a list of vectors (replaces np.mean)</summary>
    public static float[] Mean(List<float[]> vectors)
    {
        if (vectors.Count == 0)
            throw new ArgumentException("Empty vector list");

        int len = vectors[0].Length;
        var result = new float[len];

        foreach (var v in vectors)
            for (int i = 0; i < len; i++)
                result[i] += v[i];

        for (int i = 0; i < len; i++)
            result[i] /= vectors.Count;

        return result;
    }

    /// <summary>Running average of two reps (replaces (a + b) / 2)</summary>
    public static float[] AverageReps(float[] a, float[] b)
    {
        var result = new float[a.Length];
        for (int i = 0; i < a.Length; i++)
            result[i] = (a[i] + b[i]) / 2f;
        return result;
    }

    public static double Hypot(double dx, double dy)
        => Math.Sqrt(dx * dx + dy * dy);
}

// ─────────────────────────────────────────────
// KALMAN FILTER 2D  (replaces Python Kalman2D)
// ─────────────────────────────────────────────
public class Kalman2D
{
    // State: [x, y, vx, vy]
    private double[] _x = new double[4];
    private double[,] _P = new double[4, 4];
    private readonly double[,] _H;
    private readonly double[,] _Q;
    private readonly double[,] _R;

    public Kalman2D()
    {
        // Identity * 100
        for (int i = 0; i < 4; i++) _P[i, i] = 100.0;

        // Observation matrix H = [[1,0,0,0],[0,1,0,0]]
        _H = new double[2, 4];
        _H[0, 0] = 1; _H[1, 1] = 1;

        // Process noise
        _Q = new double[4, 4];
        for (int i = 0; i < 4; i++) _Q[i, i] = 0.01;

        // Measurement noise
        _R = new double[2, 2];
        _R[0, 0] = 5.0; _R[1, 1] = 5.0;
    }

    public (double x, double y) Update(double zx, double zy, double dt)
    {
        // Build F (state transition)
        var F = new double[4, 4];
        F[0, 0] = 1; F[0, 2] = dt;
        F[1, 1] = 1; F[1, 3] = dt;
        F[2, 2] = 1;
        F[3, 3] = 1;

        // Predict
        _x = MatVec(F, _x);
        _P = MatAdd(MatMul(MatMul(F, _P), Transpose(F)), _Q);

        // Innovation
        double[] z   = { zx, zy };
        double[] Hx  = MatVec(_H, _x);
        double[] y   = { z[0] - Hx[0], z[1] - Hx[1] };

        // S = H P H' + R
        var S = MatAdd(MatMul(MatMul(_H, _P), Transpose(_H)), _R);

        // K = P H' S^-1
        var PH   = MatMul(_P, Transpose(_H));
        var Sinv = Invert2x2(S);
        var K    = MatMul(PH, Sinv);   // 4x2

        // Update
        double[] Ky = { K[0, 0]*y[0] + K[0, 1]*y[1],
                        K[1, 0]*y[0] + K[1, 1]*y[1],
                        K[2, 0]*y[0] + K[2, 1]*y[1],
                        K[3, 0]*y[0] + K[3, 1]*y[1] };

        _x[0] += Ky[0]; _x[1] += Ky[1];
        _x[2] += Ky[2]; _x[3] += Ky[3];

        // P = (I - K H) P
        var KH   = MatMul(K, _H);
        var IKH  = new double[4, 4];
        for (int i = 0; i < 4; i++) IKH[i, i] = 1;
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++)
                IKH[i, j] -= KH[i, j];

        _P = MatMul(IKH, _P);

        return (_x[0], _x[1]);
    }

    // ── tiny matrix helpers ──────────────────
    private static double[,] MatMul(double[,] A, double[,] B)
    {
        int r = A.GetLength(0), k = A.GetLength(1), c = B.GetLength(1);
        var R = new double[r, c];
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++)
                for (int m = 0; m < k; m++)
                    R[i, j] += A[i, m] * B[m, j];
        return R;
    }

    private static double[] MatVec(double[,] A, double[] v)
    {
        int r = A.GetLength(0), c = A.GetLength(1);
        var R = new double[r];
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++)
                R[i] += A[i, j] * v[j];
        return R;
    }

    private static double[,] MatAdd(double[,] A, double[,] B)
    {
        int r = A.GetLength(0), c = A.GetLength(1);
        var R = new double[r, c];
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++)
                R[i, j] = A[i, j] + B[i, j];
        return R;
    }

    private static double[,] Transpose(double[,] A)
    {
        int r = A.GetLength(0), c = A.GetLength(1);
        var R = new double[c, r];
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++)
                R[j, i] = A[i, j];
        return R;
    }

    private static double[,] Invert2x2(double[,] M)
    {
        double det = M[0, 0]*M[1, 1] - M[0, 1]*M[1, 0];
        if (Math.Abs(det) < 1e-12) det = 1e-12;
        return new double[,]
        {
            {  M[1, 1]/det, -M[0, 1]/det },
            { -M[1, 0]/det,  M[0, 0]/det }
        };
    }
}

// ─────────────────────────────────────────────
// HOMOGRAPHY LOADER  (replaces cv2.FileStorage)
// ─────────────────────────────────────────────
public static class HomographyLoader
{
    /// <summary>
    /// Loads all *_homography.yml files in a folder.
    /// Uses OpenCvSharp FileStorage — same format as Python cv2.FileStorage.
    /// </summary>
    public static Dictionary<string, double[,]> Load(string folder = ".")
    {
        var result = new Dictionary<string, double[,]>();

        foreach (var file in Directory.GetFiles(folder, "*_homography.yml"))
        {
            string fname = Path.GetFileName(file);
            string mac   = fname
                .Replace("_homography.yml", "")
                .Replace("_", ":")
                .ToLower();

            using var fs = new FileStorage(file, FileStorage.Mode.Read);
            if (!fs.IsOpened()) continue;

            var node = fs["homography"];
            if (node.Empty)
                continue;

            using Mat H = node.ReadMat();
            if (H.Empty() || H.Rows != 3 || H.Cols != 3)
                continue;

            var arr = new double[3, 3];

            for (int r = 0; r < 3; r++)
            {
                for (int c = 0; c < 3; c++)
                {
                    if (H.Type() == MatType.CV_64F)
                        arr[r, c] = H.At<double>(r, c);
                    else if (H.Type() == MatType.CV_32F)
                        arr[r, c] = H.At<float>(r, c);
                    else
                        throw new Exception($"Unsupported homography type: {H.Type()}");
                }
            }
        }

        return result;
    }
}

// ─────────────────────────────────────────────
// JSONL LOADER
// ─────────────────────────────────────────────
public static class JsonlLoader
{
    public static (Dictionary<(string, int), List<float[]>> vectors,
                   Dictionary<(string, int), List<TrackEvent>> tracks)
        Load(string path)
    {
        var vectors = new Dictionary<(string, int), List<float[]>>();
        var tracks  = new Dictionary<(string, int), List<TrackEvent>>();

        foreach (var line in File.ReadLines(path))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            var obj = JsonNode.Parse(line);
            if (obj == null) continue;

            string? mac = obj["mac"]?.GetValue<string>()?.ToLower();
            int?    sid = obj["sid"]?.GetValue<int>();
            string? type = obj["type"]?.GetValue<string>();

            if (mac == null || sid == null || type == null) continue;

            var key = (mac, sid.Value);

            if (type == "vector")
            {
                var arr    = obj["vector"]!.AsArray();
                var vector = arr.Select(v => v!.GetValue<float>()).ToArray();

                if (!vectors.ContainsKey(key)) vectors[key] = new();
                vectors[key].Add(vector);
            }
            else if (type == "track")
            {
                long t = obj["time"]?.GetValue<long>() ?? 0;
                double x = obj["x"]?.GetValue<double>() ?? 0;
                double y = obj["y"]?.GetValue<double>() ?? 0;

                if (!tracks.ContainsKey(key)) tracks[key] = new();
                tracks[key].Add(new TrackEvent { X = x, Y = y, Time = t, Cam = mac, Sid = sid.Value });
            }
        }

        return (vectors, tracks);
    }
}

// ─────────────────────────────────────────────
// TRACK BUILDER
// ─────────────────────────────────────────────
public static class TrackBuilder
{
    public static List<TrackObject> Build(
        Dictionary<(string, int), List<float[]>> vectors,
        Dictionary<(string, int), List<TrackEvent>> tracks)
    {
        var objs = new List<TrackObject>();

        foreach (var (key, vecs) in vectors)
        {
            if (!tracks.TryGetValue(key, out var evs) || evs.Count == 0)
                continue;

            evs = evs.OrderBy(e => e.Time).ToList();
            var rep = VectorMath.Mean(vecs);

            objs.Add(new TrackObject
            {
                Cam    = key.Item1,
                Sid    = key.Item2,
                Rep    = rep,
                TStart = evs.First().Time,
                TEnd   = evs.Last().Time,
                X      = evs.Last().X,
                Y      = evs.Last().Y,
                Events = evs
            });
        }

        return objs.OrderBy(o => o.TStart).ToList();
    }
}

// ─────────────────────────────────────────────
// HOMOGRAPHY TRANSFORM  (replaces apply_homographies)
// ─────────────────────────────────────────────
public static class WorldTransform
{
    public static void Apply(
        List<TrackObject> trackObjs,
        Dictionary<string, double[,]> homographies)
    {
        foreach (var track in trackObjs)
        {
            if (!homographies.TryGetValue(track.Cam, out var H))
                continue;

            var kf       = new Kalman2D();
            long? prevT  = null;

            foreach (var e in track.Events)
            {
                // No undistortion (same as fusion2.py test mode)
                double ux = e.X, uy = e.Y;

                // Apply homography: p = H * [ux, uy, 1]
                double p0 = H[0, 0]*ux + H[0, 1]*uy + H[0, 2];
                double p1 = H[1, 0]*ux + H[1, 1]*uy + H[1, 2];
                double p2 = H[2, 0]*ux + H[2, 1]*uy + H[2, 2];

                if (Math.Abs(p2) < 1e-9) continue;

                double wx = p0 / p2;
                double wy = p1 / p2;

                double dt = prevT == null ? 0.0 : Math.Max(1e-3, (e.Time - prevT.Value) / 1000.0);

                var (fx, fy) = kf.Update(wx, wy, dt);
                e.X = fx;
                e.Y = fy;

                prevT = e.Time;
            }

            var last = track.Events.Last();
            track.X  = last.X;
            track.Y  = last.Y;
        }
    }
}

// ─────────────────────────────────────────────
// FUSION ENGINE  (replaces offline_fusion)
// ─────────────────────────────────────────────
public class FusionEngine
{
    private readonly bool _debug;

    public FusionEngine(bool debug = false) => _debug = debug;

    // ── Physics check ─────────────────────────
    private (bool teleport, double dist, double dtMs, double speed)
        TeleportMetrics(FusedIdentity gid, TrackObject track)
    {
        double dx   = track.X - gid.X;
        double dy   = track.Y - gid.Y;
        double dist = VectorMath.Hypot(dx, dy);
        double dtMs = track.TStart - gid.TEnd;

        if (dtMs <= 0) return (false, dist, dtMs, 0.0);

        double speed    = dist / (dtMs / 1000.0);
        bool teleport   = speed > FusionConfig.MaxSpeedPxPerS;

        return (teleport, dist, dtMs, speed);
    }

    // ── Time gap check ────────────────────────
    private (bool ok, double gapMs) TimeCompatible(FusedIdentity gid, TrackObject track)
    {
        double gap = track.TStart - gid.TEnd;
        return (gap <= FusionConfig.MaxGapMs, gap);
    }

    // ── Temporal overlap (same camera = different person) ─
    private bool Overlaps(FusedIdentity gid, TrackObject track)
    {
        string gidCam = gid.Tracks[0][0].Cam;
        if (track.Cam != gidCam) return false;

        return track.TStart <= gid.TEnd && track.TEnd >= gid.TStart;
    }

    // ── Main fusion loop ──────────────────────
    public List<FusedIdentity> Run(List<TrackObject> trackObjs)
    {
        var gids    = new List<FusedIdentity>();
        int nextGid = 0;

        foreach (var track in trackObjs)
        {
            FusedIdentity? best = null;
            double bestSim      = -1;

            if (_debug)
                Console.WriteLine($"\n[FUSION] track cam={track.Cam} sid={track.Sid}");

            foreach (var candidate in gids)
            {
                // 1. PHYSICS
                var (teleport, dist, dtMs, speed) = TeleportMetrics(candidate, track);
                if (teleport)
                {
                    if (_debug)
                        Console.WriteLine($"  gid={candidate.Gid} rejected (teleport) " +
                                          $"dist={dist:F2} dt={dtMs}ms speed={speed:F2}");
                    continue;
                }

                // 2. TIME OVERLAP (same-camera = different person)
                if (Overlaps(candidate, track))
                {
                    if (_debug)
                        Console.WriteLine($"  gid={candidate.Gid} rejected (time overlap - same camera)");
                    continue;
                }

                // 3. TIME GAP
                var (okTime, gapMs) = TimeCompatible(candidate, track);
                if (!okTime)
                {
                    if (_debug)
                        Console.WriteLine($"  gid={candidate.Gid} rejected (time gap) gap={gapMs}ms");
                    continue;
                }

                // 4. APPEARANCE (cosine similarity — replaces sklearn)
                double sim = VectorMath.CosineSimilarity(track.Rep, candidate.Rep);

                if (_debug)
                    Console.WriteLine($"  gid={candidate.Gid} sim={sim:F3}");

                if (sim < FusionConfig.SimThreshold)
                {
                    if (_debug) Console.WriteLine("     rejected (low similarity)");
                    continue;
                }

                if (sim > bestSim)
                {
                    bestSim = sim;
                    best    = candidate;
                }
            }

            // ASSIGN OR CREATE
            if (best == null)
            {
                if (_debug) Console.WriteLine("  → NEW GID");

                gids.Add(new FusedIdentity
                {
                    Gid    = nextGid++,
                    Rep    = track.Rep,
                    TStart = track.TStart,
                    TEnd   = track.TEnd,
                    X      = track.X,
                    Y      = track.Y,
                    Tracks = new List<List<TrackEvent>> { track.Events }
                });
            }
            else
            {
                if (_debug)
                    Console.WriteLine($"  → MERGED into gid={best.Gid} (sim={bestSim:F3})");

                best.Rep  = VectorMath.AverageReps(best.Rep, track.Rep);
                best.TEnd = track.TEnd;
                best.X    = track.X;
                best.Y    = track.Y;
                best.Tracks.Add(track.Events);
            }
        }

        // Flatten + collect sources
        foreach (var gid in gids)
        {
            var flat = gid.Tracks
                .SelectMany(t => t)
                .OrderBy(e => e.Time)
                .ToList();

            // Store flat list back as a single-element list of lists
            gid.Tracks = new List<List<TrackEvent>> { flat };

            var seen = new HashSet<(string, int)>();
            foreach (var e in flat)
            {
                var src = (e.Cam, e.Sid);
                if (seen.Add(src))
                    gid.Sources.Add(src);
            }
        }

        return gids;
    }
}

// ─────────────────────────────────────────────
// TRACK CLEANING  (replaces clean_track)
// ─────────────────────────────────────────────
public static class TrackCleaner
{
    private static List<TrackEvent> RemoveDuplicates(List<TrackEvent> track)
    {
        if (track.Count == 0) return track;
        var cleaned = new List<TrackEvent> { track[0] };
        foreach (var p in track.Skip(1))
        {
            var prev = cleaned.Last();
            if (Math.Abs(p.X - prev.X) > FusionConfig.DupEps ||
                Math.Abs(p.Y - prev.Y) > FusionConfig.DupEps)
                cleaned.Add(p);
        }
        return cleaned;
    }

    private static List<TrackEvent> RemoveLargeJumps(List<TrackEvent> track)
    {
        if (track.Count == 0) return track;
        var cleaned = new List<TrackEvent> { track[0] };
        foreach (var p in track.Skip(1))
        {
            var prev = cleaned.Last();
            if (p.Cam != prev.Cam) { cleaned.Add(p); continue; }
            double d = VectorMath.Hypot(p.X - prev.X, p.Y - prev.Y);
            if (d < FusionConfig.MaxJumpClean) cleaned.Add(p);
        }
        return cleaned;
    }

    private static List<TrackEvent> Smooth(List<TrackEvent> track)
    {
        int n       = track.Count;
        int win     = FusionConfig.SmoothWin;
        var result  = new List<TrackEvent>(n);

        for (int i = 0; i < n; i++)
        {
            double sx = 0, sy = 0;
            int count = 0;
            for (int j = Math.Max(0, i - win); j <= Math.Min(n - 1, i + win); j++)
            {
                sx += track[j].X;
                sy += track[j].Y;
                count++;
            }
            result.Add(new TrackEvent
            {
                X    = sx / count,
                Y    = sy / count,
                Time = track[i].Time,
                Cam  = track[i].Cam,
                Sid  = track[i].Sid
            });
        }
        return result;
    }

    public static List<TrackEvent>? Clean(List<TrackEvent> track)
    {
        if (track.Count == 0) return null;

        track = RemoveDuplicates(track);
        track = RemoveLargeJumps(track);
        track = Smooth(track);

        double duration = (track.Last().Time - track.First().Time) / 1000.0;
        if (track.Count < FusionConfig.MinTrackPoints || duration < FusionConfig.MinDurationS)
            return null;

        return track;
    }
}

// ─────────────────────────────────────────────
// EXPORTER
// ─────────────────────────────────────────────
public static class FusionExporter
{
    public static void Export(List<FusedIdentity> gids, string outputPath)
    {
        var out_ = new Dictionary<string, object>();

        int idx = 0;
        foreach (var g in gids)
        {
            var flatEvents = g.Tracks.SelectMany(t => t).ToList();
            var cleaned    = TrackCleaner.Clean(flatEvents);

            if (cleaned == null) continue;

            var trajectory = cleaned.Select(e => new
            {
                x   = e.X,
                y   = e.Y,
                t   = e.Time,
                cam = e.Cam
            }).ToList();

            out_[idx.ToString()] = new
            {
                sources    = g.Sources.Select(s => new { cam = s.Cam, sid = s.Sid }),
                num_events = trajectory.Count,
                tracks     = trajectory
            };
            idx++;
        }

        var json = JsonSerializer.Serialize(out_, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(outputPath, json);
    }
}

// ─────────────────────────────────────────────
// MAIN SERVICE  (wire everything together)
// ─────────────────────────────────────────────
public class FusionService
{
    private readonly string _workingDir;
    private readonly string _outputFile;

    public FusionService(string workingDir, string outputFile = FusionConfig.OutputFile)
    {
        _workingDir = workingDir;
        _outputFile = outputFile;
    }

    public FusionResult Run(FusionRequest request, bool debug = false)
    {
        try
        {
            string inputPath = request.InputFilePath;

            // Optional: filter by timeframe
            if (request.From.HasValue && request.To.HasValue)
                inputPath = FilterByTime(inputPath, request.From.Value, request.To.Value);

            // 1. Load data
            var (vectors, tracks) = JsonlLoader.Load(inputPath);

            // 2. Build track objects
            var trackObjs = TrackBuilder.Build(vectors, tracks);

            // 3. Load homographies
            var homos = HomographyLoader.Load(_workingDir);

            // 4. Apply world transform (homography + Kalman)
            WorldTransform.Apply(trackObjs, homos);

            // 5. Fuse identities
            var engine = new FusionEngine(debug);
            var gids   = engine.Run(trackObjs);

            // 6. Export
            string outputPath = Path.Combine(_workingDir, _outputFile);
            FusionExporter.Export(gids, outputPath);

            Console.WriteLine($"[DONE] {gids.Count} fused identities written to {outputPath}");

            var json = File.ReadAllText(outputPath);
            var data = JsonSerializer.Deserialize<object>(json);

            return new FusionResult { Success = true, Data = data };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ERROR] {ex.Message}");
            return new FusionResult { Success = false, Message = ex.Message };
        }
    }

    // Filter .jsonl by Unix ms timestamps
    private string FilterByTime(string path, DateTime from, DateTime to)
    {
        long fromMs = new DateTimeOffset(from).ToUnixTimeMilliseconds();
        long toMs   = new DateTimeOffset(to).ToUnixTimeMilliseconds();

        var filtered = File.ReadLines(path)
            .Where(line =>
            {
                if (string.IsNullOrWhiteSpace(line)) return false;
                using var doc = System.Text.Json.JsonDocument.Parse(line);
                if (doc.RootElement.TryGetProperty("time", out var t))
                {
                    long ts = t.GetInt64();
                    return ts >= fromMs && ts <= toMs;
                }
                return false;
            })
            .ToList();

        string tempPath = Path.Combine(_workingDir, $"filtered_{Guid.NewGuid()}.jsonl");
        File.WriteAllLines(tempPath, filtered);
        return tempPath;
    }
}

// ─────────────────────────────────────────────
// ENTRY POINT (for standalone console testing)
// ─────────────────────────────────────────────
public class TestProgram
{
    public static void Main(string[] args)
    {
        string workingDir = args.Length > 0
            ? args[0]
            : Directory.GetCurrentDirectory();

        string inputFile = args.Length > 1
            ? args[1]
            : Path.Combine(workingDir, FusionConfig.InputFile);

        var service = new FusionService(workingDir);
        var result  = service.Run(new FusionRequest { InputFilePath = inputFile }, debug: true);

        if (!result.Success)
        {
            Console.Error.WriteLine($"Fusion failed: {result.Message}");
            Environment.Exit(1);
        }
    }
}
