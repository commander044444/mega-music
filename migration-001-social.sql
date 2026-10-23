-- MEGA MUSIC migration 001 — social platform (INCREMENTAL, IDEMPOTENT)
-- Run AFTER base supabase-schema.sql has been applied at least once.
-- Safe to re-run: uses IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE.
-- Does NOT drop tables or delete data. Preserves owner and existing tracks.
-- IMPORTANT: Do not re-run supabase-schema.sql after this migration without
-- re-running this file afterward (base schema can recreate weaker policies/triggers).
--
-- SECURITY (this revision):
-- Regular users may update only ordinary profile fields (username, display_name,
-- bio, avatar_url, updated_at). They cannot change role, is_verified, is_banned,
-- banned_until, or ban_reason. Enforced by trigger protect_profile_privileged_fields()
-- (database-enforced, not frontend-only).
-- protect_profile_role() is a full duplicate body for compatibility only;
-- it is not wired as a second trigger and does not call other trigger functions.

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
-- - Non-owner: cannot change role, is_verified, is_banned, banned_until, ban_reason, id
-- - Owner only: may change is_verified / ban fields (never role/id via client)
-- - Role promotion remains SQL Editor / service role only.
-- - Track moderation (status, reviewed_*) remains staff (admin or owner).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_actor boolean;
BEGIN
  -- Always return NEW on success (required for BEFORE UPDATE triggers).
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profile id cannot be changed';
  END IF;

  -- role is never changeable via client (SQL Editor / superuser only)
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role can only be changed by a database administrator (SQL Editor / service role)';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'created_at cannot be changed';
  END IF;

  owner_actor := public.is_owner();

  -- Verification and ban fields: OWNER ONLY (not admin/staff)
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
     OR NEW.banned_until IS DISTINCT FROM OLD.banned_until
     OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason THEN

    IF NOT owner_actor THEN
      RAISE EXCEPTION 'verification and ban fields can only be changed by the owner';
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

-- Compatibility: redefine protect_profile_role with the SAME full body so any
-- leftover reference is safe. It does NOT call another trigger function.
-- Active trigger on profiles is only protect_profile_privileged_fields_trg.
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_actor boolean;
BEGIN
  -- Full standalone body (does not call other trigger functions).
  -- Not attached as a trigger after this migration; kept for name compatibility.
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profile id cannot be changed';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role can only be changed by a database administrator (SQL Editor / service role)';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'created_at cannot be changed';
  END IF;

  owner_actor := public.is_owner();

  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
     OR NEW.banned_until IS DISTINCT FROM OLD.banned_until
     OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason THEN
    IF NOT owner_actor THEN
      RAISE EXCEPTION 'verification and ban fields can only be changed by the owner';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
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
  USING (
    (user_id = auth.uid() AND NOT public.is_banned_user(auth.uid()))
    OR public.is_owner()
  )
  WITH CHECK (
    ((user_id = auth.uid() AND NOT public.is_banned_user(auth.uid())) OR public.is_owner())
    AND (is_official IS NOT TRUE OR public.is_owner())
  );

CREATE POLICY "playlists_delete_own" ON public.playlists
  FOR DELETE
  USING (
    (user_id = auth.uid() AND NOT public.is_banned_user(auth.uid()))
    OR public.is_owner()
  );

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
DECLARE
  staff boolean;
BEGIN
  staff := public.is_staff();

  -- Ownership of the upload is immutable
  IF NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN
    RAISE EXCEPTION 'uploaded_by cannot be changed';
  END IF;

  -- Moderation metadata: only staff may set or change
  IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.moderation_note IS DISTINCT FROM OLD.moderation_note THEN
    IF NOT staff THEN
      RAISE EXCEPTION 'moderation metadata can only be changed by authorized staff';
    END IF;
  END IF;

  -- Status transitions to staff-only values
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('published', 'rejected', 'removed', 'approved', 'in_review')
       AND NOT staff THEN
      RAISE EXCEPTION 'only staff can set moderation status %', NEW.status;
    END IF;
    -- Non-staff may only keep draft/pending/needs_changes (matches RLS)
    IF NOT staff AND NEW.status NOT IN ('draft', 'pending', 'needs_changes') THEN
      RAISE EXCEPTION 'invalid status for non-staff track update: %', NEW.status;
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
-- Storage: replace known project policies; recreate intended set
-- Intended model:
--   SELECT: public read on covers + audio (required for GitHub Pages player)
--   INSERT: owner OR path under auth.uid(); banned cannot upload
--   UPDATE: owner only (prevents path move / overwrite by non-owners)
--   DELETE: owner OR own uid path (banned may delete own objects for cleanup)
-- Public read means URLs are reachable without auth; is_downloadable is metadata only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "mega_covers_public_read" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_public_read" ON storage.objects;
DROP POLICY IF EXISTS "mega_covers_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_covers_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "mega_covers_owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "mega_covers_user_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_user_insert" ON storage.objects;
DROP POLICY IF EXISTS "mega_covers_user_delete" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_user_delete" ON storage.objects;
DROP POLICY IF EXISTS "mega_covers_user_update" ON storage.objects;
DROP POLICY IF EXISTS "mega_audio_user_update" ON storage.objects;

CREATE POLICY "mega_covers_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'covers');

CREATE POLICY "mega_audio_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'audio');

CREATE POLICY "mega_covers_user_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'covers'
    AND NOT public.is_banned_user(auth.uid())
    AND (
      public.is_owner()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

CREATE POLICY "mega_audio_user_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'audio'
    AND NOT public.is_banned_user(auth.uid())
    AND (
      public.is_owner()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

-- UPDATE: owner only (blocks non-owner path moves / overwrites)
CREATE POLICY "mega_covers_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'covers' AND public.is_owner())
  WITH CHECK (bucket_id = 'covers' AND public.is_owner());

CREATE POLICY "mega_audio_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'audio' AND public.is_owner())
  WITH CHECK (bucket_id = 'audio' AND public.is_owner());

CREATE POLICY "mega_covers_user_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'covers'
    AND (
      public.is_owner()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

CREATE POLICY "mega_audio_user_delete"
  ON storage.objects FOR DELETE TO authenticated
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

-- Staff may UPDATE profile rows; ban/verify changes still require is_owner() in the trigger.
CREATE POLICY "profiles_staff_update" ON public.profiles
  FOR UPDATE
  USING (public.is_staff())
  WITH CHECK (public.is_staff());


-- Banned users cannot like
DROP POLICY IF EXISTS "likes_own" ON public.likes;
CREATE POLICY "likes_own_select" ON public.likes
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "likes_own_insert" ON public.likes
  FOR INSERT WITH CHECK (user_id = auth.uid() AND NOT public.is_banned_user(auth.uid()));
CREATE POLICY "likes_own_delete" ON public.likes
  FOR DELETE USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Audit insert for staff
-- ---------------------------------------------------------------------------

-- Listening history / downloads: banned users cannot write new events
DROP POLICY IF EXISTS "history_own" ON public.listening_history;
CREATE POLICY "history_own_select" ON public.listening_history
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "history_own_insert" ON public.listening_history
  FOR INSERT WITH CHECK (user_id = auth.uid() AND NOT public.is_banned_user(auth.uid()));

DROP POLICY IF EXISTS "download_events_insert_own" ON public.download_events;
CREATE POLICY "download_events_insert_own" ON public.download_events
  FOR INSERT WITH CHECK (user_id = auth.uid() AND NOT public.is_banned_user(auth.uid()));

DROP POLICY IF EXISTS "audit_insert_staff" ON public.audit_logs;
CREATE POLICY "audit_insert_staff" ON public.audit_logs
  FOR INSERT
  WITH CHECK (public.is_staff() AND actor_id = auth.uid());

COMMENT ON COLUMN public.profiles.is_verified IS
  'Trusted verification badge; only the owner may set via client; role never via client. Enforced by protect_profile_privileged_fields.';
COMMENT ON COLUMN public.profiles.is_banned IS
  'Ban flag; only the owner may set via client. Regular users cannot change this column.';
COMMENT ON FUNCTION public.protect_profile_privileged_fields() IS
  'BEFORE UPDATE on profiles: locks id/role always; locks verify/ban fields unless is_owner(); role/id always locked for clients.';

-- ---------------------------------------------------------------------------
-- Re-run notes
-- ---------------------------------------------------------------------------
-- This file is written to be re-executable. Re-running refreshes functions,
-- triggers, and policies without wiping data. Owner verification UPDATE is
-- idempotent. No demo rows are inserted.


-- =============================================================================
-- POST-MIGRATION VERIFICATION (run manually in SQL Editor; read-only checks)
-- =============================================================================
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
-- Expect: protect_profile_privileged_fields_trg (not protect_profile_role_trg)
--
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.tracks'::regclass AND NOT tgisinternal;
-- Expect: protect_track_moderation_trg
--
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.tracks'::regclass;
-- Expect: tracks_insert_auth, tracks_update_own_pending, tracks_update_staff, ...
--
-- Role matrix (expected):
-- anon: select published tracks only; no inserts
-- user: insert tracks status=pending only; cannot set published/reviewed_*
-- banned: no track insert, no follow insert, no like insert, no profile update
-- admin (non-owner): moderate tracks; CANNOT set is_verified/is_banned
-- owner: ban/verify; publish; official playlists; all staff powers
