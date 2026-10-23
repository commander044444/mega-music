# MEGA MUSIC — Phase 1

Premium black-and-red music discovery UI with glassmorphism, functional local player, and search.

**Live (GitHub Pages):** https://commander044444.github.io/mega-music/

## Phase 1 features

- Responsive glassmorphism interface (black / deep red)
- Custom SVG logo, favicon, and control icons
- Persian RTL layout + English content support
- Track grid with artwork, title, artist
- Live search by title / artist / album / tags (local catalog)
- Persistent bottom player: play/pause, prev/next, seek, volume
- Single shared `<audio>` element
- Config placeholder for future Supabase connection

## Local demo catalog

Phase 1 ships with a small local dataset and sample audio from SoundHelix (demo use).  
Search for e.g. `پیشرو` or `Neon` to filter results.

## Setup (Phase 1)

1. Open the site on GitHub Pages or serve the root folder with any static server.
2. Optional: edit `config.js` and set your public Supabase URL + anon key (no effect until Phase 2).

No build step. No Node.js required.

## Repository structure (flat)

All files live at the repository root for GitHub Pages:

- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `logo.svg`
- `icons.svg`
- `favicon.svg`
- `README.md`

## Next phase (recommended)

Phase 2: Connect real Supabase catalog, authentication, playlists, and storage.

## License

Demo project. Sample audio is for development only; replace with properly licensed content for production.
