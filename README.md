# MEGA MUSIC

Social music streaming platform on GitHub Pages + Supabase.

- **Live:** https://commander044444.github.io/mega-music/
- **Repo:** https://github.com/commander044444/mega-music

## Features

- Empty catalog until real tracks are published (no demo data)
- Auth: register, login, logout, password recovery
- Profiles, follow/unfollow, verified badge (owner)
- Category search (tracks, users, playlists)
- Full-screen player + mini player (queue, shuffle, repeat, lyrics)
- User submissions → pending moderation
- Owner/admin dashboard (stats, approve/reject, ban, verify)
- Playlists (create, add tracks, play)
- Glassmorphism UI, Persian RTL

## Setup

1. Base schema: run `supabase-schema.sql` (if not already).
2. Social migration: run `migration-001-social.sql`.
3. Buckets `audio` and `covers` (public read for streaming).
4. `config.js`: Project URL + **anon** key only.
5. Auth URL config: Site URL + redirect = GitHub Pages URL.
6. Owner already set — do not reset roles.

See **setup-guide-fa.md**.

## Security

- Role changes blocked by DB trigger.
- Clients cannot self-promote or self-verify.
- Regular users insert tracks only as `pending`.
- Storage writes scoped to own folder or owner.
- Public audio URLs = streamable; `is_downloadable` is metadata only.

## Stack

Vanilla HTML/CSS/JS · Supabase JS CDN · GitHub Pages · flat root files
