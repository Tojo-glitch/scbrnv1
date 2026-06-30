/**
 * lib/storage.ts
 * Handles image upload/delete to Supabase Storage bucket "mbd-images"
 * Images are stored at: {user_id}/{timestamp}_{random}.jpg
 *
 * NOTE — Before using, run this SQL in Supabase SQL Editor:
 *
 *   insert into storage.buckets (id, name, public)
 *   values ('mbd-images', 'mbd-images', false)
 *   on conflict do nothing;
 *
 *   create policy "users can upload own images"
 *     on storage.objects for insert
 *     with check (bucket_id = 'mbd-images' and auth.uid()::text = (storage.foldername(name))[1]);
 *
 *   create policy "users can read own images"
 *     on storage.objects for select
 *     using (bucket_id = 'mbd-images' and auth.uid()::text = (storage.foldername(name))[1]);
 *
 *   create policy "users can delete own images"
 *     on storage.objects for delete
 *     using (bucket_id = 'mbd-images' and auth.uid()::text = (storage.foldername(name))[1]);
 */

import { supabase } from './supabaseClient';

const BUCKET = 'mbd-images';

// ─── Upload ────────────────────────────────────────────────────────────────

/**
 * Upload a base64 image string to Supabase Storage.
 * Returns the storage path (e.g. "user-uuid/1234567890_abc.jpg")
 * which is stored in the DB instead of the raw base64.
 */
export async function uploadImage(
  base64: string,
  userId: string
): Promise<string> {
  // Convert base64 → Blob
  const res  = await fetch(base64);
  const blob = await res.blob();

  const ext  = blob.type === 'image/png' ? 'png' : 'jpg';
  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${userId}/${name}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  return path;
}

/**
 * Upload multiple base64 images in parallel.
 * Returns array of storage paths (same order as input).
 */
export async function uploadImages(
  base64Array: string[],
  userId: string
): Promise<string[]> {
  return Promise.all(base64Array.map(b => uploadImage(b, userId)));
}

// ─── Signed URL ────────────────────────────────────────────────────────────

/**
 * Get a signed URL for a storage path (valid for 1 hour).
 * Use this to display images that were uploaded to Storage.
 */
export async function getSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60); // 1 hour

  if (error || !data?.signedUrl)
    throw new Error(`Failed to get signed URL: ${error?.message}`);

  return data.signedUrl;
}

/**
 * Get signed URLs for multiple paths in parallel.
 */
export async function getSignedUrls(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  return Promise.all(paths.map(p => getSignedUrl(p)));
}

// ─── Delete ────────────────────────────────────────────────────────────────

/**
 * Delete an image from Storage by its path.
 */
export async function deleteImage(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

// ─── Helper ────────────────────────────────────────────────────────────────

/**
 * Check whether a string is a Storage path (not a raw base64).
 * Storage paths look like: "user-uuid/1234567890_abc.jpg"
 * base64 strings start with "data:image/"
 */
export function isStoragePath(value: string): boolean {
  return !!value && !value.startsWith('data:');
}

/**
 * Resolve an image value to a displayable URL.
 * - If it's already a base64 string (legacy), return as-is.
 * - If it's a Storage path, fetch a signed URL.
 */
export async function resolveImageUrl(value: string): Promise<string> {
  if (!value) return '';
  if (!isStoragePath(value)) return value; // already base64
  return getSignedUrl(value);
}