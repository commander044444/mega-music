-- MEGA MUSIC migration 001 — social platform (INCREMENTAL, IDEMPOTENT)
-- Run AFTER base supabase-schema.sql has been applied at least once.
-- Safe to re-run: uses IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE.
-- Does NOT drop tables or delete data. Preserves owner and existing tracks.
--
-- SECURITY (this revision):
-- Regular users may update only ordinary profile fields (username, display_name,
-- bio, avatar_url, updated_at). They cannot change role, is_verified, is_banned,
-- banned_until, or ban_reason. Enforced by trigger protect_profile_privileged_fields()
-- (database-enforced, not frontend-only).

-- ---------------------------------------------------------------------------
-- Profiles: bio, verification, bans
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- Owner remains verified (idempotent)
UPDATE public.profiles
SET is_verified = true
WHERE role = 'owner' AND is_verified IS DISTINCT FROM true;

-- ---------------------------------------------------------------------------
-- Role / privilege helpers (SECURITY DEFINER, fixed search_path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'owner')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_banned_user(uid UUID DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT is_banned AND (banned_until IS NULL OR banned_until > now())
      FROM public.profiles
      WHERE id = uid
    ),
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
  SELECT COALESCE(
    (SELECT is_verified FROM public.profiles WHERE id = uid),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- CRITICAL: block privilege fields on profile UPDATE
-- - Non-staff: cannot change role, is_verified, is_banned, banned_until, ban_reason, id
-- - Staff: may change verification/ban fields, but NEVER role or id via client
-- - Staff who are not owner: cannot alter owner row's privileged fields
-- Role promotion remains SQL Editor / service role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staff boolean;
  owner_actor boolean;
BEGIN
  -- id immutable for everyone (including staff via client)
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profile id cannot be changed';
  END IF;

  -- role immutable for everyone via client (SQL Editor / table owner only)
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role can only be changed by a database administrator (SQL Editor / service role)';
  END IF;

  staff := public.is_staff();
  owner_actor := public.is_owner();

  -- Verification + ban fields
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
     OR NEW.banned_until IS DISTINCT FROM OLD.banned_until
     OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason THEN

    IF NOT staff THEN
      RAISE EXCEPTION 'verification and ban fields can only be changed by authorized staff';
    END IF;

    -- Non-owner staff cannot modify the owner account's privileged fields
    IF OLD.role = 'owner' AND NOT owner_actor THEN
      RAISE EXCEPTION 'administrators cannot change verification or ban fields on the owner account';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Replace old role-only trigger with the expanded protector
DROP TRIGGER IF EXISTS protect_profile_role_trg ON public.profiles;
DROP TRIGGER IF EXISTS protect_profile_privileged_fields_trg ON public.profiles;

CREATE TRIGGER protect_profile_privileged_fields_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileged_fields();

-- Keep a compatibility alias so older docs/names still point at the same logic
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delegate to the expanded protector
  RETURN public.protect_profile_privileged_fields();
END;
$$;

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
    AND NOT public.is_banned_user(auth.uid())
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

-- Prevent non-owners from creating or flipping official playlists
CREATE OR REPLACE FUNCTION public.protect_playlist_official()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_official IS TRUE AND NOT public.is_owner() THEN
      RAISE EXCEPTION 'only the owner can create official playlists';
    END IF;
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'playlist user_id must be the authenticated user';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_official IS DISTINCT FROM OLD.is_official AND NOT public.is_owner() THEN
      RAISE EXCEPTION 'only the owner can change official playlist flag';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'playlist owner cannot be transferred this way';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_playlist_official_trg ON public.playlists;
CREATE TRIGGER protect_playlist_official_trg
  BEFORE INSERT OR UPDATE ON public.playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_playlist_official();

-- Refresh playlist RLS (idempotent)
DROP POLICY IF EXISTS "playlists_own_all" ON public.playlists;
DROP POLICY IF EXISTS "playlists_public_read" ON public.playlists;
DROP POLICY IF EXISTS "playlists_insert_own" ON public.playlists;
DROP POLICY IF EXISTS "playlists_update_own" ON public.playlists;
DROP POLICY IF EXISTS "playlists_delete_own" ON public.playlists;

CREATE POLICY "playlists_public_read" ON public.playlists
  FOR SELECT
  USING (is_public = true OR is_official = true OR user_id = auth.uid() OR public.is_staff());

CREATE POLICY "playlists_insert_own" ON public.playlists
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT public.is_banned_user(auth.uid())
    AND (is_official IS NOT TRUE OR public.is_owner())
  );

CREATE POLICY "playlists_update_own" ON public.playlists
  FOR UPDATE
  USING (user_id = auth.uid() OR public.is_owner())
  WITH CHECK (
    (user_id = auth.uid() OR public.is_owner())
    AND (is_official IS NOT TRUE OR public.is_owner())
  );

CREATE POLICY "playlists_delete_own" ON public.playlists
  FOR DELETE
  USING (user_id = auth.uid() OR public.is_owner());

-- ---------------------------------------------------------------------------
-- Tracks: moderation metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS moderation_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Lock uploaded_by on update; non-staff cannot escalate status to published
CREATE OR REPLACE FUNCTION public.protect_track_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN
    RAISE EXCEPTION 'uploaded_by cannot be changed';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Only staff may set published / rejected / removed / approved / in_review
    IF NEW.status IN ('published', 'rejected', 'removed', 'approved', 'in_review')
       AND NOT public.is_staff() THEN
      RAISE EXCEPTION 'only staff can set moderation status %', NEW.status;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_track_moderation_trg ON public.tracks;
CREATE TRIGGER protect_track_moderation_trg
  BEFORE UPDATE ON public.tracks
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_track_moderation();

-- Track INSERT: owner may publish; regular users only pending; banned blocked
DROP POLICY IF EXISTS "tracks_insert_owner_only" ON public.tracks;
DROP POLICY IF EXISTS "tracks_insert_auth" ON public.tracks;

CREATE POLICY "tracks_insert_auth" ON public.tracks
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND uploaded_by = auth.uid()
    AND NOT public.is_banned_user(auth.uid())
    AND (
      (public.is_owner() AND status IN ('draft', 'pending', 'published', 'approved'))
      OR (public.is_staff() AND NOT public.is_owner() AND status IN (
            'draft', 'pending', 'in_review', 'approved', 'published',
            'rejected', 'needs_changes'
          ))
      OR (NOT public.is_staff() AND status = 'pending')
    )
  );

DROP POLICY IF EXISTS "tracks_update_own_pending" ON public.tracks;
CREATE POLICY "tracks_update_own_pending" ON public.tracks
  FOR UPDATE
  USING (
    uploaded_by = auth.uid()
    AND status IN ('draft', 'pending', 'needs_changes')
    AND NOT public.is_banned_user(auth.uid())
  )
  WITH CHECK (
    uploaded_by = auth.uid()
    AND status IN ('draft', 'pending', 'needs_changes')
  );

-- Staff update policy should already exist from base schema; ensure present
DROP POLICY IF EXISTS "tracks_update_staff" ON public.tracks;
CREATE POLICY "tracks_update_staff" ON public.tracks
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ---------------------------------------------------------------------------
-- Storage: auth users upload under own uid path; owner unrestricted
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "mega_covers_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_covers_user_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_user_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_covers_user_delete" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_user_delete" ON storage.objects;

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
-- Profile RLS: own ordinary edits + staff moderation updates
-- Trigger enforces which columns may change.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_staff_update" ON public.profiles;

-- Authenticated user may UPDATE only their own row (column lockdown is in trigger)
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id AND NOT public.is_banned_user(auth.uid()))
  WITH CHECK (auth.uid() = id);

-- Staff may UPDATE any profile row for ban/verify (role still blocked by trigger)
CREATE POLICY "profiles_staff_update" ON public.profiles
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- ---------------------------------------------------------------------------
-- Audit insert for staff
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "audit_insert_staff" ON public.audit_logs;
CREATE POLICY "audit_insert_staff" ON public.audit_logs
  FOR INSERT
  WITH CHECK (public.is_staff() AND actor_id = auth.uid());

COMMENT ON COLUMN public.profiles.is_verified IS
  'Trusted verification badge; only staff via client or SQL Editor may set. Enforced by protect_profile_privileged_fields.';
COMMENT ON COLUMN public.profiles.is_banned IS
  'Ban flag; only staff may set. Regular profile UPDATE cannot change this column.';
COMMENT ON FUNCTION public.protect_profile_privileged_fields() IS
  'BEFORE UPDATE on profiles: locks id/role always; locks verify/ban fields unless is_staff(); non-owner staff cannot alter owner privileged fields.';

-- ---------------------------------------------------------------------------
-- Re-run notes
-- ---------------------------------------------------------------------------
-- This file is written to be re-executable. Re-running refreshes functions,
-- triggers, and policies without wiping data. Owner verification UPDATE is
-- idempotent. No demo rows are inserted.
