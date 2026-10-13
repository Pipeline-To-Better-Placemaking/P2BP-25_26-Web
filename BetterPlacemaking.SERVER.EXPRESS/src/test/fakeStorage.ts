import { vi } from "vitest";
import { setStorageForTesting, type StorageBucketApi } from "../config/storage.js";

/** In-memory stand-in for the Supabase Storage bucket; installed as getStorageBucket(). */
export function createFakeStorage() {
  const objects = new Map<string, { bytes: Buffer; contentType?: string }>();

  const bucket = {
    createSignedUploadUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://fake.supabase.co/storage/v1/object/upload/sign/media/${path}?token=t`, token: "t", path },
      error: null,
    })),
    createSignedUrl: vi.fn(async (path: string, _expiresIn: number, opts?: { download?: string | boolean }) => ({
      data: {
        signedUrl: `https://fake.supabase.co/storage/v1/object/sign/media/${path}?token=t${opts?.download ? "&download=1" : ""}`,
      },
      error: null,
    })),
    list: vi.fn(async () => ({ data: [], error: null })),
    download: vi.fn(async (path: string) => {
      const obj = objects.get(path);
      return obj ? { data: new Blob([obj.bytes]), error: null } : { data: null, error: { message: "not found" } };
    }),
    upload: vi.fn(async (path: string, body: Buffer, opts?: { contentType?: string }) => {
      objects.set(path, { bytes: body, contentType: opts?.contentType });
      return { data: { path }, error: null };
    }),
  } satisfies StorageBucketApi;

  setStorageForTesting(bucket);
  return { bucket, objects };
}
