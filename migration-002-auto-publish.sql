-- MEGA MUSIC migration 002 — auto-publish for verified artists (owner-granted)
-- Run AFTER migration-001-social.sql. Idempotent. No data deletion.

-- ---------------------------------------------------------------------------
-- Column: owner may grant verified users permission to publish without review
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_auto_publish BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.can_auto_publish IS
  'When true AND is_verified, user may INSERT tracks with status=published. Only owner may set this flag.';

-- Clear flag if somehow set without verification (safe cleanup)
UPDATE public.profiles
SET can_auto_publish = false
WHERE can_auto_publish IS TRUE AND is_verified IS NOT TRUE AND role <> 'owner';

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: may this user publish without moderation?
-- Requires: not banned, is_verified, can_auto_publish (or is owner)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_auto_publish(uid UUID DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        role = 'owner'
        OR (
          is_verified IS TRUE
          AND can_auto_publish IS TRUE
          AND NOT (is_banned IS TRUE AND (banned_until IS NULL OR banned_until > now()))
        )
      FROM public.profiles
      WHERE id = uid
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Extend profile privilege trigger: lock can_auto_publish for non-owners
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
     OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason
     OR NEW.can_auto_publish IS DISTINCT FROM OLD.can_auto_publish THEN

    IF NOT owner_actor THEN
      RAISE EXCEPTION 'verification, ban, and auto-publish fields can only be changed by the owner';
    END IF;
  END IF;

  -- Auto-publish only meaningful with verification; clear when un-verifying
  IF NEW.is_verified IS NOT TRUE AND NEW.role IS DISTINCT FROM 'owner' THEN
    NEW.can_auto_publish := false;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Keep compatibility function in sync (not attached as second trigger)
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_actor boolean;
BEGIN
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
     OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason
     OR NEW.can_auto_publish IS DISTINCT FROM OLD.can_auto_publish THEN
    IF NOT owner_actor THEN
      RAISE EXCEPTION 'verification, ban, and auto-publish fields can only be changed by the owner';
    END IF;
  END IF;

  IF NEW.is_verified IS NOT TRUE AND NEW.role IS DISTINCT FROM 'owner' THEN
    NEW.can_auto_publish := false;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_privileged_fields_trg ON public.profiles;
CREATE TRIGGER protect_profile_privileged_fields_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileged_fields();

-- ---------------------------------------------------------------------------
-- Track INSERT: verified + can_auto_publish may insert status=published
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
      (public.is_owner() AND status IN ('draft', 'pending', 'published', 'approved'))
      OR (public.is_staff() AND NOT public.is_owner() AND status IN (
            'draft', 'pending', 'in_review', 'approved', 'published',
            'rejected', 'needs_changes'
          ))
      OR (NOT public.is_staff() AND status = 'pending')
      OR (
        status = 'published'
        AND public.user_can_auto_publish(auth.uid())
      )
    )
  );

COMMENT ON FUNCTION public.user_can_auto_publish(UUID) IS
  'True if user is owner, or verified with can_auto_publish and not banned.';
