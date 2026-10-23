-- MEGA MUSIC migration 001 — social platform (INCREMENTAL, safe)
-- Run AFTER the base supabase-schema.sql has already been applied.
-- Does NOT drop tables or reset data. Preserves owner and existing tracks.

-- ---------------------------------------------------------------------------
-- Profiles: bio, verification, bans
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- Owner remains verified (safe if owner already exists)
UPDATE public.profiles
SET is_verified = true
WHERE role = 'owner' AND is_verified IS DISTINCT FROM true;

-- ---------------------------------------------------------------------------
-- Follows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT follows_no_self CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS follows_following_idx ON public.follows (following_id);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "follows_select_public" ON public.follows;
DROP POLICY IF EXISTS "follows_insert_own" ON public.follows;
DROP POLICY IF EXISTS "follows_delete_own" ON public.follows;

CREATE POLICY "follows_select_public" ON public.follows
  FOR SELECT USING (true);

CREATE POLICY "follows_insert_own" ON public.follows
  FOR INSERT WITH CHECK (
    auth.uid() = follower_id
    AND follower_id <> following_id
    AND NOT COALESCE((SELECT is_banned FROM public.profiles WHERE id = auth.uid()), false)
  );

CREATE POLICY "follows_delete_own" ON public.follows
  FOR DELETE USING (auth.uid() = follower_id);

-- ---------------------------------------------------------------------------
-- Playlists: description, cover, official flag
-- ---------------------------------------------------------------------------
ALTER TABLE public.playlists
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Tracks: moderation notes (status already exists)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS moderation_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Ban helper (SECURITY DEFINER, safe search_path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_banned_user(uid UUID DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT
       is_banned AND (banned_until IS NULL OR banned_until > now())
     FROM public.profiles WHERE id = uid),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_verified_user(uid UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_verified FROM public.profiles WHERE id = uid), false);
$$;

-- ---------------------------------------------------------------------------
-- Track INSERT: owner can publish; regular users only pending
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "tracks_insert_owner_only" ON public.tracks;
DROP POLICY IF EXISTS "tracks_insert_auth" ON public.tracks;

CREATE POLICY "tracks_insert_auth" ON public.tracks
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND uploaded_by = auth.uid()
    AND NOT public.is_banned_user(auth.uid())
    AND (
      (public.is_owner() AND status IN ('draft','pending','published','approved'))
      OR (NOT public.is_staff() AND status = 'pending')
      OR (public.is_staff() AND status IN ('draft','pending','in_review','approved','published','rejected','needs_changes'))
    )
  );

-- Users can update their own pending/draft/needs_changes submissions (not publish)
DROP POLICY IF EXISTS "tracks_update_own_pending" ON public.tracks;
CREATE POLICY "tracks_update_own_pending" ON public.tracks
  FOR UPDATE
  USING (
    uploaded_by = auth.uid()
    AND status IN ('draft','pending','needs_changes')
    AND NOT public.is_banned_user(auth.uid())
  )
  WITH CHECK (
    uploaded_by = auth.uid()
    AND status IN ('draft','pending','needs_changes')
  );

-- Staff still update any track (existing policy tracks_update_staff)

-- ---------------------------------------------------------------------------
-- Storage: authenticated users may upload under their own uid path
-- Owner retains full access. Paths: covers/{uid}/... and audio/{uid}/...
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "mega_covers_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_covers_user_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_user_insert" ON storage.objects;

CREATE POLICY "mega_covers_user_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'covers'
    AND NOT public.is_banned_user(auth.uid())
    AND (
      public.is_owner()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

CREATE POLICY "mega_audio_user_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'audio'
    AND NOT public.is_banned_user(auth.uid())
    AND (
      public.is_owner()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

-- Keep owner delete/update; allow users to delete own folder objects
DROP POLICY IF EXISTS "mega_covers_user_delete" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_user_delete" ON storage.objects;

CREATE POLICY "mega_covers_user_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'covers'
    AND (
      public.is_owner()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

CREATE POLICY "mega_audio_user_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'audio'
    AND (
      public.is_owner()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

-- ---------------------------------------------------------------------------
-- Staff profile management (ban / verify) — only via update by staff
-- Role still protected by protect_profile_role trigger
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_staff_update" ON public.profiles;
CREATE POLICY "profiles_staff_update" ON public.profiles
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
-- Note: trigger still blocks role changes even for staff via client.
-- Ban/verify columns are allowed; role changes only via SQL Editor.

-- ---------------------------------------------------------------------------
-- Audit insert for staff
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "audit_insert_staff" ON public.audit_logs;
CREATE POLICY "audit_insert_staff" ON public.audit_logs
  FOR INSERT
  WITH CHECK (public.is_staff() AND actor_id = auth.uid());

COMMENT ON COLUMN public.profiles.is_verified IS 'Trusted verification badge; only staff/SQL may set.';
COMMENT ON COLUMN public.profiles.is_banned IS 'When true (and banned_until null or future), user cannot submit or follow.';
