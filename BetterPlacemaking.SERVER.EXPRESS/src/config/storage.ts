import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

type StorageError = { message: string } | null;

/**
 * The slice of Supabase's `StorageFileApi` this server uses, so tests can inject a
 * fake via setStorageForTesting() instead of talking to Supabase.
 */
export interface StorageBucketApi {
  createSignedUploadUrl(
    path: string,
    options?: { upsert?: boolean },
  ): Promise<{ data: { signedUrl: string; token: string; path: string } | null; error: StorageError }>;
  createSignedUrl(
    path: string,
    expiresInSeconds: number,
    options?: { download?: string | boolean },
  ): Promise<{ data: { signedUrl: string } | null; error: StorageError }>;
  list(
    folder?: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ data: { name: string; updated_at?: string | null }[] | null; error: StorageError }>;
  download(path: string): Promise<{ data: Blob | null; error: StorageError }>;
  upload(
    path: string,
    body: Buffer,
    options?: { contentType?: string; upsert?: boolean },
  ): Promise<{ data: { path: string } | null; error: StorageError }>;
}

let instance: StorageBucketApi | null = null;

/** Private Supabase Storage bucket (SUPABASE_STORAGE_BUCKET, default "media"); lazily created with the secret (service-role) key. */
export function getStorageBucket(): StorageBucketApi {
  if (instance) return instance;
  if (!env.supabaseUrl || !env.supabaseSecretKey) {
    throw new Error("Missing required environment variables: SUPABASE_URL / SUPABASE_SECRET_KEY");
  }
  const client = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  instance = client.storage.from(env.supabaseStorageBucket) as unknown as StorageBucketApi;
  return instance;
}

/** Test hook: install (or clear with null) the storage client returned by getStorageBucket(). */
export function setStorageForTesting(bucket: StorageBucketApi | null): void {
  instance = bucket;
}
