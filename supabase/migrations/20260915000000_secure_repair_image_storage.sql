drop policy if exists "Allow authenticated uploads" on storage.objects;
drop policy if exists "Authenticated users can upload own repair images" on storage.objects;
drop policy if exists "Authenticated users can delete own repair images" on storage.objects;

create policy "Authenticated users can upload own repair images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'repair-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Authenticated users can delete own repair images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'repair-images'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
