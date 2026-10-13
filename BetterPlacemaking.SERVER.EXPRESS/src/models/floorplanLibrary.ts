/**
 * Ported from BetterPlacemaking.SERVER/Models/FloorplanLibraryItem.cs and
 * Models/Dtos/FloorplanLibraryDtos.cs.
 *
 * Reference points are stored flattened (jsonb) - exactly like the
 * ASP.NET model's `ReferencePointsFlat` property - calibration reference
 * points are persisted flattened ([x0, y0, x1, y1]) and reconstructed into
 * [x, y] pairs when building the wire DTO.
 */

export interface FloorplanCalibrationDoc {
  ReferencePointsFlat?: number[] | null;
  ReferenceDistanceMm: number;
  MmPerPixel: number;
  OriginFp?: number[] | null;
  /** ISO 8601 string (matches DateTime.ToUniversalTime().ToString("o") from the ASP.NET server). */
  CalibratedAtUtc: string;
}

/** API shape of a `floorplan_library` row (calibration is stored as jsonb; timestamps surface as ISO strings). */
export interface FloorplanLibraryItemDoc {
  UserId?: string | null;
  ProjectId?: string | null;
  Nickname?: string | null;
  ImagePath?: string | null;
  ImageContentType?: string | null;
  ImageSizeBytes: number;
  ImageWidth: number;
  ImageHeight: number;
  Calibration?: FloorplanCalibrationDoc | null;
  CreatedAtUtc: string;
  UpdatedAtUtc: string;
}

export interface FloorplanLibraryItem extends FloorplanLibraryItemDoc {
  Id: string;
}

export interface FloorplanCalibrationDto {
  ReferencePoints: number[][];
  ReferenceDistanceMm: number;
  MmPerPixel: number;
  OriginFp: number[];
  CalibratedAtUtc: string;
}

/** Wire DTO - mirrors FloorplanLibraryItemDto from FloorplanLibraryDtos.cs. */
export interface FloorplanLibraryItemDto {
  Id: string;
  ProjectId?: string | null;
  Nickname: string;
  ImagePath: string;
  ImageDownloadUrl?: string | null;
  ImageDownloadUrlExpiresAt?: string | null;
  ImageContentType: string;
  ImageSizeBytes: number;
  ImageWidth: number;
  ImageHeight: number;
  Calibration?: FloorplanCalibrationDto | null;
  CreatedAtUtc: string;
  UpdatedAtUtc: string;
}

export function unflattenReferencePoints(flat?: number[] | null): number[][] | null {
  if (!flat || flat.length < 2 || flat.length % 2 !== 0) return null;
  const points: number[][] = [];
  for (let i = 0; i < flat.length; i += 2) {
    points.push([flat[i], flat[i + 1]]);
  }
  return points;
}

export interface SignedDownload {
  url: string;
  expiresAt: string;
}

/**
 * Builds the wire DTO. `download` is the signed-URL info the ASP.NET
 * controller fetches from CloudStorageService.CreateSignedDownloadUrlAsync -
 * pass it in once that service is ported; omitted/null here means
 * ImageDownloadUrl/ImageDownloadUrlExpiresAt come back null, matching the
 * ASP.NET server's own fallback when signing fails.
 */
export function toFloorplanLibraryItemDto(item: FloorplanLibraryItem, download?: SignedDownload | null): FloorplanLibraryItemDto {
  const calibration = item.Calibration
    ? {
        ReferencePoints: unflattenReferencePoints(item.Calibration.ReferencePointsFlat) ?? [],
        ReferenceDistanceMm: item.Calibration.ReferenceDistanceMm,
        MmPerPixel: item.Calibration.MmPerPixel,
        OriginFp: item.Calibration.OriginFp ?? [],
        CalibratedAtUtc: item.Calibration.CalibratedAtUtc,
      }
    : null;

  return {
    Id: item.Id ?? "",
    ProjectId: item.ProjectId ?? null,
    Nickname: item.Nickname ?? "",
    ImagePath: item.ImagePath ?? "",
    ImageDownloadUrl: download?.url ?? null,
    ImageDownloadUrlExpiresAt: download?.expiresAt ?? null,
    ImageContentType: item.ImageContentType ?? "image/png",
    ImageSizeBytes: item.ImageSizeBytes,
    ImageWidth: item.ImageWidth,
    ImageHeight: item.ImageHeight,
    Calibration: calibration,
    CreatedAtUtc: item.CreatedAtUtc,
    UpdatedAtUtc: item.UpdatedAtUtc,
  };
}
