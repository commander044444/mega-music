-- Owner playlists may be public; regular users force private
-- Idempotent additive migration

CREATE OR REPLACE FUNCTION public.enforce_playlist_visibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_owner() THEN
    RAISE EXCEPTION 'playlist user_id must match authenticated user';
  END IF;

  -- Official only owner (already protected elsewhere; reinforce)
  IF NEW.is_official IS TRUE AND NOT public.is_owner() THEN
    RAISE EXCEPTION 'only the owner can create official playlists';
  END IF;

  IF public.is_owner() THEN
    -- Owner may set public/official
    NULL;
  ELSE
    NEW.is_public := false;
    NEW.is_official := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_playlist_visibility_trg ON public.playlists;
CREATE TRIGGER enforce_playlist_visibility_trg
  BEFORE INSERT OR UPDATE ON public.playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_playlist_visibility();

-- Tighten insert policy
DROP POLICY IF EXISTS "playlists_insert_own" ON public.playlists;
CREATE POLICY "playlists_insert_own" ON public.playlists
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT public.is_banned_user(auth.uid())
    AND (
      (public.is_owner() AND (is_official IS TRUE OR is_official IS FALSE))
      OR (NOT public.is_owner() AND is_public IS FALSE AND is_official IS NOT TRUE)
    )
  );
