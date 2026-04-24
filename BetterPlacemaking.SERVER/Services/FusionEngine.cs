// FusionEngine.cs
// Dependencies (NuGet): YamlDotNet, OpenCvSharp4, Google.Cloud.Firestore

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using OpenCvSharp;
using Google.Cloud.Firestore;
using BetterPlacemaking.Services;

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
public static class FusionEngineConfig
{
    public const string InputStorageFolder  = "vision/tracks-raw";   // folder containing JSONL files
    public const string OutputStorageFolder = "vision/tracks-fused";

    public const double SimThreshold       = 0.75;

    // World coordinates are in millimetres (homography output).
    // 8 m/s ≈ fast jogging — anything faster is almost certainly a different person or a vehicle.
    public const double MaxSpeedWorldPerS  = 8000.0;   // mm / s

    // Hard absolute distance cap between gid endpoint and new track start,
    // applied independently of the speed/time math. 30 m ≈ across a small plaza.
    public const double MaxJumpFusion      = 30000.0;  // mm

    public const double MaxGapMs           = 12000.0;
    public const int    MinTrackPoints     = 8;
    public const double MinDurationS       = 1.0;
    public const double MaxJumpClean       = 6000.0;   // mm — per-point jump filter
    public const double DupEps             = 1e-3;
    public const int    SmoothWin          = 2;
}

// ─────────────────────────────────────────────
// DATA MODELS
// ─────────────────────────────────────────────
public class TrackEvent
{
    public double X    { get; set; }
    public double Y    { get; set; }
    public long   Time { get; set; }
    public string Cam  { get; set; } = "";
    public int    Sid  { get; set; }
}

public class TrackObject
{
    public string           Cam    { get; set; } = "";
    public int              Sid    { get; set; }
    public float[]          Rep    { get; set; } = Array.Empty<float>();
    public long             TStart { get; set; }
    public long             TEnd   { get; set; }
    public double           X      { get; set; }
    public double           Y      { get; set; }
    public List<TrackEvent> Events { get; set; } = new();
}

public class FusedIdentity
{
    public int                         Gid     { get; set; }
    public float[]                     Rep     { get; set; } = Array.Empty<float>();
    public long                        TStart  { get; set; }
    public long                        TEnd    { get; set; }
    public double                      X       { get; set; }
    public double                      Y       { get; set; }
    public List<List<TrackEvent>>      Tracks  { get; set; } = new();
    public List<(string Cam, int Sid)> Sources { get; set; } = new();
}

public class FusionRequest
{
    /// <summary>GCS folder containing raw JSONL track files. Defaults to FusionEngineConfig.InputStorageFolder.</summary>
    public string? InputStorageFolder { get; set; }

    /// <summary>GCS folder to write the fused output JSON. Defaults to FusionEngineConfig.OutputStorageFolder.</summary>
    public string? OutputStorageFolder { get; set; }

    /// <summary>
    /// Start of the date range (inclusive) selected by the user in the UI calendar.
    /// Required — fusion will throw if not provided.
    /// </summary>
    public DateTime? From { get; set; }

    /// <summary>
    /// End of the date range (inclusive) selected by the user in the UI calendar.
    /// Required — fusion will throw if not provided.
    /// </summary>
    public DateTime? To { get; set; }
}

public class FusionResult
{
    public bool    Success { get; set; }
    public string  Message { get; set; } = "";
    public object? Data    { get; set; }
}

// ─────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────
public static class VectorMath
{
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

    public static float[] Mean(List<float[]> vectors)
    {
        if (vectors.Count == 0)
            throw new ArgumentException("Empty vector list");

        int len    = vectors[0].Length;
        var result = new float[len];
        foreach (var v in vectors)
            for (int i = 0; i < len; i++)
                result[i] += v[i];
        for (int i = 0; i < len; i++)
            result[i] /= vectors.Count;
        return result;
    }

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
// KALMAN FILTER 2D
// ─────────────────────────────────────────────
public class Kalman2D
{
    // State
    private readonly double[]  _x = new double[4];
    private readonly double[,] _P = new double[4, 4];

    // Constant matrices
    private readonly double[,] _H  = new double[2, 4];
    private readonly double[,] _Ht = new double[4, 2];  // transpose of H, constant
    private readonly double[,] _Q  = new double[4, 4];
    private readonly double[,] _R  = new double[2, 2];

    // Scratch buffers — preallocated once, reused every Update() call.
    // The original implementation allocated ~10 small matrices per Update,
    // which is ~O(millions) tiny heap allocations across a full fusion run
    // and is the single biggest source of invisible GC pressure in this file.
    private readonly double[,] _F    = new double[4, 4];
    private readonly double[,] _Ft   = new double[4, 4];
    private readonly double[,] _FP   = new double[4, 4];
    private readonly double[,] _FPFt = new double[4, 4];
    private readonly double[,] _Pnew = new double[4, 4];
    private readonly double[]  _xNew = new double[4];
    private readonly double[]  _Hx   = new double[2];
    private readonly double[]  _y    = new double[2];
    private readonly double[,] _HP   = new double[2, 4];
    private readonly double[,] _HPHt = new double[2, 2];
    private readonly double[,] _S    = new double[2, 2];
    private readonly double[,] _Sinv = new double[2, 2];
    private readonly double[,] _PHt  = new double[4, 2];
    private readonly double[,] _K    = new double[4, 2];
    private readonly double[,] _KH   = new double[4, 4];
    private readonly double[,] _IKH  = new double[4, 4];

    public Kalman2D()
    {
        for (int i = 0; i < 4; i++) _P[i, i] = 100.0;

        _H[0, 0] = 1; _H[1, 1] = 1;
        // H^T is constant since H is constant.
        _Ht[0, 0] = 1; _Ht[1, 1] = 1;

        for (int i = 0; i < 4; i++) _Q[i, i] = 0.01;
        _R[0, 0] = 5.0; _R[1, 1] = 5.0;

        // F is mostly identity. Only F[0,2] and F[1,3] (the dt cells) change per call.
        _F[0, 0] = 1; _F[1, 1] = 1; _F[2, 2] = 1; _F[3, 3] = 1;
        // F^T is identity except for two dt cells that change per call (F[0,2] -> Ft[2,0], etc.).
        _Ft[0, 0] = 1; _Ft[1, 1] = 1; _Ft[2, 2] = 1; _Ft[3, 3] = 1;
    }

    public (double x, double y) Update(double zx, double zy, double dt)
    {
        // ── Predict ──
        _F[0, 2] = dt;   _F[1, 3] = dt;
        _Ft[2, 0] = dt;  _Ft[3, 1] = dt;

        // x = F · x   (write to scratch, then copy into _x)
        MatVec4x4(_F, _x, _xNew);
        Array.Copy(_xNew, _x, 4);

        // P = F · P · F^T + Q
        MatMul4x4(_F,  _P,  _FP);
        MatMul4x4(_FP, _Ft, _FPFt);
        AddInto4x4(_FPFt, _Q, _P);   // safe: _P is only written, not read

        // ── Update ──
        // Hx = H · x
        MatVec2x4(_H, _x, _Hx);
        _y[0] = zx - _Hx[0];
        _y[1] = zy - _Hx[1];

        // S = H · P · H^T + R     (2×2)
        MatMul2x4_4x4(_H,  _P,  _HP);
        MatMul2x4_4x2(_HP, _Ht, _HPHt);
        _S[0, 0] = _HPHt[0, 0] + _R[0, 0];
        _S[0, 1] = _HPHt[0, 1] + _R[0, 1];
        _S[1, 0] = _HPHt[1, 0] + _R[1, 0];
        _S[1, 1] = _HPHt[1, 1] + _R[1, 1];

        Invert2x2Into(_S, _Sinv);

        // K = P · H^T · S^-1      (4×2)
        MatMul4x4_4x2(_P,   _Ht,   _PHt);
        MatMul4x2_2x2(_PHt, _Sinv, _K);

        // x += K · y
        _x[0] += _K[0, 0] * _y[0] + _K[0, 1] * _y[1];
        _x[1] += _K[1, 0] * _y[0] + _K[1, 1] * _y[1];
        _x[2] += _K[2, 0] * _y[0] + _K[2, 1] * _y[1];
        _x[3] += _K[3, 0] * _y[0] + _K[3, 1] * _y[1];

        // P = (I - K · H) · P
        MatMul4x2_2x4(_K, _H, _KH);
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++)
                _IKH[i, j] = (i == j ? 1.0 : 0.0) - _KH[i, j];
        MatMul4x4(_IKH, _P, _Pnew);
        Array.Copy(_Pnew, _P, 16);

        return (_x[0], _x[1]);
    }

    // ─── In-place matrix/vector ops (no allocations) ────────────────────

    private static void MatMul4x4(double[,] A, double[,] B, double[,] R)
    {
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++)
            {
                double s = 0;
                for (int k = 0; k < 4; k++) s += A[i, k] * B[k, j];
                R[i, j] = s;
            }
    }

    private static void MatMul2x4_4x4(double[,] A, double[,] B, double[,] R)
    {
        for (int i = 0; i < 2; i++)
            for (int j = 0; j < 4; j++)
            {
                double s = 0;
                for (int k = 0; k < 4; k++) s += A[i, k] * B[k, j];
                R[i, j] = s;
            }
    }

    private static void MatMul2x4_4x2(double[,] A, double[,] B, double[,] R)
    {
        for (int i = 0; i < 2; i++)
            for (int j = 0; j < 2; j++)
            {
                double s = 0;
                for (int k = 0; k < 4; k++) s += A[i, k] * B[k, j];
                R[i, j] = s;
            }
    }

    private static void MatMul4x4_4x2(double[,] A, double[,] B, double[,] R)
    {
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 2; j++)
            {
                double s = 0;
                for (int k = 0; k < 4; k++) s += A[i, k] * B[k, j];
                R[i, j] = s;
            }
    }

    private static void MatMul4x2_2x2(double[,] A, double[,] B, double[,] R)
    {
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 2; j++)
            {
                double s = 0;
                for (int k = 0; k < 2; k++) s += A[i, k] * B[k, j];
                R[i, j] = s;
            }
    }

    private static void MatMul4x2_2x4(double[,] A, double[,] B, double[,] R)
    {
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++)
            {
                double s = 0;
                for (int k = 0; k < 2; k++) s += A[i, k] * B[k, j];
                R[i, j] = s;
            }
    }

    private static void MatVec4x4(double[,] A, double[] v, double[] R)
    {
        for (int i = 0; i < 4; i++)
        {
            double s = 0;
            for (int j = 0; j < 4; j++) s += A[i, j] * v[j];
            R[i] = s;
        }
    }

    private static void MatVec2x4(double[,] A, double[] v, double[] R)
    {
        for (int i = 0; i < 2; i++)
        {
            double s = 0;
            for (int j = 0; j < 4; j++) s += A[i, j] * v[j];
            R[i] = s;
        }
    }

    private static void AddInto4x4(double[,] A, double[,] B, double[,] R)
    {
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++)
                R[i, j] = A[i, j] + B[i, j];
    }

    private static void Invert2x2Into(double[,] M, double[,] R)
    {
        double det = M[0, 0] * M[1, 1] - M[0, 1] * M[1, 0];
        if (Math.Abs(det) < 1e-12) det = 1e-12;
        R[0, 0] =  M[1, 1] / det;
        R[0, 1] = -M[0, 1] / det;
        R[1, 0] = -M[1, 0] / det;
        R[1, 1] =  M[0, 0] / det;
    }
}

// ─────────────────────────────────────────────
// CAMERA INTRINSICS
// ─────────────────────────────────────────────
public class FusionCameraIntrinsics
{
    public double[,] CameraMatrix { get; set; } = new double[3, 3];
    public double[]  DistCoeffs   { get; set; } = Array.Empty<double>();

    public static FusionCameraIntrinsics? Load(string path)
    {
        if (!File.Exists(path)) return null;

        var yaml = new YamlDotNet.Serialization.DeserializerBuilder().Build();
        var raw  = yaml.Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
        if (raw == null) return null;

        var intrinsics = new FusionCameraIntrinsics();

        if (!raw.TryGetValue("camera_matrix", out var camRaw)) return null;
        var rows = (List<object>)camRaw;
        for (int r = 0; r < 3; r++)
        {
            var cols = (List<object>)rows[r];
            for (int c = 0; c < 3; c++)
                intrinsics.CameraMatrix[r, c] = Convert.ToDouble(cols[c]);
        }

        if (!raw.TryGetValue("distortion_coefficients", out var distRaw)) return null;
        var outer = (List<object>)distRaw;
        List<object> coeffList = outer.Count > 0 && outer[0] is List<object>
            ? (List<object>)outer[0]
            : outer;
        intrinsics.DistCoeffs = coeffList.Select(v => Convert.ToDouble(v)).ToArray();

        return intrinsics;
    }
}

// ─────────────────────────────────────────────
// LENS UNDISTORTION
// ─────────────────────────────────────────────
public static class LensUndistort
{
    public static (double ux, double uy) UndistortPoint(
        double px, double py, double[,] K, double[] D)
    {
        double fx = K[0,0], fy = K[1,1];
        double cx = K[0,2], cy = K[1,2];

        double x = (px - cx) / fx;
        double y = (py - cy) / fy;

        double k1 = D.Length > 0 ? D[0] : 0;
        double k2 = D.Length > 1 ? D[1] : 0;
        double p1 = D.Length > 2 ? D[2] : 0;
        double p2 = D.Length > 3 ? D[3] : 0;
        double k3 = D.Length > 4 ? D[4] : 0;

        double x0 = x, y0 = y;
        for (int iter = 0; iter < 20; iter++)
        {
            double r2     = x*x + y*y;
            double r4     = r2*r2;
            double r6     = r4*r2;
            double radial = 1.0 + k1*r2 + k2*r4 + k3*r6;
            double tangX  = 2*p1*x*y        + p2*(r2 + 2*x*x);
            double tangY  = p1*(r2 + 2*y*y) + 2*p2*x*y;
            x = (x0 - tangX) / radial;
            y = (y0 - tangY) / radial;
        }
        return (x*fx + cx, y*fy + cy);
    }
}

// ─────────────────────────────────────────────
// HOMOGRAPHY ENTRY
// ─────────────────────────────────────────────
public class HomographyEntry
{
    public double[,] Matrix               { get; set; } = new double[3, 3];
    public bool      UsedUndistortedImage { get; set; }
}

// ─────────────────────────────────────────────
// FIRESTORE CONFIG LOADER
// ─────────────────────────────────────────────
public class FusionFirestoreLoader
{
    private readonly FirestoreDb _db;

    public FusionFirestoreLoader(FirestoreDb db) => _db = db;

    public async Task<Dictionary<string, HomographyEntry>> LoadHomographiesAsync(
        ISet<string> cameraMacs, CancellationToken ct = default)
    {
        var result = new Dictionary<string, HomographyEntry>(StringComparer.OrdinalIgnoreCase);

        QuerySnapshot snapshot;
        try
        {
            snapshot = await _db.Collection("locked_homographies").GetSnapshotAsync(ct);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[WARN] Could not read locked_homographies: {ex.Message}");
            return result;
        }

        foreach (var doc in snapshot.Documents)
        {
            if (!TryGetMac(doc, out string mac)) continue;
            if (!cameraMacs.Contains(mac))        continue;

            var entry = ParseHomographyDoc(doc, mac);
            if (entry != null)
            {
                result[mac] = entry;
                Console.WriteLine($"[INFO] Homography loaded from Firestore: {doc.Id}");
            }
            else
            {
                Console.WriteLine($"[WARN] Homography document {doc.Id} could not be parsed — skipped.");
            }
        }

        if (result.Count == 0)
            Console.WriteLine("[WARN] No homographies found in locked_homographies for the active cameras.");

        return result;
    }

    public async Task<Dictionary<string, FusionCameraIntrinsics>> LoadIntrinsicsAsync(
        ISet<string> cameraMacs, CancellationToken ct = default)
    {
        var result = new Dictionary<string, FusionCameraIntrinsics>(StringComparer.OrdinalIgnoreCase);

        QuerySnapshot snapshot;
        try
        {
            snapshot = await _db.Collection("camera_intrinsics").GetSnapshotAsync(ct);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[WARN] Could not read camera_intrinsics: {ex.Message} — undistortion skipped.");
            return result;
        }

        // Index model-level docs (IsPerUnit == false, no CameraMac) by their doc ID (= ModelId)
        // so we can fall back to them for MACs whose per-unit doc is missing.
        var modelDocs = new Dictionary<string, DocumentSnapshot>(StringComparer.OrdinalIgnoreCase);

        // First pass: per-unit docs matched by CameraMac field or {deviceId}_{mac} doc ID.
        foreach (var doc in snapshot.Documents)
        {
            bool hasCameraMac = doc.TryGetValue("CameraMac", out string? storedMac)
                                && !string.IsNullOrWhiteSpace(storedMac);
            bool isPerUnit = !doc.TryGetValue("IsPerUnit", out bool pu) || pu;

            if (!hasCameraMac && !isPerUnit)
            {
                modelDocs[doc.Id] = doc;
                continue;
            }

            if (!TryGetMac(doc, out string mac)) continue;
            if (!cameraMacs.Contains(mac))        continue;

            var intrinsics = ParseIntrinsicsDoc(doc, mac);
            if (intrinsics != null)
            {
                result[mac] = intrinsics;
                Console.WriteLine($"[INFO] Intrinsics loaded from Firestore: {doc.Id}");
            }
            else
            {
                Console.WriteLine($"[WARN] Intrinsics document {doc.Id} could not be parsed — undistortion skipped for cam={mac}.");
            }
        }

        // Second pass: for any MAC still unresolved, detect its model from the MAC prefix
        // and look up the corresponding model-level doc.
        var unresolved = cameraMacs.Where(m => !result.ContainsKey(m)).ToList();
        if (unresolved.Count > 0 && modelDocs.Count > 0)
        {
            foreach (var mac in unresolved)
            {
                var modelId = DetectModelFromMac(mac);
                if (modelId == null || !modelDocs.TryGetValue(modelId, out var modelDoc))
                {
                    Console.WriteLine($"[WARN] cam={mac}: no per-unit intrinsics and no matching model-level doc — undistortion skipped.");
                    continue;
                }

                var intrinsics = ParseIntrinsicsDoc(modelDoc, mac);
                if (intrinsics != null)
                {
                    result[mac] = intrinsics;
                    Console.WriteLine($"[INFO] Intrinsics for cam={mac} resolved from model-level doc '{modelId}'.");
                }
                else
                {
                    Console.WriteLine($"[WARN] cam={mac}: model-level doc '{modelId}' could not be parsed — undistortion skipped.");
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Maps MAC address prefixes to camera model IDs.
    /// Must be kept in sync with MAC_PREFIX_TO_MODEL in camera_onboard.py.
    /// </summary>
    private static readonly Dictionary<string, string> MacPrefixToModel = new(StringComparer.OrdinalIgnoreCase)
    {
        { "d0:3b:f4", "ANNKE" },
    };

    private static string? DetectModelFromMac(string mac)
    {
        var normalized = mac.Trim().ToLowerInvariant();
        foreach (var (prefix, model) in MacPrefixToModel)
            if (normalized.StartsWith(prefix))
                return model;
        return null;
    }

    private static bool TryGetMac(DocumentSnapshot doc, out string mac)
    {
        if (doc.TryGetValue("CameraMac", out string? stored) && !string.IsNullOrWhiteSpace(stored))
        {
            mac = stored.ToLower().Trim();
            return true;
        }
        int idx = doc.Id.IndexOf('_');
        if (idx < 1 || idx == doc.Id.Length - 1) { mac = ""; return false; }
        mac = doc.Id[(idx + 1)..].ToLower();
        return true;
    }

    private static bool TryParseMatrix3x3Flat(DocumentSnapshot doc, string field, string mac,
        out double[,] matrix)
    {
        matrix = new double[3, 3];

        if (!doc.TryGetValue(field, out IReadOnlyList<object> flat) || flat.Count != 9)
        {
            Console.WriteLine($"[WARN] cam={mac}: '{field}' missing or not a 9-element flat array.");
            return false;
        }

        for (int i = 0; i < 9; i++)
            matrix[i / 3, i % 3] = Convert.ToDouble(flat[i]);

        return true;
    }

    private static HomographyEntry? ParseHomographyDoc(DocumentSnapshot doc, string mac)
    {
        if (!TryParseMatrix3x3Flat(doc, "MatrixFlat", mac, out var matrix))
            return null;

        return new HomographyEntry { Matrix = matrix, UsedUndistortedImage = false };
    }

    private static FusionCameraIntrinsics? ParseIntrinsicsDoc(DocumentSnapshot doc, string mac)
    {
        if (!TryParseMatrix3x3Flat(doc, "CameraMatrixFlat", mac, out var cameraMatrix))
            return null;

        if (!doc.TryGetValue("DistortionCoefficients", out IReadOnlyList<object> distRaw))
        {
            Console.WriteLine($"[WARN] cam={mac}: 'DistortionCoefficients' field missing.");
            return null;
        }

        return new FusionCameraIntrinsics
        {
            CameraMatrix = cameraMatrix,
            DistCoeffs   = distRaw.Select(Convert.ToDouble).ToArray()
        };
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

            string? mac  = obj["mac"]?.GetValue<string>()?.ToLower();
            int?    sid  = obj["sid"]?.GetValue<int>();
            string? type = obj["type"]?.GetValue<string>();
            if (mac == null || sid == null || type == null) continue;

            var key = (mac, sid.Value);

            if (type == "vector")
            {
                var vector = obj["vector"]!.AsArray()
                    .Select(v => v!.GetValue<float>()).ToArray();
                if (!vectors.ContainsKey(key)) vectors[key] = new();
                vectors[key].Add(vector);
            }
            else if (type == "track")
            {
                long   t = obj["time"]?.GetValue<long>()   ?? 0;
                double x = obj["x"]?.GetValue<double>()    ?? 0;
                double y = obj["y"]?.GetValue<double>()    ?? 0;
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
        Dictionary<(string, int), List<float[]>>    vectors,
        Dictionary<(string, int), List<TrackEvent>> tracks)
    {
        var objs = new List<TrackObject>();

        foreach (var (key, vecs) in vectors)
        {
            if (!tracks.TryGetValue(key, out var evs) || evs.Count == 0) continue;

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
// HOMOGRAPHY TRANSFORM
// ─────────────────────────────────────────────
public static class WorldTransform
{
    public static void Apply(
        List<TrackObject>                           trackObjs,
        Dictionary<string, HomographyEntry>         homographies,
        Dictionary<string, FusionCameraIntrinsics>? intrinsicsPerCam = null)
    {
        foreach (var track in trackObjs)
        {
            if (!homographies.TryGetValue(track.Cam, out var entry))
            {
                Console.WriteLine($"[WARN] No homography for cam={track.Cam} — skipped.");
                continue;
            }

            FusionCameraIntrinsics? intrinsics = null;
            intrinsicsPerCam?.TryGetValue(track.Cam, out intrinsics);

            bool doUndist = entry.UsedUndistortedImage && intrinsics != null;

            if (entry.UsedUndistortedImage && intrinsics == null)
                Console.WriteLine($"[WARN] cam={track.Cam}: homography expects undistorted " +
                                  $"input but no intrinsics found in Firestore.");

            var   H     = entry.Matrix;
            var   kf    = new Kalman2D();
            long? prevT = null;

            foreach (var e in track.Events)
            {
                double ux = e.X, uy = e.Y;

                if (doUndist && intrinsics != null)
                    (ux, uy) = LensUndistort.UndistortPoint(
                        e.X, e.Y,
                        intrinsics.CameraMatrix,
                        intrinsics.DistCoeffs);

                double p0 = H[0,0]*ux + H[0,1]*uy + H[0,2];
                double p1 = H[1,0]*ux + H[1,1]*uy + H[1,2];
                double p2 = H[2,0]*ux + H[2,1]*uy + H[2,2];

                if (Math.Abs(p2) < 1e-9) continue;

                double wx = p0 / p2;
                double wy = p1 / p2;

                double dt = prevT == null
                    ? 0.0
                    : Math.Max(1e-3, (e.Time - prevT.Value) / 1000.0);

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
// FUSION ENGINE
// ─────────────────────────────────────────────
public class FusionEngine
{
    private readonly bool _debug;
    public FusionEngine(bool debug = false) => _debug = debug;

    /// <summary>
    /// Distance between the gid's last known position and the new track's FIRST position
    /// (where the person would have to "re-appear" coming out of the gap), divided by the
    /// elapsed time end-of-old → start-of-new. Negative or zero gaps are treated as
    /// teleports (the new track starts before or simultaneously with the gid's end).
    /// </summary>
    private (bool teleport, double dist, double dtMs, double speed)
        TeleportMetrics(FusedIdentity gid, TrackObject track)
    {
        var trackStart = track.Events.First();
        double dx      = trackStart.X - gid.X;
        double dy      = trackStart.Y - gid.Y;
        double dist    = VectorMath.Hypot(dx, dy);
        double dtMs    = track.TStart - gid.TEnd;

        // Time-inverted or zero-gap → infinite implied speed → reject as teleport.
        if (dtMs <= 0)
            return (true, dist, dtMs, double.PositiveInfinity);

        // Hard absolute spatial cap, independent of speed/time math.
        if (dist > FusionEngineConfig.MaxJumpFusion)
            return (true, dist, dtMs, dist / (dtMs / 1000.0));

        double speed = dist / (dtMs / 1000.0);
        return (speed > FusionEngineConfig.MaxSpeedWorldPerS, dist, dtMs, speed);
    }

    private (bool ok, double gapMs) TimeCompatible(FusedIdentity gid, TrackObject track)
    {
        double gap = track.TStart - gid.TEnd;
        // Reject negative gaps too — a new track can't start before the gid ended.
        return (gap >= 0 && gap <= FusionEngineConfig.MaxGapMs, gap);
    }

    /// <summary>
    /// Returns true if the candidate track shares a camera with ANY segment already fused
    /// into the gid AND its time window overlaps that segment. The previous implementation
    /// only checked the very first camera the gid ever saw, missing overlaps after multi-cam merges.
    /// </summary>
    private bool Overlaps(FusedIdentity gid, TrackObject track)
    {
        foreach (var seg in gid.Tracks)
        {
            if (seg.Count == 0) continue;
            if (seg[0].Cam != track.Cam) continue;
            long segStart = seg.First().Time;
            long segEnd   = seg.Last().Time;
            if (track.TStart <= segEnd && track.TEnd >= segStart) return true;
        }
        return false;
    }

    public List<FusedIdentity> Run(List<TrackObject> trackObjs)
    {
        var gids    = new List<FusedIdentity>();
        int nextGid = 0;

        foreach (var track in trackObjs)
        {
            FusedIdentity? best = null;
            double bestSim      = -1;

            if (_debug) Console.WriteLine($"\n[FUSION] track cam={track.Cam} sid={track.Sid}");

            foreach (var candidate in gids)
            {
                var (teleport, dist, dtMs, speed) = TeleportMetrics(candidate, track);
                if (teleport)
                {
                    if (_debug)
                        Console.WriteLine($"  gid={candidate.Gid} rejected (teleport) " +
                                          $"dist={dist:F2} dt={dtMs}ms speed={speed:F2}");
                    continue;
                }

                if (Overlaps(candidate, track))
                {
                    if (_debug) Console.WriteLine($"  gid={candidate.Gid} rejected (time overlap - same camera)");
                    continue;
                }

                var (okTime, gapMs) = TimeCompatible(candidate, track);
                if (!okTime)
                {
                    if (_debug) Console.WriteLine($"  gid={candidate.Gid} rejected (time gap) gap={gapMs}ms");
                    continue;
                }

                double sim = VectorMath.CosineSimilarity(track.Rep, candidate.Rep);
                if (_debug) Console.WriteLine($"  gid={candidate.Gid} sim={sim:F3}");

                if (sim < FusionEngineConfig.SimThreshold)
                {
                    if (_debug) Console.WriteLine("     rejected (low similarity)");
                    continue;
                }

                if (sim > bestSim) { bestSim = sim; best = candidate; }
            }

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
                if (_debug) Console.WriteLine($"  → MERGED into gid={best.Gid} (sim={bestSim:F3})");
                best.Rep  = VectorMath.AverageReps(best.Rep, track.Rep);
                best.TEnd = track.TEnd;
                best.X    = track.X;
                best.Y    = track.Y;
                best.Tracks.Add(track.Events);
            }
        }

        foreach (var gid in gids)
        {
            var flat = gid.Tracks.SelectMany(t => t).OrderBy(e => e.Time).ToList();
            gid.Tracks = new List<List<TrackEvent>> { flat };

            var seen = new HashSet<(string, int)>();
            foreach (var e in flat)
                if (seen.Add((e.Cam, e.Sid)))
                    gid.Sources.Add((e.Cam, e.Sid));
        }

        return gids;
    }
}

// ─────────────────────────────────────────────
// TRACK CLEANING
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
            if (Math.Abs(p.X - prev.X) > FusionEngineConfig.DupEps ||
                Math.Abs(p.Y - prev.Y) > FusionEngineConfig.DupEps)
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
            if (d < FusionEngineConfig.MaxJumpClean) cleaned.Add(p);
        }
        return cleaned;
    }

    private static List<TrackEvent> Smooth(List<TrackEvent> track)
    {
        int n      = track.Count;
        int win    = FusionEngineConfig.SmoothWin;
        var result = new List<TrackEvent>(n);
        for (int i = 0; i < n; i++)
        {
            double sx = 0, sy = 0; int count = 0;
            for (int j = Math.Max(0, i - win); j <= Math.Min(n - 1, i + win); j++)
            {
                sx += track[j].X; sy += track[j].Y; count++;
            }
            result.Add(new TrackEvent
            {
                X = sx / count, Y = sy / count,
                Time = track[i].Time, Cam = track[i].Cam, Sid = track[i].Sid
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
        if (track.Count < FusionEngineConfig.MinTrackPoints || duration < FusionEngineConfig.MinDurationS)
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
        // Stream JSON directly to disk via Utf8JsonWriter instead of materializing the
        // entire result object graph and serializing in one shot. Peak memory during
        // export drops from roughly "full output × 2" (graph + serialized string) to
        // the footprint of one gid at a time.
        using var fs     = File.Create(outputPath);
        using var writer = new Utf8JsonWriter(fs, new JsonWriterOptions { Indented = true });

        writer.WriteStartObject();
        int idx = 0;

        foreach (var g in gids)
        {
            // Flatten once, clean once, release the temp before writing.
            var flatEvents = g.Tracks.SelectMany(t => t).ToList();
            var cleaned    = TrackCleaner.Clean(flatEvents);
            flatEvents     = null!;  // let the flat list get collected before we build the string-ish JSON
            if (cleaned == null) continue;

            writer.WriteStartObject(idx.ToString());

            writer.WriteStartArray("sources");
            foreach (var s in g.Sources)
            {
                writer.WriteStartObject();
                writer.WriteString("cam", s.Cam);
                writer.WriteNumber("sid", s.Sid);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();

            writer.WriteNumber("num_events", cleaned.Count);

            writer.WriteStartArray("tracks");
            foreach (var e in cleaned)
            {
                writer.WriteStartObject();
                writer.WriteNumber("x",  e.X);
                writer.WriteNumber("y",  e.Y);
                writer.WriteNumber("t",  e.Time);
                writer.WriteString("cam", e.Cam);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();

            writer.WriteEndObject();

            cleaned = null;
            idx++;
        }

        writer.WriteEndObject();
        writer.Flush();
    }
}

// ─────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────
public class FusionRunner
{
    private readonly CloudStorageService   _gcs;
    private readonly FusionFirestoreLoader _firestoreLoader;

    public FusionRunner(CloudStorageService gcs, FirestoreDb firestoreDb)
    {
        _gcs             = gcs;
        _firestoreLoader = new FusionFirestoreLoader(firestoreDb);
    }

    public async Task<FusionResult> RunAsync(
        FusionRequest request, bool debug = false, CancellationToken ct = default)
    {
        // ── Validate required date range (set by the UI calendar picker) ──
        if (!request.From.HasValue || !request.To.HasValue)
            return new FusionResult
            {
                Success = false,
                Message = "FusionRequest.From and FusionRequest.To are required. " +
                          "Supply the date range selected in the calendar."
            };

        DateTime rangeFrom = request.From.Value.ToUniversalTime().Date;          // inclusive start (UTC date)
        DateTime rangeTo   = request.To.Value.ToUniversalTime().Date.AddDays(1); // exclusive end  (start of next day)

        if (rangeFrom >= rangeTo)
            return new FusionResult
            {
                Success = false,
                Message = $"From ({rangeFrom:yyyy-MM-dd}) must be before To ({rangeTo.AddDays(-1):yyyy-MM-dd})."
            };

        string tempDir = Path.Combine(Path.GetTempPath(), $"fusion_{Guid.NewGuid()}");
        Directory.CreateDirectory(tempDir);

        try
        {
            // ── 1. Discover, download, and merge JSONL files in the date range ──
            string inputFolder    = (request.InputStorageFolder ?? FusionEngineConfig.InputStorageFolder).TrimEnd('/');
            string localInputPath = Path.Combine(tempDir, "tracks-raw.jsonl");

            await DownloadAndMergeTracksForRangeAsync(
                inputFolder, localInputPath, rangeFrom, rangeTo, ct);

            // ── 2. Fine-grained millisecond filter over the merged JSONL ────────
            // Always applied when a range is provided so partial-day selections
            // at the boundary are handled precisely.
            localInputPath = FilterByTime(
                localInputPath, tempDir,
                request.From.Value, request.To.Value.Date.AddDays(1).AddMilliseconds(-1));

            // ── 3. Load + build tracks ──────────────────────────────────────────
            ct.ThrowIfCancellationRequested();
            var (vectors, tracks) = JsonlLoader.Load(localInputPath);
            var trackObjs         = TrackBuilder.Build(vectors, tracks);

            // The raw `vectors` dict holds List<float[]> per (cam,sid) that's been
            // reduced to a single averaged Rep[] inside TrackBuilder — it's not needed
            // anymore. Null it out so GC can reclaim potentially hundreds of MB of
            // embedding vectors before the world-transform + fusion phases.
            // `tracks` is largely shared-reference with trackObjs.Events, but dropping
            // the dictionary header still helps a little.
            vectors = null!;
            tracks  = null!;
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();

            // ── 4. Collect the unique camera MACs present in this batch ─────────
            var activeMacs = trackObjs
                .Select(t => t.Cam.ToLower())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            Console.WriteLine($"[INFO] Active cameras: {string.Join(", ", activeMacs)}");

            // ── 5. Fetch homographies + intrinsics from Firestore ────────────────
            var homographies   = await _firestoreLoader.LoadHomographiesAsync(activeMacs, ct);
            var intrinsicsDict = await _firestoreLoader.LoadIntrinsicsAsync(activeMacs, ct);

            // ── 6. World transform (undistortion + homography + Kalman) ─────────
            ct.ThrowIfCancellationRequested();
            WorldTransform.Apply(trackObjs, homographies, intrinsicsDict);

            // ── 7. Fuse identities ───────────────────────────────────────────────
            ct.ThrowIfCancellationRequested();
            var engine = new FusionEngine(debug);
            var gids   = engine.Run(trackObjs);

            // ── 8. Serialize + upload result to GCS ─────────────────────────────
            // Output file name encodes the full range: fused_tracks-20250405_20250408.json
            ct.ThrowIfCancellationRequested();
            string localOutputPath = Path.Combine(tempDir, "fused_tracks.json");
            FusionExporter.Export(gids, localOutputPath);

            string fromStr           = rangeFrom.ToString("yyyyMMdd");
            string toStr             = rangeTo.AddDays(-1).ToString("yyyyMMdd");  // back to inclusive
            string outputFolder      = (request.OutputStorageFolder ?? FusionEngineConfig.OutputStorageFolder).TrimEnd('/');
            string outputStoragePath = fromStr == toStr
                ? $"{outputFolder}/fused_tracks-{fromStr}.json"
                : $"{outputFolder}/fused_tracks-{fromStr}_{toStr}.json";

            Console.WriteLine($"[INFO] Uploading result to: {outputStoragePath}");
            await UploadFileAsync(localOutputPath, outputStoragePath, "application/json", ct);

            Console.WriteLine($"[DONE] {gids.Count} fused identities written to {outputStoragePath}");

            // Previously this re-read the output file into RAM and deserialized it into a
            // generic object graph just to stuff into result.Data — pure memory waste.
            // FusionService only ever looks at result.Success / result.Message.
            return new FusionResult { Success = true };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw; // let FusionService see the real cancellation and log a clean timeout
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ERROR] {ex.Message}");
            return new FusionResult { Success = false, Message = ex.Message };
        }
        finally
        {
            try { Directory.Delete(tempDir, recursive: true); }
            catch { /* best-effort */ }
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /// <summary>
    /// Downloads every JSONL file in <paramref name="folder"/> whose timestamp falls
    /// within [<paramref name="fromUtc"/>, <paramref name="toUtcExclusive"/>) and
    /// concatenates them in chronological order into <paramref name="mergedLocalPath"/>.
    /// </summary>
    private async Task DownloadAndMergeTracksForRangeAsync(
        string folder, string mergedLocalPath,
        DateTime fromUtc, DateTime toUtcExclusive,
        CancellationToken ct)
    {
        IReadOnlyList<GcsFileInfo> allFiles = await _gcs.ListFilesAsync(folder, ct);

        if (allFiles.Count == 0)
            throw new InvalidOperationException(
                $"No track files found in GCS folder '{folder}'.");

        static DateTime? ParseTimestampFromName(string storagePath)
        {
            string name = storagePath.Split('/').Last();
            int    dash = name.IndexOf('-');
            if (dash < 0 || dash + 16 > name.Length) return null;
            return DateTime.TryParseExact(
                name.Substring(dash + 1, 15),          // "20250408-143512"
                "yyyyMMdd-HHmmss",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal,
                out DateTime dt)
                ? dt.ToUniversalTime()
                : null;
        }

        var rangeFiles = allFiles
            .Select(f => new
            {
                File      = f,
                Timestamp = ParseTimestampFromName(f.StoragePath) ?? f.LastModified.UtcDateTime
            })
            .Where(x => x.Timestamp >= fromUtc && x.Timestamp < toUtcExclusive)
            .OrderBy(x => x.Timestamp)
            .ToList();

        if (rangeFiles.Count == 0)
            throw new InvalidOperationException(
                $"No track files found in '{folder}' between " +
                $"{fromUtc:yyyy-MM-dd} and {toUtcExclusive.AddDays(-1):yyyy-MM-dd} (inclusive).");

        Console.WriteLine(
            $"[INFO] Found {rangeFiles.Count} track file(s) between " +
            $"{fromUtc:yyyy-MM-dd} and {toUtcExclusive.AddDays(-1):yyyy-MM-dd}:");
        foreach (var f in rangeFiles)
            Console.WriteLine($"       {f.File.StoragePath}  ({f.Timestamp:O})");

        // Download all parts in parallel (max 4 concurrent)
        string partsDir = Path.Combine(Path.GetDirectoryName(mergedLocalPath)!, "parts");
        Directory.CreateDirectory(partsDir);

        await Parallel.ForEachAsync(
            rangeFiles,
            new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = ct },
            async (item, innerCt) =>
            {
                string safeName  = item.File.StoragePath.Replace('/', '_').Replace(':', '-');
                string localPart = Path.Combine(partsDir, safeName);
                await DownloadFileAsync(item.File.StoragePath, localPart, innerCt);
            });

        // Concatenate in chronological order into one merged JSONL
        await using var outStream = File.Create(mergedLocalPath);
        await using var writer    = new StreamWriter(outStream);

        foreach (var item in rangeFiles)
        {
            string safeName  = item.File.StoragePath.Replace('/', '_').Replace(':', '-');
            string localPart = Path.Combine(partsDir, safeName);

            await foreach (var line in ReadLinesAsync(localPart, ct))
            {
                if (!string.IsNullOrWhiteSpace(line))
                    await writer.WriteLineAsync(line.AsMemory(), ct);
            }
        }

        Console.WriteLine($"[INFO] Merged {rangeFiles.Count} file(s) → {mergedLocalPath}");
    }

    private static async IAsyncEnumerable<string> ReadLinesAsync(
        string path,
        [EnumeratorCancellation] CancellationToken ct)
    {
        await using var fs = File.OpenRead(path);
        using  var      sr = new StreamReader(fs);
        while (!sr.EndOfStream)
        {
            ct.ThrowIfCancellationRequested();
            var line = await sr.ReadLineAsync(ct);
            if (line != null) yield return line;
        }
    }

    private async Task DownloadFileAsync(string storagePath, string localPath, CancellationToken ct)
    {
        await using var fs = File.Create(localPath);
        await _gcs.DownloadToStreamAsync(storagePath, fs, ct);
    }

    private async Task UploadFileAsync(
        string localPath, string storagePath, string contentType, CancellationToken ct)
    {
        await using var fs = File.OpenRead(localPath);
        await _gcs.UploadFromStreamAsync(storagePath, contentType, fs, ct);
    }

    private static string FilterByTime(string path, string tempDir, DateTime from, DateTime to)
    {
        long fromMs = new DateTimeOffset(from.ToUniversalTime()).ToUnixTimeMilliseconds();
        long toMs   = new DateTimeOffset(to.ToUniversalTime()).ToUnixTimeMilliseconds();

        var filtered = File.ReadLines(path)
            .Where(line =>
            {
                if (string.IsNullOrWhiteSpace(line)) return false;
                using var doc = JsonDocument.Parse(line);
                return doc.RootElement.TryGetProperty("time", out var t)
                       && t.GetInt64() >= fromMs
                       && t.GetInt64() <= toMs;
            })
            .ToList();

        string filteredPath = Path.Combine(tempDir, $"filtered_{Guid.NewGuid()}.jsonl");
        File.WriteAllLines(filteredPath, filtered);
        return filteredPath;
    }
}