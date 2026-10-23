# MEGA MUSIC

Premium dark / red music platform inspired by a reference mobile UI.  
**Catalog starts completely empty** — no demo tracks, no sample audio.

- **Repository:** https://github.com/commander044444/mega-music  
- **Live (GitHub Pages):** https://commander044444.github.io/mega-music/

## Phase status

- Reference-aligned UI (list cards, bottom nav, red clef, glows)
- Empty catalog by design
- Search, player, auth UI, owner upload form
- Supabase-ready (config + SQL schema)
- Flat root structure for GitHub Pages

## Quick start

1. Open the live site — you will see the empty state «هنوز آهنگی اضافه نشده».
2. Create a Supabase project.
3. Run `supabase-schema.sql` in the SQL Editor.
4. Create Storage buckets: `covers` (public) and `audio` (public or signed as needed).
5. Put your project URL and **anon** key in `config.js`.
6. Sign up once, then promote that user to `owner` in SQL (see setup guide).
7. Log in → More → upload the first real track.

See **setup-guide-fa.md** for full Persian instructions.

## Structure (all at repository root)

```
index.html  styles.css  app.js  config.js
logo.svg  icons.svg  favicon.svg
supabase-schema.sql  README.md  setup-guide-fa.md
```

No subdirectories. No build step.

## Security notes

- Only the public anon key belongs in `config.js`.
- Roles are enforced with RLS; the browser never decides privileges.
- First owner is set manually via SQL — visitors cannot self-promote.

## License

Application code for this demo project. Add only music you have rights to publish.
