import { getStorageBucket } from "../config/storage.js";

/** Ported from CloudStorageService's input-validation exceptions. */
export class ValidationError extends Error {}

export interface RequestUploadUrlInput {
  PathFromRoot?: string;
  FileName?: string;
  Extension?: string;
  SizeBytes?: number;
}

export interface RequestDownloadUrlInput {
  PathFromRoot?: string;
}

export interface SignedUrlResult {
  PathFromRoot: string;
  SignedUrl: string;
  ExpiresAt: Date;
}

/**
 * Collapses repeated slashes and strips characters storage object names shouldn't
 * carry, ported char-for-char from CloudStorageService.SanitizeObjectPath:
 * letters, digits, '-' '_' ':' '.' ' ' survive as-is, everything else becomes '_'.
 */
function sanitizeObjectPath(path: string | undefined | null): string {
  if (!path || !path.trim()) throw new ValidationError("PathFromRoot required.");

  const normalizedSlashes = path.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
  if (normalizedSlashes.length === 0) throw new ValidationError("PathFromRoot required.");

  let result = "";
  let lastWasSlash = false;
  for (const c of normalizedSlashes) {
    if (c === "/") {
      if (!lastWasSlash) {
        result += "/";
        lastWasSlash = true;
      }
      continue;
    }
    lastWasSlash = false;
    if (/[a-zA-Z0-9\-_: .]/.test(c)) {
      result += c;
    } else {
      result += "_";
    }
  }

  const cleaned = result.replace(/^\/+|\/+$/g, "");
  if (!cleaned.trim()) throw new ValidationError("PathFromRoot required.");
  return cleaned;
}

/** Ported from CloudStorageService.NormalizeObjectPath. */
export function normalizeObjectPath(rawPath: string | undefined | null): string {
  return sanitizeObjectPath(rawPath);
}

/** Ported from CloudStorageService.SanitizeFileName. */
function sanitizeFileName(fileName: string | undefined | null): string {
  if (!fileName || !fileName.trim()) throw new ValidationError("FileName required.");

  let name = fileName.replace(/\\/g, "/");
  const segments = name.split("/");
  name = segments[segments.length - 1] || "file";
  // Path.GetFileNameWithoutExtension: strip everything from the last '.' onward.
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0) name = name.slice(0, dotIndex);
  name = name.trim();

  let result = "";
  for (const c of name) {
    result += /[a-zA-Z0-9\-_ ]/.test(c) ? c : "_";
  }

  const cleaned = result;
  if (!cleaned.trim()) throw new ValidationError("FileName required.");
  return cleaned;
}

/** Ported from CloudStorageService.NormalizeExtension. */
function normalizeExtension(rawExtension: string | undefined | null): string {
  if (!rawExtension || !rawExtension.trim()) throw new ValidationError("Extension required.");

  let ext = rawExtension.trim();
  if (!ext.startsWith(".")) ext = `.${ext}`;
  ext = ext.replace(/\.+$/, "");

  if (ext.length < 2) throw new ValidationError("Extension must be a file extension like .ply");

  let result = ".";
  for (let i = 1; i < ext.length; i++) {
    const c = ext[i];
    if (/[a-zA-Z0-9]/.test(c)) {
      result += c.toLowerCase();
    } else {
      throw new ValidationError("Extension must be a file extension like .ply");
    }
  }

  return result;
}

/** Ported from CloudStorageService.BuildObjectPath. */
export function buildObjectPath(rawDirectoryPath: string, rawFileName: string, rawExtension: string): string {
  const directoryPath = normalizeObjectPath(rawDirectoryPath).replace(/\/+$/, "");
  const fileNameWithoutExtension = sanitizeFileName(rawFileName);
  const extension = normalizeExtension(rawExtension);

  const fullPath = `${directoryPath}/${fileNameWithoutExtension}${extension}`;
  return normalizeObjectPath(fullPath);
}

/** Supabase signed upload URLs have a fixed lifetime (2 hours) that can't be configured per call. */
const UPLOAD_URL_TTL_MS = 2 * 60 * 60 * 1000;
/** Signed download URLs live for 7 days. */
const DOWNLOAD_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Ported from CloudStorageService.CreateSignedUploadUrlAsync. Returns a Supabase Storage signed
 * upload URL (replaces the storage PUT URL); the client PUTs the file bytes to `SignedUrl`.
 * `upsert` keeps the old overwrite-on-PUT behavior.
 */
export async function createSignedUploadUrl(input: RequestUploadUrlInput): Promise<SignedUrlResult> {
  if (input.SizeBytes === undefined || input.SizeBytes === null || input.SizeBytes <= 0) {
    throw new ValidationError("SizeBytes must be greater than zero.");
  }
  if (!input.Extension?.trim()) throw new ValidationError("Extension required.");
  if (!input.FileName?.trim()) throw new ValidationError("FileName required.");

  const objectName = buildObjectPath(input.PathFromRoot ?? "", input.FileName, input.Extension);
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MS);

  const { data, error } = await getStorageBucket().createSignedUploadUrl(objectName, { upsert: true });
  if (error || !data) throw new Error(`Failed to create signed upload URL: ${error?.message ?? "unknown error"}`);

  return { PathFromRoot: objectName, SignedUrl: data.signedUrl, ExpiresAt: expiresAt };
}

/** Ported from CloudStorageService.CreateSignedDownloadUrlAsync (signed GET URL, forces download via Content-Disposition). */
export async function createSignedDownloadUrl(input: RequestDownloadUrlInput): Promise<SignedUrlResult> {
  const objectName = normalizeObjectPath(input.PathFromRoot);
  const segments = objectName.split("/");
  const filename = segments[segments.length - 1];

  const ttlSeconds = DOWNLOAD_URL_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const { data, error } = await getStorageBucket().createSignedUrl(objectName, ttlSeconds, { download: filename });
  if (error || !data) throw new Error(`Failed to create signed download URL: ${error?.message ?? "unknown error"}`);

  return { PathFromRoot: objectName, SignedUrl: data.signedUrl, ExpiresAt: expiresAt };
}

/** Uploads bytes server-side (used by the base64 floorplan upload endpoint). */
export async function uploadObject(objectPath: string, contentType: string, bytes: Buffer): Promise<void> {
  const { error } = await getStorageBucket().upload(objectPath, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Failed to upload object: ${error.message}`);
}

/** Server-side object download (for ports of CloudStorageService.DownloadBytesAsync / DownloadToStreamAsync). */
export async function downloadObject(objectPath: string): Promise<Buffer> {
  const { data, error } = await getStorageBucket().download(objectPath);
  if (error || !data) throw new Error(`Failed to download object: ${error?.message ?? "unknown error"}`);
  return Buffer.from(await data.arrayBuffer());
}
