/**
 * Ported from BetterPlacemaking.SERVER/Services/ScanCombine/ScanCalibrationModels.cs
 * (the request/DTO shapes) and BetterPlacemaking.SERVER/Services/ScanCombine/Point.cs
 * (the 2D point used by the preview renderer). Scan documents themselves are NOT
 * redefined here - see models/scanDevice.ts's Scan/ScanDoc, which
 * scanCalibrationService.ts imports and reuses (ScanCalibrationController talks to the
 * same `projects/{projectId}/devices/{deviceId}/scans` database subtree ScanService.cs
 * does, just directly via the database rather than through ScanService).
 */

/** Mirrors ScanCombine.XyzPoint - one point in a raw .xyz point-cloud file. */
export interface XyzPoint {
  X: number;
  Y: number;
  Z: number;
}

/**
 * Mirrors ScanCombine.XyzPoint.Distance() - the XY-plane (polar) distance from the
 * origin; Z is intentionally excluded, exactly as in the source.
 */
export function xyzDistance(p: XyzPoint): number {
  return Math.sqrt(p.X * p.X + p.Y * p.Y);
}

/** Mirrors ScanCombine.Point (used only by the flatten/preview path - X/Y only, no Z). */
export interface PreviewPoint {
  x: number;
  y: number;
}

/** Mirrors ScanCombine.Point.distance(). */
export function previewPointDistance(p: PreviewPoint): number {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}

/** One item of CombineScansRequest.Items - mirrors ScanCombine.CombineScanItemRequest. */
export interface CombineScanItemRequest {
  ScanId: string;
  XTranslation: number;
  YTranslation: number;
  Theta: number;
}

/**
 * Body of POST /:projectId/:deviceId/combine - mirrors ScanCombine.CombineScansRequest.
 *
 * NOTE: ScalarMmPerPixel is `[JsonPropertyName("scalar_mm_per_pixel")]` on the old
 * server - the one field in this whole migration that isn't PascalCase over the wire.
 * scanCalibration.routes.ts reads `req.body.scalar_mm_per_pixel` to match.
 *
 * OutputName defaults to "calibrationScan" (a C# property initializer) when the field
 * is omitted from the request JSON entirely - the route mirrors that default.
 */
export interface CombineScansRequest {
  OutputName: string | null;
  ScalarMmPerPixel: number | null;
  Items: CombineScanItemRequest[];
}

/**
 * Reproduces ASP.NET's JSON model binding for CombineScansRequest, which Program.cs
 * configures as `PropertyNamingPolicy = null` + `PropertyNameCaseInsensitive = true`.
 * That combination matches wire names to C# property names ignoring CASE ONLY - an
 * underscore is a different character, not a case difference - with [JsonPropertyName]
 * taking precedence where present. Unmatched fields fall back to the C# member default.
 *
 * This matters because the Angular client (services/scan-calibration-service.ts) posts
 *   { output_name, scalar_mm_per_pixel, items: [{ scanId, x_translation, y_translation, Theta }] }
 * which binds on the old server as follows:
 *   scalar_mm_per_pixel -> ScalarMmPerPixel   (explicit [JsonPropertyName]) .... BINDS
 *   items / scanId / Theta -> Items / ScanId / Theta (case-insensitive) ....... BINDS
 *   output_name -> OutputName ................................................. DOES NOT BIND
 *   x_translation / y_translation -> XTranslation / YTranslation .............. DOES NOT BIND
 *
 * So on the old server OutputName silently stays "calibrationScan" and BOTH per-scan
 * translations silently stay 0.0 (default(double)) - the combine step applies rotation
 * only. That is a live bug in the old system, NOT a porting artifact, and it is
 * reproduced here deliberately so the migration does not silently change calibration
 * output. See the migration report; fixing it is a product decision, and the fix is to
 * also accept the snake_case spellings below.
 *
 * Binding faithfully is also what keeps the transform math safe: reading `XTranslation`
 * straight off the raw body would yield `undefined`, and `x += undefined` is NaN, which
 * would write an entire point cloud of NaNs rather than an untranslated one.
 */
export function bindCombineScansRequest(body: unknown): CombineScansRequest {
  const obj = (body ?? {}) as Record<string, unknown>;

  /** Case-insensitive lookup, matching PropertyNameCaseInsensitive = true. */
  const pick = (source: Record<string, unknown>, name: string): unknown => {
    const target = name.toLowerCase();
    for (const key of Object.keys(source)) {
      if (key.toLowerCase() === target) return source[key];
    }
    return undefined;
  };

  /** `double` members: anything that doesn't bind to a JSON number stays default(double) = 0. */
  const toDouble = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

  const rawItems = pick(obj, "Items");
  const items: CombineScanItemRequest[] = Array.isArray(rawItems)
    ? rawItems.map((raw) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        const scanId = pick(item, "ScanId");
        return {
          ScanId: typeof scanId === "string" ? scanId : "",
          XTranslation: toDouble(pick(item, "XTranslation")),
          YTranslation: toDouble(pick(item, "YTranslation")),
          Theta: toDouble(pick(item, "Theta")),
        };
      })
    : [];

  const outputName = pick(obj, "OutputName");
  // [JsonPropertyName("scalar_mm_per_pixel")] - still matched case-insensitively.
  const scalar = pick(obj, "scalar_mm_per_pixel");

  return {
    // C# property initializer: `public string OutputName { get; set; } = "calibrationScan";`
    OutputName: typeof outputName === "string" ? outputName : "calibrationScan",
    // `double?` - absent or non-numeric stays null.
    ScalarMmPerPixel: typeof scalar === "number" && Number.isFinite(scalar) ? scalar : null,
    Items: items,
  };
}

/**
 * Mirrors ScanCombine.CombineCloudInput - one already-resolved local .xyz file path
 * plus the polar transform (translation + rotation) to apply to it, as built by
 * ScanCalibrationController.CombineScans from a CombineScanItemRequest.
 */
export interface CombineCloudInput {
  XyzFilePath: string;
  XTranslation: number;
  YTranslation: number;
  Theta: number;
}

/** Mirrors ScanCombine.CombinedScanResult. */
export interface CombinedScanResult {
  OutputFilePath: string;
  OutputFileName: string;
}
