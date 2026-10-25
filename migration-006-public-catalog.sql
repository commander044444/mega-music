-- MEGA MUSIC migration 006 — ensure PUBLIC (anonymous) can read published content
-- Safe, additive, idempotent. Does not delete data.

-- Allow anon + authenticated to execute helper functions used in RLS
GRANT EXECUTE ON FUNCTION public.is_owner() TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.is_staff() TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.is_banned_user(UUID) TO anon, authenticated, public;

-- Harden helpers: never null-crash for anonymous
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT true FROM public.profiles
      WHERE id = auth.uid() AND role = 'owner'
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT true FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'owner')
      LIMIT 1
    ),
    false
  );
$$;

-- Tracks: explicit public read of published rows (works for anon)
DROP POLICY IF EXISTS "tracks_select_published_or_staff" ON public.tracks;
DROP POLICY IF EXISTS "tracks_select_public_published" ON public.tracks;
DROP POLICY IF EXISTS "tracks_select_own" ON public.tracks;
DROP POLICY IF EXISTS "tracks_select_staff" ON public.tracks;

CREATE POLICY "tracks_select_public_published" ON public.tracks
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

CREATE POLICY "tracks_select_own" ON public.tracks
  FOR SELECT
  TO authenticated
  USING (uploaded_by = auth.uid());

CREATE POLICY "tracks_select_staff" ON public.tracks
  FOR SELECT
  TO authenticated
  USING (public.is_staff());

-- Profiles readable publicly (already typical; re-assert)
DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;
CREATE POLICY "profiles_select_public" ON public.profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Playlists: public/official readable by everyone
DROP POLICY IF EXISTS "playlists_public_read" ON public.playlists;
CREATE POLICY "playlists_public_read" ON public.playlists
  FOR SELECT
  TO anon, authenticated
  USING (
    is_public = true
    OR is_official = true
    OR user_id = auth.uid()
    OR public.is_staff()
  );

-- Playlist items: readable if parent playlist is visible
DROP POLICY IF EXISTS "playlist_items_select_visible" ON public.playlist_items;
DROP POLICY IF EXISTS "playlist_items_own" ON public.playlist_items;

CREATE POLICY "playlist_items_select_visible" ON public.playlist_items
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists pl
      WHERE pl.id = playlist_id
        AND (
          pl.is_public = true
          OR pl.is_official = true
          OR pl.user_id = auth.uid()
          OR public.is_staff()
        )
    )
  );

CREATE POLICY "playlist_items_own_write" ON public.playlist_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists pl
      WHERE pl.id = playlist_id AND pl.user_id = auth.uid()
    )
    OR public.is_owner()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.playlists pl
      WHERE pl.id = playlist_id AND pl.user_id = auth.uid()
    )
    OR public.is_owner()
  );

-- Contact links (if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contact_links'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "contact_links_select_public" ON public.contact_links';
    EXECUTE $p$
      CREATE POLICY "contact_links_select_public" ON public.contact_links
        FOR SELECT TO anon, authenticated
        USING (is_active = true OR public.is_owner())
    $p$;
  END IF;
END $$;

COMMENT ON POLICY "tracks_select_public_published" ON public.tracks IS
  'Anonymous and logged-in users can list/play published tracks without login.';
