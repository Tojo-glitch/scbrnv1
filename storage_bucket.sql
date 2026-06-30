-- ============================================================
-- Phase B: Storage Bucket Setup
-- Run this in Supabase SQL Editor AFTER schema.sql
-- ============================================================

-- Create storage bucket for images
insert into storage.buckets (id, name, public)
values ('mbd-images', 'mbd-images', false)
on conflict do nothing;

-- Policy: users can upload to their own folder only
create policy "users can upload own images"
  on storage.objects for insert
  with check (
    bucket_id = 'mbd-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Policy: users can read their own images
create policy "users can read own images"
  on storage.objects for select
  using (
    bucket_id = 'mbd-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Policy: users can delete their own images
create policy "users can delete own images"
  on storage.objects for delete
  using (
    bucket_id = 'mbd-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );