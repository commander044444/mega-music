# MEGA MUSIC

Premium dark / red music UI. **Catalog starts empty** — no demo tracks.

- **Repository:** https://github.com/commander044444/mega-music  
- **Live:** https://commander044444.github.io/mega-music/

## Security highlights (this revision)

- Profile `role` cannot be changed by the client (BEFORE UPDATE trigger).
- RLS role checks use `SECURITY DEFINER` helpers (`is_owner`, `is_staff`) — no recursive policies on `profiles`.
- Storage upload/delete on `covers` and `audio` is **owner-only**.
- Audio/cover buckets are public for streaming in this phase; `is_downloadable` is metadata only (documented).
- Client validates file type/size; failed DB insert attempts Storage cleanup.
- Only the public anon key belongs in `config.js`. Never commit `service_role`.

## Setup

See **setup-guide-fa.md** (Persian, detailed).

1. Create Supabase project.
2. Run `supabase-schema.sql`.
3. Create public buckets `covers` and `audio`.
4. Fill `config.js` (URL + anon key) and push.
5. Sign up once → promote to owner via SQL Editor.
6. Upload the first real track as owner.

## Root files

```
index.html  styles.css  app.js  config.js
logo.svg  icons.svg  favicon.svg
supabase-schema.sql  README.md  setup-guide-fa.md
```

No subdirectories. No build step. No demo data.
