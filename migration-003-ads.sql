-- MEGA MUSIC migration 003 — advertising campaigns (additive, idempotent)
-- Run AFTER migration-001 and migration-002. Does not drop tables or delete data.

CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  placement TEXT NOT NULL CHECK (placement IN (
    'home_hero', 'home_secondary', 'catalog_top'
  )),
  image_url TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT 'تبلیغ',
  priority INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'scheduled', 'active', 'paused', 'expired'
  )),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ad_campaigns_dates_ok CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at
  )
);

CREATE INDEX IF NOT EXISTS ad_campaigns_placement_idx ON public.ad_campaigns (placement);
CREATE INDEX IF NOT EXISTS ad_campaigns_status_idx ON public.ad_campaigns (status);

CREATE TABLE IF NOT EXISTS public.ad_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'click')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_events_campaign_idx ON public.ad_events (campaign_id, event_type);

ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;

-- Helper: campaign currently eligible for public display
CREATE OR REPLACE FUNCTION public.ad_is_publicly_eligible(c public.ad_campaigns)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.status = 'active'
    AND (c.starts_at IS NULL OR c.starts_at <= now())
    AND (c.ends_at IS NULL OR c.ends_at > now())
    AND c.image_url IS NOT NULL
    AND c.destination_url IS NOT NULL
    AND c.destination_url ~* '^https://';
$$;

DROP POLICY IF EXISTS "ad_campaigns_select_public" ON public.ad_campaigns;
DROP POLICY IF EXISTS "ad_campaigns_select_owner" ON public.ad_campaigns;
DROP POLICY IF EXISTS "ad_campaigns_owner_write" ON public.ad_campaigns;
DROP POLICY IF EXISTS "ad_campaigns_owner_update" ON public.ad_campaigns;
DROP POLICY IF EXISTS "ad_campaigns_owner_delete" ON public.ad_campaigns;

-- Public may only read fields of eligible active campaigns (full row; no secrets stored)
CREATE POLICY "ad_campaigns_select_public" ON public.ad_campaigns
  FOR SELECT
  USING (public.ad_is_publicly_eligible(ad_campaigns.*) OR public.is_owner());

CREATE POLICY "ad_campaigns_owner_insert" ON public.ad_campaigns
  FOR INSERT
  WITH CHECK (public.is_owner() AND created_by = auth.uid());

CREATE POLICY "ad_campaigns_owner_update" ON public.ad_campaigns
  FOR UPDATE
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

CREATE POLICY "ad_campaigns_owner_delete" ON public.ad_campaigns
  FOR DELETE
  USING (public.is_owner());

DROP POLICY IF EXISTS "ad_events_insert_public" ON public.ad_events;
DROP POLICY IF EXISTS "ad_events_select_owner" ON public.ad_events;

-- Anyone can record impression/click only for eligible campaigns
CREATE POLICY "ad_events_insert_public" ON public.ad_events
  FOR INSERT
  WITH CHECK (
    event_type IN ('impression', 'click')
    AND EXISTS (
      SELECT 1 FROM public.ad_campaigns c
      WHERE c.id = campaign_id AND public.ad_is_publicly_eligible(c)
    )
  );

CREATE POLICY "ad_events_select_owner" ON public.ad_events
  FOR SELECT
  USING (public.is_owner());

COMMENT ON TABLE public.ad_campaigns IS 'Owner-managed ad campaigns; public sees only active scheduled rows.';
COMMENT ON TABLE public.ad_events IS 'Recorded impression/click events; not unique users.';
