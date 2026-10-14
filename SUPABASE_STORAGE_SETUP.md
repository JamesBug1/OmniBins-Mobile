# Supabase Storage for report images

Firebase remains responsible for sign-in and Realtime Database. Report photos are uploaded to Supabase Storage, and their public URLs are saved in the existing Firebase `reports/{id}.imageUrl` field.

## Configure the app

1. Create a Supabase project and copy its Project URL and `anon` (publishable) key from the API settings.
2. Put those values in `supabaseConfig.js` as `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
3. Never put the `service_role` key in the mobile app.

## Create the bucket and policy

Create a bucket named `report-images` and make it public so report images can be displayed from the saved URL. Then run this policy in the Supabase SQL editor to let the mobile app upload into the `reports/` folder:

```sql
create policy "Allow report image uploads"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'report-images'
  and (storage.foldername(name))[1] = 'reports'
);
```

The app uses Firebase Auth, not Supabase Auth, so this policy cannot identify an individual staff member. It permits unauthenticated clients with the public anon key to upload objects in that folder. For stronger abuse protection, use a Supabase Edge Function that verifies Firebase ID tokens and uploads with a server-side secret instead of allowing direct client uploads. Apply bucket file-size and image MIME-type limits in the Supabase dashboard as well.