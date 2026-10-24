-- MEGA MUSIC migration 004 — owner-managed contact links
-- Additive, idempotent. Run in Supabase SQL Editor after previous migrations.

CREATE TABLE IF NOT EXISTS public.contact_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  href TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'link',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_links_href_https CHECK (href ~* '^https://')
);

CREATE INDEX IF NOT EXISTS contact_links_active_sort_idx
  ON public.contact_links (is_active, sort_order);

ALTER TABLE public.contact_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_links_select_public" ON public.contact_links;
DROP POLICY IF EXISTS "contact_links_owner_insert" ON public.contact_links;
DROP POLICY IF EXISTS "contact_links_owner_update" ON public.contact_links;
DROP POLICY IF EXISTS "contact_links_owner_delete" ON public.contact_links;

-- Anyone can read active links (no secrets)
CREATE POLICY "contact_links_select_public" ON public.contact_links
  FOR SELECT
  USING (is_active = true OR public.is_owner());

CREATE POLICY "contact_links_owner_insert" ON public.contact_links
  FOR INSERT
  WITH CHECK (public.is_owner());

CREATE POLICY "contact_links_owner_update" ON public.contact_links
  FOR UPDATE
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

CREATE POLICY "contact_links_owner_delete" ON public.contact_links
  FOR DELETE
  USING (public.is_owner());

-- Seed Bale if table empty (safe for first run only)
INSERT INTO public.contact_links (name, href, icon, sort_order, is_active)
SELECT 'بله', 'https://ble.ir/darkknight_studio', 'bale', 0, true
WHERE NOT EXISTS (SELECT 1 FROM public.contact_links LIMIT 1);

COMMENT ON TABLE public.contact_links IS 'Public contact channels; write only by owner.';
