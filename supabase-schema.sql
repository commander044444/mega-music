-- MEGA MUSIC — Supabase schema (secure, no seed data)
-- Run once in Supabase SQL Editor (Dashboard → SQL).
-- Catalog starts empty. Do not insert demo tracks.
-- After this file, always run migration-001-social.sql.
-- If you re-run this base file later, re-run migration-001-social.sql immediately after.

-- =============================================================================
-- Types
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('user', 'artist', 'admin', 'owner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- Profiles
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  display_name TEXT,
  role public.app_role NOT NULL DEFAULT 'user',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT username_format CHECK (
    username IS NULL OR username ~ '^[a-zA-Z0-9_\.]{3,50}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower
  ON public.profiles (lower(username)) WHERE username IS NOT NULL;

-- Auto-create profile on signup (always role = user)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, role)
  VALUES (
    NEW.id,
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'username', '')), ''),
    COALESCE(
      NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'username', '')), ''),
      split_part(NEW.email, '@', 1)
    ),
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- SECURITY DEFINER helper: read role without triggering RLS (breaks recursion)
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

-- Block client changes to id/role (expanded in migration-001 to also lock
-- is_verified / is_banned / banned_until / ban_reason). Always re-run migration-001
-- after this file so the full protector is installed.
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profile id cannot be changed';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role can only be changed by a database administrator (SQL Editor / service role)';
  END IF;
  -- If social columns exist, lock them for non-staff (safe when columns absent)
  BEGIN
    IF NOT public.is_staff() THEN
      IF (to_jsonb(NEW) ? 'is_verified') AND (NEW.is_verified IS DISTINCT FROM OLD.is_verified) THEN
        RAISE EXCEPTION 'verification and ban fields can only be changed by authorized staff';
      END IF;
      IF (to_jsonb(NEW) ? 'is_banned') AND (
           NEW.is_banned IS DISTINCT FROM OLD.is_banned
           OR NEW.banned_until IS DISTINCT FROM OLD.banned_until
           OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason
         ) THEN
        RAISE EXCEPTION 'verification and ban fields can only be changed by authorized staff';
      END IF;
    END IF;
  EXCEPTION
    WHEN undefined_column THEN
      NULL; -- columns not migrated yet
    WHEN undefined_function THEN
      NULL; -- is_staff not present yet during early bootstrap
  END;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_role_trg ON public.profiles;
CREATE TRIGGER protect_profile_role_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();

-- =============================================================================
-- Tracks (empty by design)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  album TEXT,
  cover_url TEXT,
  audio_url TEXT NOT NULL,
  duration_seconds INTEGER DEFAULT 0,
  lyrics TEXT,
  tags TEXT[] DEFAULT '{}',
  language TEXT DEFAULT 'fa',
  is_downloadable BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft','pending','in_review','needs_changes',
      'approved','published','rejected','removed'
    )),
  uploaded_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracks_status_idx ON public.tracks (status);
CREATE INDEX IF NOT EXISTS tracks_tags_idx ON public.tracks USING gin (tags);

-- =============================================================================
-- Playlists / likes / history / downloads / audit (schema only; UI may be partial)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.playlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS public.likes (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS public.listening_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.download_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('request', 'complete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id UUID,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listening_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop old policies if re-running
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles','tracks','playlists','playlist_items',
        'likes','listening_history','download_events','audit_logs'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Profiles: public read; users may update only their own row
-- Role changes blocked by trigger protect_profile_role (not by recursive SELECT)
CREATE POLICY "profiles_select_public"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
-- Note: role/id protected by BEFORE UPDATE trigger. No recursive profiles SELECT here.

-- Tracks
CREATE POLICY "tracks_select_published_or_staff"
  ON public.tracks FOR SELECT
  USING (
    status = 'published'
    OR uploaded_by = auth.uid()
    OR public.is_staff()
  );

CREATE POLICY "tracks_insert_owner_only"
  ON public.tracks FOR INSERT
  WITH CHECK (public.is_owner() AND uploaded_by = auth.uid());

CREATE POLICY "tracks_update_staff"
  ON public.tracks FOR UPDATE
  USING (public.is_staff());

CREATE POLICY "tracks_delete_owner"
  ON public.tracks FOR DELETE
  USING (public.is_owner());

-- Playlists
CREATE POLICY "playlists_own_all"
  ON public.playlists FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "playlists_public_read"
  ON public.playlists FOR SELECT
  USING (is_public = true OR user_id = auth.uid());

CREATE POLICY "playlist_items_own"
  ON public.playlist_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists pl
      WHERE pl.id = playlist_id AND pl.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.playlists pl
      WHERE pl.id = playlist_id AND pl.user_id = auth.uid()
    )
  );

-- Likes / history / downloads
CREATE POLICY "likes_own"
  ON public.likes FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "history_own"
  ON public.listening_history FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "download_events_insert_own"
  ON public.download_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "download_events_select_own_or_staff"
  ON public.download_events FOR SELECT
  USING (user_id = auth.uid() OR public.is_staff());

CREATE POLICY "audit_select_staff"
  ON public.audit_logs FOR SELECT
  USING (public.is_staff());

-- =============================================================================
-- Storage policies (buckets must exist: covers, audio)
-- Upload restricted to owner via is_owner(). Streaming is public by design
-- for this phase (see setup-guide-fa.md). is_downloadable is metadata only
-- while objects are publicly readable.
-- =============================================================================

-- Remove prior storage policies on these buckets if present
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (
        policyname ILIKE '%mega%' OR
        policyname ILIKE '%covers%' OR
        policyname ILIKE '%audio%' OR
        policyname IN (
          'Auth upload covers','Public read covers',
          'Auth upload audio','Public read audio',
          'Owner upload covers','Owner upload audio',
          'Public read covers mega','Public read audio mega'
        )
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "mega_covers_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'covers');

CREATE POLICY "mega_audio_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'audio');

CREATE POLICY "mega_covers_owner_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'covers' AND public.is_owner());

CREATE POLICY "mega_audio_owner_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'audio' AND public.is_owner());

CREATE POLICY "mega_covers_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'covers' AND public.is_owner());

CREATE POLICY "mega_audio_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'audio' AND public.is_owner());

CREATE POLICY "mega_covers_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'covers' AND public.is_owner());

CREATE POLICY "mega_audio_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'audio' AND public.is_owner());

-- =============================================================================
-- First owner bootstrap (manual, run once in SQL Editor as project admin)
-- =============================================================================
-- 1) Sign up via the website once.
-- 2) Copy UUID from Authentication → Users.
-- 3) Run (replace the UUID):
--
--    UPDATE public.profiles SET role = 'owner' WHERE id = 'YOUR_USER_UUID';
--
-- This bypasses the protect_profile_role trigger only when executed with a role
-- that owns the table (SQL Editor / service role). The anon/authenticated client
-- cannot change roles.

COMMENT ON TABLE public.tracks IS 'Catalog starts empty. No seed data.';
COMMENT ON FUNCTION public.current_user_role() IS 'SECURITY DEFINER role lookup to avoid RLS recursion on profiles.';
COMMENT ON FUNCTION public.protect_profile_role() IS 'Prevents clients from escalating role or changing profile id.';

-- After this file, run migration-001-social.sql for follows, bans, verification, user submissions.
