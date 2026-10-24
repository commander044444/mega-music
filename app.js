/**
 * MEGA MUSIC — social streaming platform
 * Empty catalog by design until real published tracks exist.
 * Auth, profiles, search, submissions, moderation, full player.
 */
(function () {
  'use strict';

  const cfg = window.MEGA_CONFIG || {};
  const hasSupabase = !!(cfg.supabaseUrl && cfg.supabaseAnonKey &&
    String(cfg.supabaseUrl).startsWith('http') && String(cfg.supabaseAnonKey).length > 20);

  let sb = null;
  if (hasSupabase && window.supabase) {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }

  const MAX_AUDIO = 30 * 1024 * 1024;
  const MAX_COVER = 5 * 1024 * 1024;
  const AUDIO_OK = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-wav', 'audio/webm'];
  const COVER_OK = ['image/jpeg', 'image/png', 'image/webp'];
  const AD_IMAGE_OK = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_AD_IMAGE = 8 * 1024 * 1024; // 8MB — includes GIF

  const STATUS_FA = {
    draft: 'پیش‌نویس', pending: 'در انتظار بررسی', in_review: 'در حال بررسی',
    needs_changes: 'نیاز به اصلاح', approved: 'تأیید شده', published: 'منتشر شده',
    rejected: 'رد شده', removed: 'حذف شده'
  };

  const state = {
    tracks: [],
    filtered: [],
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    shuffle: false,
    repeat: 0, // 0 off, 1 all, 2 one
    volume: 0.8,
    user: null,
    profile: null,
    isOwner: false,
    isStaff: false,
    searchCat: 'tracks',
    authMode: 'login',
    pendingAuth: null, // { email, password } after rate-limited signup
    authBusy: false,
    viewingUserId: null,
    likedIds: new Set(),
    adImpressionSent: new Set()
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function normalize(str) {
    return (str || '').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();
  }
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function showMsg(el, text, type) {
    if (!el) return;
    el.innerHTML = text ? `<div class="msg msg-${type}">${escapeHtml(text)}</div>` : '';
  }
  function verifiedBadge() {
    return `<span class="badge-verified" title="مالک تأییدشده MEGA MUSIC" aria-label="تأییدشده"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>`;
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // ---------- Catalog ----------
  async function loadCatalog() {
    state.tracks = [];
    state.filtered = [];
    if (!sb) { renderTracks(); updateCount(); return; }
    try {
      const { data, error } = await sb.from('tracks')
        .select('id, title, artist_name, album, cover_url, audio_url, duration_seconds, tags, is_downloadable, status, lyrics, uploaded_by')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) console.warn('catalog', error.message);
      state.tracks = (data || []).map(mapTrack);
      state.filtered = [...state.tracks];
      state.queue = [...state.tracks];
    } catch (e) { console.warn(e); }
    renderTracks();
    updateCount();
    try { await loadHomeDiscovery(); } catch (e) { console.warn(e); }
    try { await loadPublicAds(); } catch (e) { console.warn(e); }
  }

  function mapTrack(t) {
    return {
      id: t.id,
      title: t.title,
      artist: t.artist_name || 'نامشخص',
      album: t.album || '',
      cover: t.cover_url || '',
      audio: t.audio_url || '',
      duration: t.duration_seconds || 0,
      tags: t.tags || [],
      lyrics: t.lyrics || '',
      downloadable: !!t.is_downloadable,
      status: t.status,
      uploaded_by: t.uploaded_by
    };
  }

  function updateCount() {
    const n = state.tracks.length;
    const c = $('#trackCount'); if (c) c.textContent = String(n);
    const h = $('#heroSub');
    if (h) h.textContent = n === 0 ? 'هنوز آهنگی منتشر نشده' : `${n} آهنگ منتشرشده`;
  }

  function renderTracks(list, container, emptyEl) {
    const items = list != null ? list : state.filtered;
    const box = container || $('#trackList');
    const empty = emptyEl || $('#emptyState');
    if (!box) return;
    if (!items.length) {
      box.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    box.innerHTML = items.map(t => {
      const idx = state.queue.findIndex(x => x.id === t.id);
      const playing = idx === state.currentIndex && state.isPlaying;
      const art = t.cover
        ? `<img class="row-art" src="${escapeHtml(t.cover)}" alt="" loading="lazy" width="56" height="56">`
        : `<div class="row-art"></div>`;
      return `<article class="track-row ${playing ? 'playing' : ''}" data-id="${escapeHtml(t.id)}" tabindex="0">
        <div class="row-actions">
          <button type="button" class="row-btn" data-action="add" aria-label="افزودن به پلی‌لیست"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
          <button type="button" class="row-btn play ${playing ? 'playing' : ''}" data-action="play" aria-label="پخش"><svg><use href="icons.svg#${playing ? 'icon-pause' : 'icon-play'}"></use></svg></button>
        </div>
        <div class="row-meta">
          <div class="row-title">${escapeHtml(t.title)}</div>
          <div class="row-artist">${escapeHtml(t.artist)}</div>
        </div>${art}</article>`;
    }).join('');
  }

  // ---------- Search ----------
  function getSearchTargets() {
    // #searchResults always exists in DOM; home search must use #trackList
    const onSearch = $('#view-search') && $('#view-search').classList.contains('active');
    if (onSearch) {
      return {
        resultsBox: $('#searchResults') || $('#trackList'),
        emptyEl: $('#searchEmpty') || $('#emptyState')
      };
    }
    return {
      resultsBox: $('#trackList'),
      emptyEl: $('#emptyState')
    };
  }

  function escapeIlike(s) {
    return String(s || '').replace(/[%_,]/g, '').trim();
  }

  async function runSearch(q, cat) {
    const nq = normalize(q);
    cat = cat || 'tracks';
    const targets = getSearchTargets();
    const resultsBox = targets.resultsBox;
    const emptyEl = targets.emptyEl;
    if (!resultsBox) return;

    if (!nq) {
      if (cat === 'tracks' || cat === 'all') {
        state.filtered = state.tracks.slice();
        renderTracks(state.filtered, resultsBox, emptyEl);
      } else {
        resultsBox.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
      }
      return;
    }

    // Instant local filter for tracks (home page catalog)
    let localTracks = [];
    if (cat === 'tracks' || cat === 'all') {
      localTracks = state.tracks.filter(function (t) {
        return normalize(t.title).includes(nq) ||
          normalize(t.artist).includes(nq) ||
          normalize(t.album || '').includes(nq) ||
          (t.tags || []).some(function (x) { return normalize(x).includes(nq); });
      });
      state.filtered = localTracks;
      if (localTracks.length) {
        renderTracks(localTracks, resultsBox, emptyEl);
      }
    }

    if (!sb) {
      if (cat === 'tracks' || cat === 'all') {
        renderTracks(localTracks, resultsBox, emptyEl);
      } else {
        resultsBox.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
      }
      return;
    }

    const term = escapeIlike(q);
    if (!term) return;

    if (!localTracks.length) {
      resultsBox.innerHTML = '<div class="spinner"></div>';
      if (emptyEl) emptyEl.classList.add('hidden');
    }

    const parts = [];
    try {
      if (cat === 'tracks' || cat === 'all') {
        const { data } = await sb.from('tracks')
          .select('id, title, artist_name, album, cover_url, audio_url, duration_seconds, tags, lyrics, status, uploaded_by')
          .eq('status', 'published')
          .or('title.ilike.%' + term + '%,artist_name.ilike.%' + term + '%')
          .limit(40);
        (data || []).forEach(function (tr) { parts.push({ type: 'track', data: mapTrack(tr) }); });
      }
      if (cat === 'users' || cat === 'all') {
        const { data } = await sb.from('profiles')
          .select('id, username, display_name, avatar_url, is_verified, role, bio')
          .or('username.ilike.%' + term + '%,display_name.ilike.%' + term + '%')
          .limit(30);
        (data || []).forEach(function (u) { parts.push({ type: 'user', data: u }); });
      }
      if (cat === 'playlists' || cat === 'all') {
        const { data } = await sb.from('playlists')
          .select('id, title, description, cover_url, is_public, is_official, user_id')
          .eq('is_public', true)
          .ilike('title', '%' + term + '%')
          .limit(20);
        (data || []).forEach(function (pl) { parts.push({ type: 'playlist', data: pl }); });
      }
    } catch (e) { console.warn('search', e); }

    // Re-resolve targets in case view changed during await
    const targets2 = getSearchTargets();
    const box = targets2.resultsBox;
    const empty2 = targets2.emptyEl;
    if (!box) return;

    if (!parts.length) {
      if ((cat === 'tracks' || cat === 'all') && localTracks.length) {
        renderTracks(localTracks, box, empty2);
        return;
      }
      box.innerHTML = '';
      if (empty2) {
        empty2.classList.remove('hidden');
        const h = empty2.querySelector('h2');
        if (h) h.textContent = 'نتیجه‌ای یافت نشد';
      }
      return;
    }
    if (empty2) empty2.classList.add('hidden');

    // Tracks-only on home: use renderTracks for consistent play UI
    if (cat === 'tracks' && parts.every(function (p) { return p.type === 'track'; })) {
      const tracksOnly = parts.map(function (p) { return p.data; });
      state.filtered = tracksOnly;
      tracksOnly.forEach(function (tr) {
        if (!state.queue.find(function (x) { return String(x.id) === String(tr.id); })) state.queue.push(tr);
      });
      renderTracks(tracksOnly, box, empty2);
      return;
    }

    box.innerHTML = parts.map(function (p) {
      if (p.type === 'track') {
        const tr = p.data;
        return '<article class="track-row" data-id="' + escapeHtml(tr.id) + '" data-kind="track">' +
          '<div class="row-actions"><button type="button" class="row-btn play" data-action="play"><svg><use href="icons.svg#icon-play"></use></svg></button></div>' +
          '<div class="row-meta"><div class="row-title">' + escapeHtml(tr.title) + '</div><div class="row-artist">' + escapeHtml(tr.artist) + '</div></div>' +
          (tr.cover ? '<img class="row-art" src="' + escapeHtml(tr.cover) + '" alt="" loading="lazy">' : '<div class="row-art"></div>') +
          '</article>';
      }
      if (p.type === 'user') {
        const u = p.data;
        const badge = u.is_verified || u.role === 'owner' ? verifiedBadge() : '';
        return '<div class="user-row" data-uid="' + escapeHtml(u.id) + '" data-kind="user">' +
          '<img class="user-avatar" src="' + escapeHtml(u.avatar_url || '') + '" alt="" onerror="this.style.background=\'#1a1a1e\'">' +
          '<div class="user-meta"><div class="user-name">' + escapeHtml(u.display_name || u.username || 'کاربر') + ' ' + badge + '</div>' +
          '<div class="user-handle">@' + escapeHtml(u.username || '—') + '</div></div></div>';
      }
      const pl = p.data;
      return '<div class="user-row" data-pid="' + escapeHtml(pl.id) + '" data-kind="playlist">' +
        '<div class="user-avatar" style="border-radius:10px;display:grid;place-items:center;font-size:0.7rem">PL</div>' +
        '<div class="user-meta"><div class="user-name">' + escapeHtml(pl.title) + (pl.is_official ? ' · رسمی' : '') + '</div>' +
        '<div class="user-handle">' + escapeHtml(pl.description || 'پلی‌لیست') + '</div></div></div>';
    }).join('');

    const trackParts = parts.filter(function (p) { return p.type === 'track'; }).map(function (p) { return p.data; });
    if (trackParts.length) {
      state.filtered = trackParts;
      trackParts.forEach(function (tr) {
        if (!state.queue.find(function (x) { return String(x.id) === String(tr.id); })) state.queue.push(tr);
      });
    }
  }

  const debouncedSearch = debounce((q, cat) => runSearch(q, cat), 320);

  // ---------- Player ----------
  const audio = () => $('#mainAudio');

  function setPlayerEnabled(on) {
    ['#btnPlay', '#btnPrev', '#btnNext'].forEach(s => { const b = $(s); if (b) b.disabled = !on; });
  }

  function updatePlayerUI() {
    const t = state.queue[state.currentIndex];
    const mini = $('#miniPlayer');
    if (!t) {
      mini?.classList.remove('visible');
      setPlayerEnabled(false);
      return;
    }
    mini?.classList.add('visible');
    setPlayerEnabled(true);
    const icon = state.isPlaying ? 'icon-pause' : 'icon-play';
    ['#btnPlay', '#fpPlay'].forEach(s => {
      const b = $(s); if (b) b.innerHTML = `<svg><use href="icons.svg#${icon}"></use></svg>`;
    });
    if ($('#miniTitle')) $('#miniTitle').textContent = t.title;
    if ($('#miniArtist')) $('#miniArtist').textContent = t.artist;
    if ($('#miniArt')) { $('#miniArt').src = t.cover || ''; $('#miniArt').alt = t.title; }
    if ($('#fpTitle')) $('#fpTitle').textContent = t.title;
    if ($('#fpArtistLink')) {
      $('#fpArtistLink').textContent = t.artist;
      $('#fpArtistLink').href = '#';
      $('#fpArtistLink').dataset.uid = t.uploaded_by || '';
    }
    if ($('#fpArt')) { $('#fpArt').src = t.cover || ''; $('#fpArt').alt = t.title; }
    if ($('#fpBg')) $('#fpBg').style.backgroundImage = t.cover ? `url(${t.cover})` : 'none';
    if ($('#fpLyrics')) {
      $('#fpLyrics').textContent = t.lyrics || 'متنی ثبت نشده است.';
    }
    updateEqualizer(state.isPlaying);
    if ($('#fpShuffle')) $('#fpShuffle').classList.toggle('active', state.shuffle);
    if ($('#fpRepeat')) $('#fpRepeat').classList.toggle('active', state.repeat > 0);
    renderTracks();
  }

  /** Staff/owner: play any track object (including non-published) without adding to public catalog */
  function playPreviewTrack(raw) {
    if (!raw) return;
    const t = mapTrack(raw);
    if (!t.audio) {
      showMsg($('#adminContent'), 'فایل صوتی برای این آهنگ ثبت نشده است.', 'error');
      return;
    }
    let idx = state.queue.findIndex(x => String(x.id) === String(t.id));
    if (idx < 0) {
      state.queue.push(t);
      idx = state.queue.length - 1;
    } else {
      state.queue[idx] = t; // refresh urls/metadata
    }
    loadTrack(idx, true);
    openFullPlayer();
  }

  function loadTrack(index, autoplay) {
    if (index < 0 || index >= state.queue.length) return;
    const t = state.queue[index];
    if (!t.audio) {
      alert('فایل صوتی در دسترس نیست.');
      return;
    }
    state.currentIndex = index;
    const a = audio();
    a.src = t.audio;
    a.load();
    updatePlayerUI();
    if (autoplay) {
      a.play().then(() => { state.isPlaying = true; updatePlayerUI(); })
        .catch(() => { state.isPlaying = false; updatePlayerUI(); });
    }
  }

  function togglePlay() {
    if (!state.queue.length) return;
    if (state.currentIndex < 0) { loadTrack(0, true); return; }
    const a = audio();
    if (state.isPlaying) { a.pause(); state.isPlaying = false; }
    else { a.play().then(() => { state.isPlaying = true; }).catch(() => {}); }
    updatePlayerUI();
  }

  function playNext() {
    if (!state.queue.length) return;
    let next;
    if (state.repeat === 2) next = state.currentIndex;
    else if (state.shuffle) next = Math.floor(Math.random() * state.queue.length);
    else next = (state.currentIndex + 1) % state.queue.length;
    loadTrack(next, true);
  }
  function playPrev() {
    if (!state.queue.length) return;
    const prev = state.currentIndex <= 0 ? state.queue.length - 1 : state.currentIndex - 1;
    loadTrack(prev, true);
  }

  function openFullPlayer() {
    if (state.currentIndex < 0) return;
    $('#fullPlayer')?.classList.add('open');
    updatePlayerUI();
  }
  function closeFullPlayer() { $('#fullPlayer')?.classList.remove('open'); }

  // ---------- Auth ----------
  function profileFromUser(user) {
    const meta = (user && user.user_metadata) || {};
    return {
      id: user.id,
      username: meta.username || (user.email ? String(user.email).split('@')[0] : 'user'),
      display_name: meta.display_name || meta.username || 'کاربر',
      role: 'user',
      avatar_url: null,
      bio: null,
      is_verified: false,
      is_banned: false,
      banned_until: null,
      can_auto_publish: false,
      _fallback: true
    };
  }

  async function fetchProfile(userId) {
    // Prefer full columns; fall back if migration-002 not applied yet
    const fullCols = 'id, username, display_name, role, avatar_url, bio, is_verified, is_banned, banned_until, can_auto_publish';
    const baseCols = 'id, username, display_name, role, avatar_url, bio, is_verified, is_banned, banned_until';
    let res = await sb.from('profiles').select(fullCols).eq('id', userId).maybeSingle();
    if (res.error && /can_auto_publish|column/i.test(res.error.message || '')) {
      res = await sb.from('profiles').select(baseCols).eq('id', userId).maybeSingle();
      if (res.data) res.data.can_auto_publish = false;
    }
    return res;
  }

  async function ensureProfileRow(user) {
    if (!user) return null;
    // Client usually cannot INSERT profiles (trigger on auth.users does).
    // Re-select only; UI falls back to profileFromUser if still missing.
    const again = await fetchProfile(user.id);
    return (again && again.data) || null;
  }

  async function refreshSession() {
    if (!sb) {
      state.user = null;
      state.profile = null;
      state.isOwner = false;
      state.isStaff = false;
      updateAuthUI();
      return;
    }
    try {
      const { data: sessWrap, error: sessErr } = await sb.auth.getSession();
      if (sessErr) console.warn('getSession', sessErr);
      const session = sessWrap && sessWrap.session;
      state.user = (session && session.user) || null;

      if (state.user) {
        let profile = null;
        try {
          const { data, error } = await fetchProfile(state.user.id);
          if (error) console.warn('profile fetch', error);
          profile = data || null;
        } catch (e) {
          console.warn('profile fetch exception', e);
        }

        if (!profile) {
          try {
            profile = await ensureProfileRow(state.user);
          } catch (e) {
            console.warn('ensureProfile', e);
          }
        }

        // Always allow UI if Auth session exists (even with fallback profile)
        state.profile = profile || profileFromUser(state.user);
        state.isOwner = state.profile.role === 'owner';
        state.isStaff = state.profile.role === 'owner' || state.profile.role === 'admin';
        try {
          await loadLikes();
        } catch (e) {
          console.warn('loadLikes', e);
        }
      } else {
        state.profile = null;
        state.isOwner = false;
        state.isStaff = false;
        state.likedIds = new Set();
      }
    } catch (e) {
      console.error('refreshSession', e);
    }
    updateAuthUI();
  }

  async function loadLikes() {
    state.likedIds = new Set();
    if (!sb || !state.user) return;
    const { data, error } = await sb.from('likes').select('track_id').eq('user_id', state.user.id);
    if (error) return;
    (data || []).forEach(r => state.likedIds.add(r.track_id));
  }

  function updateAuthUI() {
    // Logged-in UI requires Auth user; profile may be fallback
    if (state.user) {
      $('#profileGuest')?.classList.add('hidden');
      $('#profileUser')?.classList.remove('hidden');
      const p = state.profile || profileFromUser(state.user);
      const badge = (p.is_verified || p.role === 'owner') ? verifiedBadge() : '';
      const banned = p.is_banned ? '<p class="msg msg-error">حساب شما محدود شده است.</p>' : '';
      const emailOk = isEmailConfirmed(state.user);
      const emailNote = emailOk
        ? '<p class="msg msg-ok" style="margin-top:8px">ایمیل تأیید شده است.</p>'
        : '<p class="msg msg-info" style="margin-top:8px">ایمیل هنوز تأیید نشده است (وضعیت Auth).</p>';
      const header = $('#myProfileHeader');
      if (header) {
        header.innerHTML = `
        <img class="profile-avatar" src="${escapeHtml(p.avatar_url || '')}" alt="" onerror="this.src=''">
        <div class="profile-name">${escapeHtml(p.display_name || p.username || state.user.email || '')} ${badge}</div>
        <div class="profile-handle">@${escapeHtml(p.username || '—')} · ${escapeHtml(p.role || 'user')}</div>
        <div class="profile-bio">${escapeHtml(p.bio || '')}</div>${banned}${emailNote}`;
      }
      if (state.isStaff) {
        $('#adminSection')?.classList.remove('hidden');
        try { loadAdmin('overview'); } catch (e) { console.warn(e); }
      } else {
        $('#adminSection')?.classList.add('hidden');
      }
      const subBtn = $('#btnDoSubmit');
      const hint = $('#submitHint');
      const autoPub = !!(p.is_verified && p.can_auto_publish);
      if (subBtn) {
        subBtn.textContent = (state.isOwner || autoPub) ? 'بارگذاری و انتشار' : 'ارسال برای بررسی';
      }
      if (hint) {
        if (state.isOwner) {
          hint.textContent = 'به‌عنوان مالک، آهنگ مستقیماً منتشر می‌شود.';
        } else if (autoPub) {
          hint.textContent = 'حساب شما تأیید شده و انتشار بدون بررسی فعال است؛ آهنگ مستقیماً در کاتالوگ عمومی قرار می‌گیرد.';
        } else {
          hint.textContent = 'آهنگ شما برای بررسی ارسال می‌شود و پس از تأیید منتشر خواهد شد.';
        }
      }
      // Auth button label
      const btnAuth = $('#btnAuth');
      if (btnAuth) btnAuth.setAttribute('aria-label', 'پروفایل');
    } else {
      $('#profileGuest')?.classList.remove('hidden');
      $('#profileUser')?.classList.add('hidden');
      $('#adminSection')?.classList.add('hidden');
    }
  }


  function isEmailRateLimitError(err) {
    const m = String(err?.message || err || '').toLowerCase();
    return /rate.?limit|email rate limit|over_email_send_rate_limit|429/.test(m);
  }

  function isEmailNotConfirmedError(err) {
    const m = String(err?.message || err || '').toLowerCase();
    return /email not confirmed|email_not_confirmed|not confirmed|confirm your email/.test(m);
  }

  function isEmailConfirmed(user) {
    if (!user) return false;
    return !!(user.email_confirmed_at || user.confirmed_at);
  }

  function setAuthBusy(busy) {
    state.authBusy = busy;
    const btn = $('#authSubmit');
    if (btn) {
      btn.disabled = !!busy;
      if (busy) btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.textContent = busy ? 'لطفاً صبر کنید…' : (btn.dataset.label || (state.authMode === 'register' ? 'ثبت‌نام' : 'ورود'));
      if (!busy && state.authMode === 'register') btn.textContent = 'ثبت‌نام';
      if (!busy && state.authMode === 'login') btn.textContent = 'ورود';
    }
    const cont = $('#authContinueNoEmail');
    if (cont) cont.disabled = !!busy;
  }

  function hideRateLimitActions() {
    state.pendingAuth = null;
    $('#authRateLimitActions')?.classList.add('hidden');
  }

  function showRateLimitActions(email, password) {
    state.pendingAuth = { email, password };
    $('#authRateLimitActions')?.classList.remove('hidden');
  }

  function openAuth(mode) {
    state.authMode = mode || 'login';
    const reg = state.authMode === 'register';
    if ($('#authTitle')) $('#authTitle').textContent = reg ? 'ثبت‌نام' : 'ورود';
    if ($('#authSubmit')) {
      $('#authSubmit').textContent = reg ? 'ثبت‌نام' : 'ورود';
      $('#authSubmit').dataset.label = reg ? 'ثبت‌نام' : 'ورود';
    }
    if ($('#authToggle')) $('#authToggle').textContent = reg ? 'قبلاً ثبت‌نام کرده‌اید؟ ورود' : 'حساب ندارید؟ ثبت‌نام';
    if ($('#groupUsername')) $('#groupUsername').style.display = reg ? 'block' : 'none';
    if ($('#groupDisplayName')) $('#groupDisplayName').style.display = reg ? 'block' : 'none';
    hideRateLimitActions();
    showMsg($('#authMsg'), '', 'info');
    setAuthBusy(false);
    $('#authOverlay')?.classList.add('open');
  }
  function closeAuth() {
    hideRateLimitActions();
    setAuthBusy(false);
    $('#authOverlay')?.classList.remove('open');
  }

  async function handleAuth(e) {
    e.preventDefault();
    if (!sb) { showMsg($('#authMsg'), 'Supabase پیکربندی نشده است.', 'error'); return; }
    if (state.authBusy) return;

    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const username = ($('#authUsername')?.value || '').trim();
    const displayName = ($('#authDisplayName')?.value || '').trim();
    hideRateLimitActions();

    setAuthBusy(true);
    try {
      if (state.authMode === 'register') {
        if (!/^[a-zA-Z0-9_\.]{3,50}$/.test(username)) {
          showMsg($('#authMsg'), 'نام کاربری باید ۳ تا ۵۰ کاراکتر انگلیسی، عدد، _ یا . باشد.', 'error');
          return;
        }
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: { username, display_name: displayName || username },
            emailRedirectTo: location.origin + location.pathname
          }
        });

        if (error) {
          if (isEmailRateLimitError(error)) {
            showMsg(
              $('#authMsg'),
              'ارسال ایمیل تأیید موقتاً ممکن نیست (محدودیت نرخ ارسال). حساب ممکن است ساخته شده باشد. می‌توانید کمی صبر کنید یا «ادامه بدون تأیید ایمیل» را بزنید تا در صورت مجاز بودن تنظیمات، وارد شوید. ایمیل به‌صورت خودکار تأیید نمی‌شود.',
              'error'
            );
            showRateLimitActions(email, password);
            return;
          }
          if (/already|registered|exists/i.test(error.message)) {
            throw new Error('این ایمیل قبلاً ثبت شده است.');
          }
          throw error;
        }

        // Account created in Auth (and profile via trigger). Do not invent verification.
        if (data.user) {
          try {
            await sb.from('profiles').update({
              username,
              display_name: displayName || username
            }).eq('id', data.user.id);
          } catch (_) { /* profile may already be set; non-fatal */ }
        }

        if (data.session) {
          // Confirm email disabled or already confirmed — real session
          showMsg($('#authMsg'), 'ثبت‌نام موفق بود. در حال ورود…', 'ok');
          closeAuth();
          await refreshSession();
        } else if (data.user) {
          showMsg(
            $('#authMsg'),
            'ثبت‌نام انجام شد. لطفاً ایمیل خود را برای تأیید حساب بررسی کنید. تا قبل از تأیید، وضعیت ایمیل «تأییدنشده» است.',
            'ok'
          );
        } else {
          showMsg($('#authMsg'), 'پاسخ ثبت‌نام نامشخص بود. اگر ایمیلی نیامد، بعداً دوباره تلاش کنید.', 'error');
        }
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          if (isEmailNotConfirmedError(error)) {
            throw new Error('ایمیل شما هنوز تأیید نشده است. صندوق ورودی (و پوشه اسپم) را بررسی کنید. تا تأیید ایمیل، ورود ممکن نیست مگر Confirm email در Supabase خاموش باشد.');
          }
          if (isEmailRateLimitError(error)) {
            throw new Error('محدودیت ارسال ایمیل فعال است. کمی بعد دوباره تلاش کنید.');
          }
          if (/invalid login|invalid credentials|wrong password/i.test(error.message || '')) {
            throw new Error('ایمیل یا رمز عبور نادرست است.');
          }
          throw error;
        }
        if (!data || !data.session) {
          throw new Error('ورود انجام نشد (نشست ساخته نشد). اگر تازه ثبت‌نام کرده‌اید، ابتدا ایمیل را تأیید کنید.');
        }
        // Session exists — finish UI even if profile load is slow
        state.user = data.session.user;
        state.profile = state.profile || profileFromUser(data.session.user);
        showMsg($('#authMsg'), 'ورود موفق بود.', 'ok');
        closeAuth();
        setAuthBusy(false);
        try {
          await refreshSession();
        } catch (re) {
          console.warn(re);
          updateAuthUI();
        }
        try { switchView('profile'); } catch (_) {}
      }
    } catch (err) {
      let m = err.message || 'خطا';
      if (/duplicate|unique|username/i.test(m)) m = 'این نام کاربری قبلاً گرفته شده است.';
      if (/already|registered/i.test(m) && !/تأیید/.test(m)) m = 'این ایمیل قبلاً ثبت شده است.';
      if (/invalid login|invalid credentials|wrong password/i.test(m)) m = 'ایمیل یا رمز عبور نادرست است.';
      showMsg($('#authMsg'), m, 'error');
    } finally {
      setAuthBusy(false);
    }
  }

  /** After rate-limit on signup: try sign-in without claiming email is verified */
  async function handleContinueWithoutEmailVerify() {
    if (!sb || !state.pendingAuth || state.authBusy) return;
    const { email, password } = state.pendingAuth;
    setAuthBusy(true);
    showMsg($('#authMsg'), 'در حال تلاش برای ورود…', 'info');
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        if (isEmailNotConfirmedError(error)) {
          showMsg(
            $('#authMsg'),
            'ورود ممکن نیست: در پروژه Supabase تأیید ایمیل اجباری است و ایمیل تأیید به‌خاطر محدودیت نرخ ارسال نشد. صبر کنید تا محدودیت رفع شود، یا مالک پروژه «Confirm email» را در Authentication تنظیم کند. وضعیت ایمیل شما به‌صورت دستی تأیید نشده است.',
            'error'
          );
          return;
        }
        if (isEmailRateLimitError(error)) {
          showMsg($('#authMsg'), 'هنوز محدودیت ارسال ایمیل فعال است. لطفاً بعداً تلاش کنید.', 'error');
          return;
        }
        if (/invalid login|invalid credentials/i.test(error.message)) {
          showMsg(
            $('#authMsg'),
            'ورود ناموفق بود. ممکن است حساب ساخته نشده باشد. پس از رفع محدودیت، دوباره ثبت‌نام کنید.',
            'error'
          );
          return;
        }
        throw error;
      }
      if (!data.session) {
        showMsg($('#authMsg'), 'نشست فعالی ایجاد نشد.', 'error');
        return;
      }
      // Session exists — email may still be unconfirmed if project allows it
      const confirmed = isEmailConfirmed(data.session.user);
      showMsg(
        $('#authMsg'),
        confirmed
          ? 'ورود موفق بود.'
          : 'وارد شدید. توجه: ایمیل شما هنوز توسط Supabase تأیید نشده است.',
        'ok'
      );
      hideRateLimitActions();
      closeAuth();
      await refreshSession();
    } catch (err) {
      showMsg($('#authMsg'), err.message || 'خطا در ورود', 'error');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    if (sb) await sb.auth.signOut();
    state.user = null; state.profile = null; state.isOwner = false; state.isStaff = false;
    updateAuthUI();
  }

  async function handleRecover(e) {
    e.preventDefault();
    if (!sb) return;
    const email = $('#recoverEmail').value.trim();
    const redirectTo = location.origin + location.pathname;
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      showMsg($('#recoverMsg'), 'اگر حسابی با این ایمیل باشد، لینک بازیابی ارسال شد.', 'ok');
    } catch (err) {
      showMsg($('#recoverMsg'), err.message || 'خطا', 'error');
    }
  }

  async function handleNewPass(e) {
    e.preventDefault();
    if (!sb) return;
    const password = $('#newPassword').value;
    try {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      showMsg($('#recoverMsg'), 'رمز عبور به‌روز شد.', 'ok');
      $('#newPassForm')?.classList.add('hidden');
    } catch (err) {
      showMsg($('#recoverMsg'), err.message || 'خطا', 'error');
    }
  }

  // ---------- Upload / submit ----------
  function formatBytesMB(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return (n / 1024).toFixed(2);
    return (n / (1024 * 1024)).toFixed(2);
  }

  function setFileSizeHint(inputId, hintId) {
    const input = $(inputId);
    const hint = $(hintId);
    if (!input || !hint) return;
    const f = input.files && input.files[0];
    if (!f) { hint.textContent = ''; return; }
    hint.textContent = `حجم انتخاب‌شده: ${formatBytesMB(f.size)} مگابایت (${f.name})`;
  }

  function showUploadPanel(show) {
    const panel = document.getElementById('uploadProgressPanel');
    if (!panel) return;
    if (show) {
      panel.classList.remove('hidden');
      panel.classList.add('is-visible');
      panel.style.display = 'flex';
    } else {
      panel.classList.add('hidden');
      panel.classList.remove('is-visible');
      panel.style.display = 'none';
    }
  }

  function resetUploadProgressUI() {
    showUploadPanel(false);
    ['Cover', 'Audio'].forEach(kind => {
      const wrap = document.getElementById('uploadProg' + kind + 'Wrap');
      const bar = document.getElementById('uploadProg' + kind + 'Bar');
      const pct = document.getElementById('uploadProg' + kind + 'Pct');
      const bytes = document.getElementById('uploadProg' + kind + 'Bytes');
      if (wrap) { wrap.style.display = 'none'; wrap.classList.add('hidden'); }
      if (bar) {
        bar.style.width = '0%';
        bar.classList.remove('indeterminate');
      }
      if (pct) pct.textContent = '0%';
      if (bytes) bytes.textContent = '0.00 از 0.00 مگابایت';
    });
  }

  function updateUploadProgress(kind, loaded, total, extraLabel) {
    showUploadPanel(true);
    const wrap = document.getElementById('uploadProg' + kind + 'Wrap');
    const bar = document.getElementById('uploadProg' + kind + 'Bar');
    const pctEl = document.getElementById('uploadProg' + kind + 'Pct');
    const bytesEl = document.getElementById('uploadProg' + kind + 'Bytes');
    if (wrap) {
      wrap.classList.remove('hidden');
      wrap.style.display = 'block';
    }
    const tot = total > 0 ? total : 1;
    const ld = Math.max(0, Math.min(loaded, tot));
    const percent = Math.min(100, Math.round((ld / tot) * 100));
    if (bar) {
      bar.classList.remove('indeterminate');
      bar.style.width = percent + '%';
    }
    if (pctEl) pctEl.textContent = percent + '%';
    if (bytesEl) {
      const label = extraLabel ? (' · ' + extraLabel) : '';
      bytesEl.textContent = formatBytesMB(ld) + ' از ' + formatBytesMB(total) + ' مگابایت' + label;
    }
  }

  function setIndeterminate(kind, total) {
    showUploadPanel(true);
    const wrap = document.getElementById('uploadProg' + kind + 'Wrap');
    const bar = document.getElementById('uploadProg' + kind + 'Bar');
    const pctEl = document.getElementById('uploadProg' + kind + 'Pct');
    const bytesEl = document.getElementById('uploadProg' + kind + 'Bytes');
    if (wrap) { wrap.classList.remove('hidden'); wrap.style.display = 'block'; }
    if (bar) {
      bar.classList.add('indeterminate');
      bar.style.width = '40%';
    }
    if (pctEl) pctEl.textContent = '…';
    if (bytesEl) bytesEl.textContent = 'در حال ارسال · حجم کل ' + formatBytesMB(total) + ' مگابایت';
  }

  /**
   * Upload with progress via XHR.
   * Some browsers only fire progress at the end; we also run a gentle estimate
   * until the first real progress event, then switch to real numbers.
   */
  async function uploadWithProgress(bucket, path, file, contentType, onProgress) {
    const base = (window.MEGA_CONFIG && window.MEGA_CONFIG.supabaseUrl || '').replace(/\/$/, '');
    const anon = window.MEGA_CONFIG && window.MEGA_CONFIG.supabaseAnonKey;
    if (!base || !anon) throw new Error('پیکربندی Supabase ناقص است.');

    const { data: sessData, error: sessErr } = await sb.auth.getSession();
    if (sessErr) throw sessErr;
    const token = sessData && sessData.session && sessData.session.access_token;
    if (!token) throw new Error('نشست معتبر نیست. دوباره وارد شوید.');

    // Path as-is with encoded segments (Supabase Storage REST)
    const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
    const url = base + '/storage/v1/object/' + encodeURIComponent(bucket) + '/' + encodedPath;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let gotRealProgress = false;
      let finished = false;
      const startedAt = Date.now();
      // Rough estimate ~400 KB/s so bar moves even without browser events
      const estBps = 400 * 1024;

      const tick = setInterval(() => {
        if (finished || gotRealProgress) return;
        const elapsed = (Date.now() - startedAt) / 1000;
        const estLoaded = Math.min(file.size * 0.92, elapsed * estBps);
        if (typeof onProgress === 'function') {
          onProgress({ loaded: estLoaded, total: file.size, percent: Math.round((estLoaded / file.size) * 100), estimated: true });
        }
      }, 250);

      xhr.open('POST', url, true);
      xhr.responseType = 'text';
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('apikey', anon);
      xhr.setRequestHeader('x-upsert', 'false');
      // Let browser set Content-Type from Blob when possible — still set mime
      const mime = contentType || file.type || 'application/octet-stream';
      xhr.setRequestHeader('Content-Type', mime);
      xhr.setRequestHeader('cache-control', 'max-age=3600');

      if (typeof onProgress === 'function') {
        onProgress({ loaded: 0, total: file.size, percent: 0 });
      }

      xhr.upload.onloadstart = function () {
        if (!gotRealProgress && typeof onProgress === 'function') {
          onProgress({ loaded: 0, total: file.size, percent: 0 });
        }
      };

      xhr.upload.onprogress = function (e) {
        gotRealProgress = true;
        if (typeof onProgress === 'function') {
          const total = (e.lengthComputable && e.total) ? e.total : file.size;
          const loaded = e.loaded || 0;
          onProgress({
            loaded: loaded,
            total: total,
            percent: total ? Math.round((loaded / total) * 100) : 0,
            estimated: false
          });
        }
      };

      xhr.upload.onload = function () {
        gotRealProgress = true;
        if (typeof onProgress === 'function') {
          onProgress({ loaded: file.size, total: file.size, percent: 100 });
        }
      };

      xhr.onload = function () {
        finished = true;
        clearInterval(tick);
        if (xhr.status >= 200 && xhr.status < 300) {
          if (typeof onProgress === 'function') {
            onProgress({ loaded: file.size, total: file.size, percent: 100 });
          }
          try {
            resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
          } catch (err) {
            resolve({});
          }
        } else {
          let msg = 'آپلود ناموفق (' + xhr.status + ')';
          try {
            const j = JSON.parse(xhr.responseText || '{}');
            msg = j.message || j.error || j.msg || msg;
          } catch (err2) {
            if (xhr.responseText) msg = String(xhr.responseText).slice(0, 240);
          }
          reject(new Error(msg));
        }
      };

      xhr.onerror = function () {
        finished = true;
        clearInterval(tick);
        reject(new Error('خطای شبکه هنگام آپلود'));
      };
      xhr.onabort = function () {
        finished = true;
        clearInterval(tick);
        reject(new Error('آپلود لغو شد'));
      };

      try {
        xhr.send(file);
      } catch (sendErr) {
        finished = true;
        clearInterval(tick);
        reject(sendErr);
      }
    });
  }

  function validateFiles(audioFile, coverFile) {
    if (!audioFile) return 'فایل صوتی الزامی است.';
    if (audioFile.size > MAX_AUDIO) return 'حجم صوت حداکثر ۳۰ مگابایت است.';
    const aOk = AUDIO_OK.includes((audioFile.type || '').toLowerCase()) || /\.(mp3|wav|ogg|webm)$/i.test(audioFile.name);
    if (!aOk) return 'فرمت صوت مجاز: MP3، WAV، OGG.';
    if (coverFile) {
      if (coverFile.size > MAX_COVER) return 'حجم کاور حداکثر ۵ مگابایت است.';
      const cOk = COVER_OK.includes((coverFile.type || '').toLowerCase()) || /\.(jpe?g|png|webp)$/i.test(coverFile.name);
      if (!cOk) return 'فرمت کاور: JPEG، PNG، WebP.';
    }
    return null;
  }

  async function removePath(bucket, path) {
    if (!sb || !path) return;
    try { await sb.storage.from(bucket).remove([path]); } catch (e) { console.warn('cleanup', e); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!sb || !state.user) { showMsg($('#submitMsg'), 'ابتدا وارد شوید.', 'error'); return; }
    if (state.profile?.is_banned) { showMsg($('#submitMsg'), 'حساب شما محدود است.', 'error'); return; }

    const title = $('#subTitle').value.trim();
    const artist = $('#subArtist').value.trim();
    const album = $('#subAlbum').value.trim();
    const tags = ($('#subTags').value || '').split(/[,،]/).map(s => s.trim()).filter(Boolean);
    const language = $('#subLang').value;
    const lyrics = $('#subLyrics').value.trim();
    const coverFile = $('#subCover').files[0];
    const audioFile = $('#subAudio').files[0];
    if (!title || !artist) { showMsg($('#submitMsg'), 'عنوان و هنرمند الزامی است.', 'error'); return; }
    const fe = validateFiles(audioFile, coverFile);
    if (fe) { showMsg($('#submitMsg'), fe, 'error'); return; }

    const btn = $('#btnDoSubmit');
    if (btn) btn.disabled = true;
    resetUploadProgressUI();
    showUploadPanel(true);
    showMsg($('#submitMsg'), 'در حال بارگذاری فایل‌ها…', 'info');
    // Force panel paint before network work
    try { document.getElementById('uploadProgressPanel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {}

    const uid = state.user.id;
    const ts = Date.now();
    let coverPath = null, audioPath = null, inserted = false;
    try {
      let coverUrl = null;
      if (coverFile) {
        const safe = coverFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
        coverPath = `${uid}/${ts}-c-${safe}`;
        updateUploadProgress('Cover', 0, coverFile.size);
        await uploadWithProgress(
          'covers',
          coverPath,
          coverFile,
          coverFile.type || 'image/jpeg',
          ({ loaded, total }) => updateUploadProgress('Cover', loaded, total)
        );
        coverUrl = sb.storage.from('covers').getPublicUrl(coverPath).data.publicUrl;
      } else {
        $('#uploadProgCoverWrap')?.classList.add('hidden');
      }
      const safeA = audioFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      audioPath = `${uid}/${ts}-a-${safeA}`;
      updateUploadProgress('Audio', 0, audioFile.size);
      showMsg($('#submitMsg'), 'در حال آپلود فایل صوتی…', 'info');
      await uploadWithProgress(
        'audio',
        audioPath,
        audioFile,
        audioFile.type || 'audio/mpeg',
        ({ loaded, total }) => updateUploadProgress('Audio', loaded, total)
      );
      const audioUrl = sb.storage.from('audio').getPublicUrl(audioPath).data.publicUrl;
      showMsg($('#submitMsg'), 'در حال ثبت اطلاعات آهنگ…', 'info');

      const autoPub = !!(state.profile && state.profile.is_verified && state.profile.can_auto_publish);
      const status = (state.isOwner || autoPub) ? 'published' : 'pending';

      const { data: insertedRow, error: iErr } = await sb.from('tracks').insert({
        title, artist_name: artist, album: album || null, cover_url: coverUrl,
        audio_url: audioUrl, tags, language, lyrics: lyrics || null,
        is_downloadable: false, status, uploaded_by: uid
      }).select('id').single();
      if (iErr) throw iErr;
      inserted = true;
      const newTrackId = insertedRow && insertedRow.id;
      if (targetPlaylistId && newTrackId) {
        const { error: plErr } = await sb.from('playlist_items').insert({
          playlist_id: targetPlaylistId,
          track_id: newTrackId,
          position: Date.now()
        });
        if (plErr && !/duplicate|unique/i.test(plErr.message || '')) {
          console.warn('playlist link', plErr);
        }
      }
      updateUploadProgress('Audio', audioFile.size, audioFile.size);
      const linked = !!(targetPlaylistId && newTrackId);
      showMsg(
        $('#submitMsg'),
        status === 'published'
          ? (linked ? 'آهنگ منتشر شد و به پلی‌لیست اضافه شد.' : 'آهنگ منتشر شد.')
          : (linked ? 'ارسال شد، در انتظار بررسی است و به پلی‌لیست اضافه شد.' : 'ارسال شد و در انتظار بررسی است.'),
        'ok'
      );
      const linkedPl = targetPlaylistId;
      targetPlaylistId = null;
      await new Promise(r => setTimeout(r, 600));
      $('#submitForm').reset();
      setFileSizeHint('#subCover', '#subCoverSize');
      setFileSizeHint('#subAudio', '#subAudioSize');
      $('#submitOverlay')?.classList.remove('open');
      if (status === 'published') await loadCatalog();
      if (linkedPl) await openPlaylistDetail(linkedPl);
    } catch (err) {
      if (!inserted) {
        if (audioPath) await removePath('audio', audioPath);
        if (coverPath) await removePath('covers', coverPath);
      }
      let m = err.message || 'خطا در ارسال';
      if (/row-level security|policy/i.test(m)) m = 'مجوز ارسال ندارید یا حساب محدود است.';
      showMsg($('#submitMsg'), m, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---------- Profile edit ----------
  async function handleEditProfile(e) {
    e.preventDefault();
    if (!sb || !state.user) return;
    const username = $('#epUsername').value.trim();
    const display_name = $('#epDisplayName').value.trim();
    const bio = $('#epBio').value.trim();
    const avatarFile = $('#epAvatar').files[0];
    try {
      if (username && !/^[a-zA-Z0-9_\.]{3,50}$/.test(username)) {
        showMsg($('#editProfileMsg'), 'نام کاربری نامعتبر است.', 'error'); return;
      }
      let avatar_url = state.profile?.avatar_url || null;
      if (avatarFile) {
        if (avatarFile.size > MAX_COVER) throw new Error('حجم تصویر زیاد است.');
        const path = `${state.user.id}/avatar-${Date.now()}`;
        const { error } = await sb.storage.from('covers').upload(path, avatarFile, { upsert: true });
        if (error) throw error;
        avatar_url = sb.storage.from('covers').getPublicUrl(path).data.publicUrl;
      }
      const { error } = await sb.from('profiles').update({
        username: username || state.profile.username,
        display_name: display_name || state.profile.display_name,
        bio, avatar_url
      }).eq('id', state.user.id);
      if (error) {
        if (/unique|duplicate/i.test(error.message)) throw new Error('این نام کاربری قبلاً گرفته شده است.');
        throw error;
      }
      showMsg($('#editProfileMsg'), 'ذخیره شد.', 'ok');
      await refreshSession();
    } catch (err) {
      showMsg($('#editProfileMsg'), err.message || 'خطا', 'error');
    }
  }

  // ---------- User profile view ----------
  async function openUserProfile(uid) {
    if (!sb || !uid) return;
    state.viewingUserId = uid;
    switchView('profile');
    const box = $('#userProfileContent');
    box.innerHTML = '<div class="spinner"></div>';
    const { data: p } = await sb.from('profiles')
      .select('id, username, display_name, avatar_url, bio, is_verified, role, created_at')
      .eq('id', uid).maybeSingle();
    if (!p) { box.innerHTML = '<p class="msg msg-error">کاربر یافت نشد.</p>'; return; }
    const [{ count: followers }, { count: following }, { data: tracks }] = await Promise.all([
      sb.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', uid),
      sb.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', uid),
      sb.from('tracks').select('id, title, artist_name, cover_url, audio_url, status').eq('uploaded_by', uid).eq('status', 'published').limit(50)
    ]);
    let isFollowing = false;
    if (state.user && state.user.id !== uid) {
      const { data: f } = await sb.from('follows').select('follower_id').eq('follower_id', state.user.id).eq('following_id', uid).maybeSingle();
      isFollowing = !!f;
    }
    const badge = (p.is_verified || p.role === 'owner') ? verifiedBadge() : '';
    const followBtn = state.user && state.user.id !== uid
      ? `<button type="button" class="btn btn-primary btn-sm" id="btnFollow" data-uid="${escapeHtml(uid)}">${isFollowing ? 'لغو دنبال' : 'دنبال کردن'}</button>`
      : '';
    box.innerHTML = `
      <div class="profile-header">
        <img class="profile-avatar" src="${escapeHtml(p.avatar_url || '')}" alt="">
        <div class="profile-name">${escapeHtml(p.display_name || p.username || '')} ${badge}</div>
        <div class="profile-handle">@${escapeHtml(p.username || '—')}</div>
        <div class="profile-bio">${escapeHtml(p.bio || '')}</div>
        <div class="profile-stats">
          <div class="profile-stat"><strong>${tracks?.length || 0}</strong><span>آهنگ</span></div>
          <div class="profile-stat"><strong>${followers || 0}</strong><span>دنبال‌کننده</span></div>
          <div class="profile-stat"><strong>${following || 0}</strong><span>دنبال‌شونده</span></div>
        </div>
        ${followBtn}
      </div>
      <h3>آهنگ‌های منتشرشده</h3>
      <div id="profileTracks" class="track-list"></div>`;
    const mapped = (tracks || []).map(mapTrack);
    mapped.forEach(t => { if (!state.queue.find(x => x.id === t.id)) state.queue.push(t); });
    renderTracks(mapped, $('#profileTracks'), null);
    $('#btnFollow')?.addEventListener('click', async () => {
      if (!state.user) { openAuth('login'); return; }
      try {
        if (isFollowing) {
          await sb.from('follows').delete().eq('follower_id', state.user.id).eq('following_id', uid);
        } else {
          await sb.from('follows').insert({ follower_id: state.user.id, following_id: uid });
        }
        openUserProfile(uid);
      } catch (err) { alert(err.message || 'خطا'); }
    });
  }

  // ---------- Playlists ----------
  // ---------- Playlists (redesigned) ----------
  let pendingAddTrackId = null;
  let currentPlaylistId = null;
  let currentPlaylistMeta = null;
  let targetPlaylistId = null;

  function openPlaylistCreate() {
    if (!state.user) { openAuth('login'); return; }
    const hint = $('#plVisibilityHint');
    if (hint) {
      hint.textContent = state.isOwner
        ? 'پلی‌لیست شما به‌صورت عمومی نمایش داده می‌شود.'
        : 'پلی‌لیست شما خصوصی است و فقط خودتان می‌بینید.';
    }
    $('#playlistCreateOverlay')?.classList.add('open');
    $('#plTitle')?.focus();
  }

  function closePlaylistCreate() {
    $('#playlistCreateOverlay')?.classList.remove('open');
    const f = $('#playlistCreateForm');
    if (f) f.reset();
    if ($('#plEditId')) $('#plEditId').value = '';
    if ($('#playlistFormTitle')) $('#playlistFormTitle').textContent = 'ساخت پلی‌لیست';
    if ($('#plFormSubmitBtn')) $('#plFormSubmitBtn').textContent = 'ایجاد';
    showMsg($('#plCreateMsg'), '', 'info');
  }

  function closePlaylistPick() {
    $('#playlistPickOverlay')?.classList.remove('open');
    pendingAddTrackId = null;
  }

  async function loadPlaylists() {
    const box = $('#playlistsPanel');
    const empty = $('#playlistsEmpty');
    const listWrap = $('#playlistsListWrap');
    const detail = $('#playlistDetailWrap');
    if (listWrap) listWrap.classList.remove('hidden');
    if (detail) detail.classList.add('hidden');
    if (!box) return;
    if (!sb) {
      box.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    box.innerHTML = '<div class="spinner"></div>';
    let q = sb.from('playlists')
      .select('id, title, description, cover_url, is_public, is_official, user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(60);
    // RLS already filters; client request still asks public + own when logged in
    const { data, error } = await q;
    if (error) {
      box.innerHTML = '';
      empty?.classList.remove('hidden');
      console.warn(error);
      return;
    }
    const rows = data || [];
    if (!rows.length) {
      box.innerHTML = '';
      empty?.classList.remove('hidden');
    } else {
      empty?.classList.add('hidden');
      box.innerHTML = rows.map(function (pl) {
        const cover = pl.cover_url
          ? '<img class="pl-card-cover" src="' + escapeHtml(pl.cover_url) + '" alt="" loading="lazy">'
          : '<div class="pl-card-cover pl-card-cover-ph">♪</div>';
        const badges = [];
        if (pl.is_official) badges.push('<span class="status-pill status-published">رسمی</span>');
        if (pl.is_public) badges.push('<span class="status-pill status-published">عمومی</span>');
        else badges.push('<span class="status-pill status-pending">خصوصی</span>');
        return '<button type="button" class="pl-card" data-open-pl="' + escapeHtml(pl.id) + '">' +
          cover +
          '<div class="pl-card-body">' +
          '<div class="pl-card-title">' + escapeHtml(pl.title) + '</div>' +
          '<div class="pl-card-desc">' + escapeHtml(pl.description || '') + '</div>' +
          '<div class="pl-card-badges">' + badges.join(' ') + '</div>' +
          '</div></button>';
      }).join('');
    }
    const btn = $('#btnCreatePlaylist');
    if (btn) btn.style.display = state.user ? 'inline-flex' : 'none';
  }

  async function openPlaylistDetail(pid) {
    if (!sb || !pid) return;
    currentPlaylistId = pid;
    const listWrap = $('#playlistsListWrap');
    const detail = $('#playlistDetailWrap');
    const hero = $('#playlistDetailHero');
    const tracksBox = $('#playlistDetailTracks');
    const empty = $('#playlistDetailEmpty');
    if (listWrap) listWrap.classList.add('hidden');
    if (detail) detail.classList.remove('hidden');
    if (hero) hero.innerHTML = '<div class="spinner"></div>';
    if (tracksBox) tracksBox.innerHTML = '';

    const { data: pl } = await sb.from('playlists')
      .select('id, title, description, cover_url, is_public, is_official, user_id')
      .eq('id', pid).maybeSingle();
    if (!pl) {
      currentPlaylistMeta = null;
      if (hero) hero.innerHTML = '<p class="msg msg-error">پلی‌لیست یافت نشد.</p>';
      return;
    }
    currentPlaylistMeta = pl;
    const isMine = !!(state.user && pl.user_id === state.user.id);
    const canManage = isMine || state.isOwner;

    ['#btnPlaylistAddTrack', '#btnPlaylistEdit', '#btnPlaylistDelete'].forEach(function (sel) {
      const el = $(sel);
      if (!el) return;
      el.classList.toggle('hidden', !canManage);
    });

    const cover = pl.cover_url
      ? '<img src="' + escapeHtml(pl.cover_url) + '" alt="">'
      : '<div class="pl-detail-ph">♪</div>';
    if (hero) {
      hero.innerHTML =
        '<div class="pl-detail-cover">' + cover + '</div>' +
        '<div class="pl-detail-meta">' +
        '<h2>' + escapeHtml(pl.title) + '</h2>' +
        '<p>' + escapeHtml(pl.description || '') + '</p>' +
        '<div>' + (pl.is_official ? '<span class="status-pill status-published">رسمی</span> ' : '') +
        (pl.is_public ? '<span class="status-pill status-published">عمومی</span>' : '<span class="status-pill status-pending">خصوصی</span>') +
        '</div></div>';
    }

    const { data: items } = await sb.from('playlist_items')
      .select('track_id, position, tracks(id, title, artist_name, album, cover_url, audio_url, duration_seconds, tags, lyrics, status, uploaded_by)')
      .eq('playlist_id', pid)
      .order('position', { ascending: true });

    const tracks = (items || [])
      .map(function (i) { return i.tracks; })
      .filter(function (t) { return t && (t.status === 'published' || state.isStaff || (state.user && t.uploaded_by === state.user.id)); })
      .map(mapTrack);

    state._playlistTracks = tracks;
    if (!tracks.length) {
      if (tracksBox) tracksBox.innerHTML = '';
      empty?.classList.remove('hidden');
    } else {
      empty?.classList.add('hidden');
      renderTracks(tracks, tracksBox, empty);
    }
  }

  function openPlaylistEdit() {
    if (!currentPlaylistMeta) return;
    const pl = currentPlaylistMeta;
    const isMine = state.user && pl.user_id === state.user.id;
    if (!isMine && !state.isOwner) return;
    $('#plEditId').value = pl.id;
    $('#plTitle').value = pl.title || '';
    $('#plDesc').value = pl.description || '';
    $('#plCover').value = '';
    $('#playlistFormTitle').textContent = 'ویرایش پلی‌لیست';
    $('#plFormSubmitBtn').textContent = 'ذخیره تغییرات';
    const hint = $('#plVisibilityHint');
    if (hint) {
      hint.textContent = pl.is_public
        ? 'این پلی‌لیست عمومی است.'
        : 'این پلی‌لیست خصوصی است.';
    }
    $('#playlistCreateOverlay')?.classList.add('open');
  }

  async function deleteCurrentPlaylist() {
    if (!sb || !currentPlaylistMeta || !state.user) return;
    const pl = currentPlaylistMeta;
    if (pl.user_id !== state.user.id && !state.isOwner) return;
    if (!confirm('پلی‌لیست «' + (pl.title || '') + '» حذف شود؟ آهنگ‌های سایت پاک نمی‌شوند؛ فقط از این پلی‌لیست جدا می‌شوند.')) return;
    const { error } = await sb.from('playlists').delete().eq('id', pl.id);
    if (error) { alert(error.message); return; }
    currentPlaylistId = null;
    currentPlaylistMeta = null;
    await loadPlaylists();
  }

  function openPlaylistTrackUpload() {
    if (!state.user) { openAuth('login'); return; }
    if (!currentPlaylistMeta) return;
    const pl = currentPlaylistMeta;
    if (pl.user_id !== state.user.id && !state.isOwner) return;
    targetPlaylistId = pl.id;
    const hint = $('#submitHint');
    if (hint) {
      hint.textContent = 'این آهنگ با همان فرایند آپلود سایت ارسال می‌شود و به پلی‌لیست «' + (pl.title || '') + '» اضافه خواهد شد.';
    }
    $('#submitOverlay')?.classList.add('open');
  }

  async function playPlaylist(pid) {
    if (!sb) return;
    if (state._playlistTracks && currentPlaylistId === pid && state._playlistTracks.length) {
      state.queue = state._playlistTracks.slice();
      loadTrack(0, true);
      return;
    }
    await openPlaylistDetail(pid);
    if (state._playlistTracks && state._playlistTracks.length) {
      state.queue = state._playlistTracks.slice();
      loadTrack(0, true);
    } else {
      alert('این پلی‌لیست خالی است یا آهنگ قابل پخش ندارد.');
    }
  }

  async function createPlaylistFromForm(e) {
    if (e) e.preventDefault();
    if (!sb || !state.user) { openAuth('login'); return; }
    const editId = ($('#plEditId')?.value || '').trim();
    const title = ($('#plTitle')?.value || '').trim();
    const description = ($('#plDesc')?.value || '').trim();
    const file = $('#plCover')?.files && $('#plCover').files[0];
    if (!title) {
      showMsg($('#plCreateMsg'), 'نام پلی‌لیست لازم است.', 'error');
      return;
    }
    showMsg($('#plCreateMsg'), editId ? 'در حال ذخیره…' : 'در حال ایجاد…', 'info');
    try {
      let cover_url = null;
      if (file) {
        if (file.size > 5 * 1024 * 1024) throw new Error('حجم کاور حداکثر ۵ مگابایت');
        const ok = /image\/(jpeg|png|webp|gif)/i.test(file.type) || /\.(jpe?g|png|webp|gif)$/i.test(file.name);
        if (!ok) throw new Error('فرمت کاور نامعتبر است');
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
        const path = state.user.id + '/playlists/' + Date.now() + '-' + safe;
        await uploadWithProgress('covers', path, file, file.type || 'image/jpeg', null);
        cover_url = sb.storage.from('covers').getPublicUrl(path).data.publicUrl;
      }
      if (editId) {
        const patch = { title: title, description: description || null };
        if (cover_url) patch.cover_url = cover_url;
        const { error } = await sb.from('playlists').update(patch).eq('id', editId);
        if (error) throw error;
        showMsg($('#plCreateMsg'), 'ذخیره شد.', 'ok');
        closePlaylistCreate();
        await openPlaylistDetail(editId);
      } else {
        const isOwner = !!state.isOwner;
        const { error } = await sb.from('playlists').insert({
          user_id: state.user.id,
          title: title,
          description: description || null,
          cover_url: cover_url,
          is_public: isOwner,
          is_official: isOwner
        });
        if (error) throw error;
        showMsg($('#plCreateMsg'), 'ساخته شد.', 'ok');
        closePlaylistCreate();
        await loadPlaylists();
      }
    } catch (err) {
      showMsg($('#plCreateMsg'), err.message || 'خطا', 'error');
    }
  }

  async function createPlaylist() {
    openPlaylistCreate();
  }

  async function addToPlaylist(trackId) {
    if (!sb || !state.user) { openAuth('login'); return; }
    pendingAddTrackId = trackId;
    const { data: pls } = await sb.from('playlists').select('id, title, cover_url, is_public').eq('user_id', state.user.id).order('created_at', { ascending: false });
    const list = $('#playlistPickList');
    if (!pls || !pls.length) {
      if (list) list.innerHTML = '<p class="msg msg-info">پلی‌لیستی ندارید.</p>';
      $('#playlistPickOverlay')?.classList.add('open');
      return;
    }
    if (list) {
      list.innerHTML = pls.map(function (p) {
        return '<button type="button" class="pl-pick-item" data-pick-pl="' + escapeHtml(p.id) + '">' +
          (p.cover_url ? '<img src="' + escapeHtml(p.cover_url) + '" alt="">' : '<span class="pl-pick-ph">♪</span>') +
          '<span>' + escapeHtml(p.title) + '</span></button>';
      }).join('');
    }
    $('#playlistPickOverlay')?.classList.add('open');
  }

  async function addTrackToPlaylist(playlistId, trackId) {
    if (!sb || !state.user || !playlistId || !trackId) return;
    const { error } = await sb.from('playlist_items').insert({
      playlist_id: playlistId,
      track_id: trackId,
      position: Date.now()
    });
    if (error) {
      alert(/duplicate|unique/i.test(error.message) ? 'این آهنگ قبلاً در پلی‌لیست است.' : error.message);
      return;
    }
    closePlaylistPick();
    if (currentPlaylistId === playlistId) openPlaylistDetail(playlistId);
  }

  // ---------- Admin ----------

  // ---------- Admin ----------
  async function loadAdmin(tab) {
    const box = $('#adminContent');
    if (!box || !state.isStaff || !sb) return;
    box.innerHTML = '<div class="spinner"></div>';
    try {
      if (tab === 'overview') {
        const [users, tracks, pending, playlists, verifiedBadge] = await Promise.all([
          sb.from('profiles').select('*', { count: 'exact', head: true }),
          sb.from('tracks').select('*', { count: 'exact', head: true }).eq('status', 'published'),
          sb.from('tracks').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          sb.from('playlists').select('*', { count: 'exact', head: true }),
          sb.from('profiles').select('*', { count: 'exact', head: true }).eq('is_verified', true)
        ]);
        // Total registered = rows in profiles (includes email-unconfirmed Auth users once profile exists).
        // is_verified is platform badge, NOT Supabase email_confirmed_at.
        box.innerHTML = `<div class="stat-grid">
          <div class="stat-card"><div class="val">${users.count ?? '—'}</div><div class="lbl">کل ثبت‌نام‌ها</div></div>
          <div class="stat-card"><div class="val">${verifiedBadge.count ?? '—'}</div><div class="lbl">نشان تأیید پلتفرم</div></div>
          <div class="stat-card"><div class="val">${tracks.count ?? '—'}</div><div class="lbl">منتشرشده</div></div>
          <div class="stat-card"><div class="val">${pending.count ?? '—'}</div><div class="lbl">در انتظار</div></div>
          <div class="stat-card"><div class="val">${playlists.count ?? '—'}</div><div class="lbl">پلی‌لیست</div></div>
        </div>
        <p class="msg msg-info">«کل ثبت‌نام‌ها» از جدول profiles است و به وضعیت تأیید ایمیل وابسته نیست. «نشان تأیید» با تأیید ایمیل یکی نیست.</p>`;
      } else if (tab === 'pending') {
        if (!state.isStaff) {
          box.innerHTML = '<p class="msg msg-error">دسترسی فقط برای مدیر/مالک.</p>';
          return;
        }
        const { data, error } = await sb.from('tracks')
          .select(`
            id, title, artist_name, album, cover_url, audio_url, duration_seconds,
            tags, language, lyrics, is_downloadable, status, moderation_note,
            uploaded_by, created_at, updated_at, reviewed_by, reviewed_at
          `)
          .in('status', ['pending', 'in_review', 'needs_changes'])
          .order('created_at', { ascending: true })
          .limit(50);
        if (error) {
          box.innerHTML = `<p class="msg msg-error">${escapeHtml(error.message)}</p>`;
          return;
        }
        if (!data?.length) {
          box.innerHTML = '<p class="msg msg-info">موردی در انتظار نیست.</p>';
          return;
        }
        // Resolve uploader display names (staff can read profiles)
        const uploaderIds = [...new Set(data.map(x => x.uploaded_by).filter(Boolean))];
        let uploaderMap = {};
        if (uploaderIds.length) {
          const { data: ups } = await sb.from('profiles')
            .select('id, username, display_name')
            .in('id', uploaderIds);
          (ups || []).forEach(u => { uploaderMap[u.id] = u; });
        }
        state.adminPendingTracks = data;
        box.innerHTML = `<div class="admin-list admin-pending-list">${data.map(tr => {
          const up = uploaderMap[tr.uploaded_by] || {};
          const tags = Array.isArray(tr.tags) ? tr.tags.join('، ') : (tr.tags || '');
          const dur = tr.duration_seconds ? formatTime(tr.duration_seconds) : '—';
          const cover = tr.cover_url
            ? `<img class="admin-pending-cover" src="${escapeHtml(tr.cover_url)}" alt="" loading="lazy">`
            : `<div class="admin-pending-cover admin-pending-cover--empty"></div>`;
          const lyricsPreview = (tr.lyrics || '').trim()
            ? `<details class="admin-pending-lyrics"><summary>متن آهنگ</summary><pre>${escapeHtml(tr.lyrics)}</pre></details>`
            : '<p class="admin-pending-meta">متن آهنگ ثبت نشده</p>';
          return `<article class="admin-item admin-pending-card" data-tid="${escapeHtml(tr.id)}">
            <div class="admin-pending-top">
              ${cover}
              <div class="admin-pending-main">
                <strong class="admin-pending-title">${escapeHtml(tr.title)}</strong>
                <div class="admin-pending-artist">${escapeHtml(tr.artist_name || '—')}</div>
                <span class="status-pill status-pending">${STATUS_FA[tr.status] || tr.status}</span>
              </div>
            </div>
            <dl class="admin-pending-dl">
              <div><dt>آلبوم</dt><dd>${escapeHtml(tr.album || '—')}</dd></div>
              <div><dt>مدت</dt><dd>${escapeHtml(dur)}</dd></div>
              <div><dt>زبان</dt><dd>${escapeHtml(tr.language || '—')}</dd></div>
              <div><dt>برچسب‌ها</dt><dd>${escapeHtml(tags || '—')}</dd></div>
              <div><dt>ارسال‌کننده</dt><dd>${escapeHtml(up.display_name || up.username || tr.uploaded_by || '—')}${up.username ? ' · @' + escapeHtml(up.username) : ''}</dd></div>
              <div><dt>تاریخ ارسال</dt><dd>${escapeHtml(tr.created_at ? new Date(tr.created_at).toLocaleString('fa-IR') : '—')}</dd></div>
              <div><dt>قابل دانلود</dt><dd>${tr.is_downloadable ? 'بله' : 'خیر'}</dd></div>
              <div><dt>یادداشت قبلی</dt><dd>${escapeHtml(tr.moderation_note || '—')}</dd></div>
            </dl>
            ${lyricsPreview}
            <div class="actions admin-pending-actions">
              <button type="button" class="btn btn-primary btn-sm" data-preview-play="${escapeHtml(tr.id)}">▶ پخش پیش‌نمایش</button>
              <button type="button" class="btn btn-primary btn-sm" data-mod="publish" data-id="${escapeHtml(tr.id)}">انتشار</button>
              <button type="button" class="btn btn-ghost btn-sm" data-mod="reject" data-id="${escapeHtml(tr.id)}">رد</button>
              <button type="button" class="btn btn-ghost btn-sm" data-mod="needs" data-id="${escapeHtml(tr.id)}">نیاز به اصلاح</button>
            </div>
          </article>`;
        }).join('')}</div>
        <p class="msg msg-info">پیش‌نمایش فقط برای مدیر/مالک است و آهنگ را در کاتالوگ عمومی منتشر نمی‌کند.</p>`;
      } else if (tab === 'users') {
        let { data, error: uErr } = await sb.from('profiles')
          .select('id, username, display_name, role, is_verified, is_banned, can_auto_publish, created_at')
          .order('created_at', { ascending: false }).limit(40);
        if (uErr && /can_auto_publish|column/i.test(uErr.message || '')) {
          const fb = await sb.from('profiles')
            .select('id, username, display_name, role, is_verified, is_banned, created_at')
            .order('created_at', { ascending: false }).limit(40);
          data = (fb.data || []).map(u => ({ ...u, can_auto_publish: false }));
        }
        box.innerHTML = `<div class="admin-list">${(data || []).map(u => `
          <div class="admin-item">
            <strong>${escapeHtml(u.display_name || u.username || '')}</strong>
            @${escapeHtml(u.username || '—')} · ${escapeHtml(u.role)}
            ${u.is_verified ? verifiedBadge() : ''}
            ${u.can_auto_publish ? '<span class="status-pill status-published">انتشار خودکار</span>' : ''}
            ${u.is_banned ? '<span class="status-pill status-rejected">مسدود</span>' : ''}
            <div class="actions">
              ${state.isOwner && u.role !== 'owner' ? `<button type="button" class="btn btn-ghost btn-sm" data-ban="${u.id}" data-banned="${u.is_banned}">${u.is_banned ? 'رفع مسدودیت' : 'مسدود'}</button>` : ''}
              ${state.isOwner && u.role !== 'owner' ? `<button type="button" class="btn btn-ghost btn-sm" data-verify="${u.id}" data-v="${u.is_verified}">${u.is_verified ? 'لغو تأیید' : 'تأیید'}</button>` : ''}
              ${state.isOwner && u.role !== 'owner' && u.is_verified ? `<button type="button" class="btn btn-ghost btn-sm" data-autopub="${u.id}" data-ap="${u.can_auto_publish ? 'true' : 'false'}">${u.can_auto_publish ? 'خاموش کردن انتشار خودکار' : 'فعال‌سازی انتشار بدون بررسی'}</button>` : ''}
            </div>
          </div>`).join('')}</div>`;
      } else if (tab === 'contacts') {
        await loadAdminContacts(box);
      } else if (tab === 'ads') {
        await loadAdminAds(box);
      } else if (tab === 'tracks') {
        const { data } = await sb.from('tracks')
          .select('id, title, artist_name, status, created_at')
          .order('created_at', { ascending: false }).limit(40);
        box.innerHTML = `<div class="admin-list">${(data || []).map(t => `
          <div class="admin-item">
            <strong>${escapeHtml(t.title)}</strong> — ${escapeHtml(t.artist_name)}
            <span class="status-pill status-${t.status === 'published' ? 'published' : t.status === 'rejected' ? 'rejected' : 'pending'}">${STATUS_FA[t.status] || t.status}</span>
            <div class="actions">
              ${t.status === 'published' ? `<button type="button" class="btn btn-danger btn-sm" data-mod="remove" data-id="${t.id}">حذف از انتشار</button>` : ''}
              ${t.status !== 'published' ? `<button type="button" class="btn btn-primary btn-sm" data-mod="publish" data-id="${t.id}">انتشار</button>` : ''}
            </div>
          </div>`).join('')}</div>`;
      }
    } catch (e) {
      box.innerHTML = `<p class="msg msg-error">${escapeHtml(e.message || 'خطا در بارگذاری پنل')}</p>`;
    }
  }

  async function moderateTrack(id, status) {
    if (!sb || !state.isStaff) return;
    const note = status === 'rejected' || status === 'needs_changes' ? (prompt('یادداشت (اختیاری):') || null) : null;
    const { error } = await sb.from('tracks').update({
      status,
      moderation_note: note,
      reviewed_by: state.user.id,
      reviewed_at: new Date().toISOString()
    }).eq('id', id);
    if (error) alert(error.message);
    else {
      try {
        await sb.from('audit_logs').insert({
          actor_id: state.user.id, action: 'moderate_track', entity: 'tracks', entity_id: id,
          meta: { status, note }
        });
      } catch (_) {}
      await loadCatalog();
      loadAdmin('pending');
    }
  }

  async function toggleBan(uid, currentlyBanned) {
    if (!sb || !state.isStaff) return;
    if (currentlyBanned === 'true' || currentlyBanned === true) {
      await sb.from('profiles').update({ is_banned: false, banned_until: null, ban_reason: null }).eq('id', uid);
    } else {
      const reason = prompt('دلیل مسدودیت:') || 'تخلف';
      await sb.from('profiles').update({ is_banned: true, ban_reason: reason, banned_until: null }).eq('id', uid);
    }
    loadAdmin('users');
  }

  async function toggleVerify(uid, currently) {
    if (!sb || !state.isOwner) return;
    const v = !(currently === 'true' || currently === true);
    const patch = { is_verified: v };
    if (!v) patch.can_auto_publish = false;
    const { error } = await sb.from('profiles').update(patch).eq('id', uid);
    if (error) alert(error.message); else loadAdmin('users');
  }

  async function toggleAutoPublish(uid, currently) {
    if (!sb || !state.isOwner) return;
    const on = !(currently === 'true' || currently === true);
    const { error } = await sb.from('profiles').update({ can_auto_publish: on }).eq('id', uid);
    if (error) {
      alert(error.message || 'فقط برای کاربران دارای تیک آبی قابل تنظیم است.');
      return;
    }
    loadAdmin('users');
  }

  async function toggleLike() {
    if (!sb || !state.user) { openAuth('login'); return; }
    const t = state.queue[state.currentIndex];
    if (!t) return;
    if (state.likedIds.has(t.id)) {
      await sb.from('likes').delete().eq('user_id', state.user.id).eq('track_id', t.id);
      state.likedIds.delete(t.id);
    } else {
      await sb.from('likes').insert({ user_id: state.user.id, track_id: t.id });
      state.likedIds.add(t.id);
    }
    if ($('#fpLike')) $('#fpLike').textContent = state.likedIds.has(t.id) ? 'پسندیده‌شده' : 'پسندیدن';
  }

  // ---------- Navigation ----------

  // ---------- Contact page ----------
  const CONTACT_ICON_OPTIONS = [
    { id: 'bale', label: 'بله' },
    { id: 'telegram', label: 'تلگرام' },
    { id: 'link', label: 'لینک' },
    { id: 'heart', label: 'قلب' },
    { id: 'user', label: 'کاربر' }
  ];

  function contactIconId(icon) {
    return String(icon || 'link').replace(/^icon-/, '').replace(/[^a-z0-9_-]/gi, '') || 'link';
  }

  function isSafeHttpsContact(url) {
    try {
      const u = new URL(String(url || ''));
      return u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  async function fetchContactLinks() {
    if (sb) {
      try {
        const { data, error } = await sb.from('contact_links')
          .select('id, name, href, icon, sort_order, is_active')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .limit(40);
        if (!error && data) return data;
      } catch (e) {
        console.warn('contact_links', e);
      }
    }
    // Silent fallback (no user-facing setup instructions)
    const fallback = (cfg.contactLinks && Array.isArray(cfg.contactLinks)) ? cfg.contactLinks : [];
    return fallback.map(function (item, i) {
      return {
        id: 'local-' + i,
        name: item.name,
        href: item.href,
        icon: item.icon || 'link',
        sort_order: i,
        is_active: true
      };
    });
  }

  function contactCardHtml(item, i) {
    const href = String(item.href || '').trim();
    const name = escapeHtml(item.name || '');
    const icon = contactIconId(item.icon);
    if (!isSafeHttpsContact(href) || !name) return '';
    const delay = (0.05 * (i || 0)).toFixed(2);
    return '<a class="contact-card" role="listitem" href="' + escapeHtml(href) +
      '" target="_blank" rel="noopener noreferrer" style="animation-delay:' + delay + 's">' +
      '<span class="contact-icon-wrap"><svg class="contact-icon" aria-hidden="true"><use href="icons.svg#icon-' +
      escapeHtml(icon) + '"></use></svg></span>' +
      '<span class="contact-name">' + name + '</span></a>';
  }

  async function renderContactLinks() {
    const grid = $('#contactLinksGrid');
    if (!grid) return;
    const links = await fetchContactLinks();
    const html = (links || []).map(contactCardHtml).filter(Boolean).join('');
    grid.innerHTML = html || '';
  }

  async function loadAdminContacts(box) {
    if (!state.isOwner) {
      box.innerHTML = '<p class="msg msg-error">فقط مالک.</p>';
      return;
    }
    let rows = [];
    let tableMissing = false;
    const { data, error } = await sb.from('contact_links')
      .select('id, name, href, icon, sort_order, is_active, created_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      tableMissing = true;
      box.innerHTML = '<p class="msg msg-error">جدول راه‌های ارتباطی آماده نیست. در Supabase فایل migration-004-contact-links.sql را اجرا کنید.<br>' +
        escapeHtml(error.message) + '</p>';
      return;
    }
    rows = data || [];
    const iconOpts = CONTACT_ICON_OPTIONS.map(function (o) {
      return '<option value="' + o.id + '">' + o.label + ' (' + o.id + ')</option>';
    }).join('');
    const list = rows.map(function (r) {
      return '<div class="admin-item">' +
        '<strong>' + escapeHtml(r.name) + '</strong> ' +
        (r.is_active ? '<span class="status-pill status-published">فعال</span>' : '<span class="status-pill status-pending">خاموش</span>') +
        '<div style="font-size:0.75rem;color:var(--text-dim);margin-top:4px;word-break:break-all">' +
        '<svg width="14" height="14" style="vertical-align:middle"><use href="icons.svg#icon-' + escapeHtml(contactIconId(r.icon)) + '"></use></svg> ' +
        escapeHtml(r.icon) + ' · ' + escapeHtml(r.href) +
        '</div><div class="actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-contact-toggle="' + escapeHtml(r.id) + '" data-on="' + (r.is_active ? 'true' : 'false') + '">' +
        (r.is_active ? 'خاموش' : 'روشن') + '</button>' +
        '<button type="button" class="btn btn-danger btn-sm" data-contact-del="' + escapeHtml(r.id) + '">حذف</button>' +
        '</div></div>';
    }).join('') || '<p class="msg msg-info">هنوز لینکی ثبت نشده.</p>';

    box.innerHTML =
      '<div class="msg msg-info" style="font-size:0.8rem;line-height:1.6">' +
      '<strong>راهنمای مالک:</strong> نام زیر آیکون نمایش داده می‌شود. فقط آدرس‌های HTTPS مجازند. ' +
      'آیکون را از لیست انتخاب کنید (bale، telegram، link، …). پس از ذخیره، در صفحه «ارتباط» برای همه دیده می‌شود.' +
      '</div>' +
      '<form id="contactCreateForm" style="margin-top:12px">' +
      '<div class="form-group"><label>نام (زیر آیکون)</label><input id="clName" required maxlength="40" placeholder="مثلاً بله"></div>' +
      '<div class="form-group"><label>آدرس HTTPS</label><input id="clHref" type="url" required placeholder="https://..."></div>' +
      '<div class="form-group"><label>آیکون SVG</label><select id="clIcon">' + iconOpts + '</select></div>' +
      '<div class="form-group"><label>ترتیب</label><input id="clSort" type="number" value="0"></div>' +
      '<div id="clMsg"></div>' +
      '<button type="submit" class="btn btn-primary">افزودن راه ارتباطی</button>' +
      '</form>' +
      '<div class="admin-list" style="margin-top:14px">' + list + '</div>';

    $('#contactCreateForm')?.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!state.isOwner) return;
      const name = ($('#clName').value || '').trim();
      const href = ($('#clHref').value || '').trim();
      const icon = contactIconId($('#clIcon').value);
      const sort_order = Number($('#clSort').value) || 0;
      if (!name) { showMsg($('#clMsg'), 'نام لازم است.', 'error'); return; }
      if (!isSafeHttpsContact(href)) { showMsg($('#clMsg'), 'فقط لینک HTTPS معتبر.', 'error'); return; }
      const { error: insErr } = await sb.from('contact_links').insert({
        name: name,
        href: href,
        icon: icon,
        sort_order: sort_order,
        is_active: true,
        created_by: state.user.id
      });
      if (insErr) showMsg($('#clMsg'), insErr.message, 'error');
      else {
        showMsg($('#clMsg'), 'اضافه شد.', 'ok');
        loadAdmin('contacts');
        renderContactLinks();
      }
    });
  }

  function updateEqualizer(playing) {
    const eq = $('#fpEqualizer');
    if (!eq) return;
    eq.classList.toggle('playing', !!playing);
  }

  function switchView(name) {
    const next = $('#view-' + name);
    if (!next) return;
    const current = document.querySelector('.view.active');
    if (current === next) {
      next.classList.remove('view-anim-in');
      void next.offsetWidth;
      next.classList.add('view-anim-in');
      return;
    }
    $$('.view').forEach(function (v) {
      v.classList.remove('active', 'view-anim-in');
    });
    next.classList.add('active', 'view-anim-in');
    $$('.nav-item').forEach(function (n) {
      n.classList.toggle('active', n.dataset.view === name);
    });
    if (name === 'playlists') loadPlaylists();
    if (name === 'contact') renderContactLinks();
    if (name === 'home') {
      try {
        renderTracks(state.filtered && state.filtered.length ? state.filtered : state.tracks);
      } catch (e) {}
    }
  }

  // ---------- Recovery hash handling ----------
  function checkRecoverySession() {
    const hash = location.hash || '';
    if (hash.includes('type=recovery') || hash.includes('type=signup')) {
      $('#recoverOverlay')?.classList.add('open');
      $('#recoverForm')?.classList.add('hidden');
      $('#newPassForm')?.classList.remove('hidden');
    }
  }

  // ---------- Events ----------
  function bind() {
    $('#searchInput')?.addEventListener('input', e => {
      const q = e.target.value;
      if ($('#searchInput2')) $('#searchInput2').value = q;
      debouncedSearch(q, ($('#homeCats .cat-chip.active') && $('#homeCats .cat-chip.active').dataset.cat) || 'tracks');
    });
    $('#searchInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSearch(e.target.value, ($('#homeCats .cat-chip.active') && $('#homeCats .cat-chip.active').dataset.cat) || 'tracks');
      }
    });
    $('#searchInput2')?.addEventListener('input', e => {
      const q = e.target.value;
      if ($('#searchInput')) $('#searchInput').value = q;
      debouncedSearch(q, ($('#searchCats .cat-chip.active') && $('#searchCats .cat-chip.active').dataset.cat) || 'all');
    });
    $('#searchInput2')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSearch(e.target.value, ($('#searchCats .cat-chip.active') && $('#searchCats .cat-chip.active').dataset.cat) || 'all');
      }
    });
    $$('#homeCats .cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.parentElement.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        runSearch(($('#searchInput') && $('#searchInput').value) || '', chip.dataset.cat);
      });
    });
    $$('#searchCats .cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.parentElement.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        runSearch(($('#searchInput2') && $('#searchInput2').value) || '', chip.dataset.cat);
      });
    });

    document.addEventListener('click', e => {
      const row = e.target.closest('.track-row');
      if (row && row.dataset.id) {
        const id = row.dataset.id;
        let idx = state.queue.findIndex(t => String(t.id) === String(id));
        if (idx < 0) {
          const t = state.filtered.find(x => String(x.id) === String(id)) || state.tracks.find(x => String(x.id) === String(id));
          if (t) { state.queue.push(t); idx = state.queue.length - 1; }
        }
        if (idx < 0) return;
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'add') { addToPlaylist(id); return; }
        if (state.currentIndex === idx && state.isPlaying) togglePlay();
        else loadTrack(idx, true);
        return;
      }
      const userRow = e.target.closest('[data-kind="user"]');
      if (userRow?.dataset.uid) { openUserProfile(userRow.dataset.uid); return; }
      const cDel = e.target.closest('[data-contact-del]');
      if (cDel) {
        if (!state.isOwner) return;
        if (!confirm('حذف این راه ارتباطی؟')) return;
        sb.from('contact_links').delete().eq('id', cDel.getAttribute('data-contact-del')).then(({ error }) => {
          if (error) alert(error.message);
          else { loadAdmin('contacts'); renderContactLinks(); }
        });
        return;
      }
      const cTog = e.target.closest('[data-contact-toggle]');
      if (cTog) {
        if (!state.isOwner) return;
        const on = cTog.getAttribute('data-on') === 'true';
        sb.from('contact_links').update({ is_active: !on, updated_at: new Date().toISOString() })
          .eq('id', cTog.getAttribute('data-contact-toggle')).then(({ error }) => {
          if (error) alert(error.message);
          else { loadAdmin('contacts'); renderContactLinks(); }
        });
        return;
      }
      const adClick = e.target.closest('[data-ad-click]');
      if (adClick) {
        recordAdEvent(adClick.getAttribute('data-ad-click'), 'click');
      }
      const adDel = e.target.closest('[data-ad-del]');
      if (adDel) {
        if (!state.isOwner) return;
        if (!confirm('حذف این کمپین؟')) return;
        sb.from('ad_campaigns').delete().eq('id', adDel.getAttribute('data-ad-del')).then(({ error }) => {
          if (error) alert(error.message); else loadAdmin('ads');
        });
        return;
      }
      const adSt = e.target.closest('[data-ad-status]');
      if (adSt) {
        if (!state.isOwner) return;
        sb.from('ad_campaigns').update({ status: adSt.getAttribute('data-to'), updated_at: new Date().toISOString() }).eq('id', adSt.getAttribute('data-ad-status')).then(({ error }) => {
          if (error) alert(error.message); else loadAdmin('ads');
        });
        return;
      }
      const prevPlay = e.target.closest('[data-preview-play]');
      if (prevPlay) {
        const id = prevPlay.getAttribute('data-preview-play');
        const raw = (state.adminPendingTracks || []).find(x => String(x.id) === String(id));
        if (raw) playPreviewTrack(raw);
        else {
          const el = document.createElement('div');
          el.className = 'msg msg-error';
          el.textContent = 'آهنگ برای پیش‌نمایش پیدا نشد.';
          $('#adminContent')?.prepend(el);
        }
        return;
      }
      const mod = e.target.closest('[data-mod]');
      if (mod) { moderateTrack(mod.dataset.id, mod.dataset.mod === 'publish' ? 'published' : mod.dataset.mod === 'reject' ? 'rejected' : mod.dataset.mod === 'remove' ? 'removed' : 'needs_changes'); return; }
      const ban = e.target.closest('[data-ban]');
      if (ban) { toggleBan(ban.dataset.ban, ban.dataset.banned); return; }
      const ver = e.target.closest('[data-verify]');
      if (ver) { toggleVerify(ver.dataset.verify, ver.dataset.v); return; }
      const ap = e.target.closest('[data-autopub]');
      if (ap) { toggleAutoPublish(ap.dataset.autopub, ap.dataset.ap); return; }
      const openPl = e.target.closest('[data-open-pl]');
      if (openPl) {
        openPlaylistDetail(openPl.getAttribute('data-open-pl'));
        return;
      }
      const pickPl = e.target.closest('[data-pick-pl]');
      if (pickPl) {
        addTrackToPlaylist(pickPl.getAttribute('data-pick-pl'), pendingAddTrackId);
        return;
      }
      const pl = e.target.closest('[data-play-pl]');
      if (pl) { playPlaylist(pl.dataset.playPl); return; }
    });

    $('#btnPlay')?.addEventListener('click', togglePlay);
    $('#btnNext')?.addEventListener('click', playNext);
    $('#btnPrev')?.addEventListener('click', playPrev);
    $('#fpPlay')?.addEventListener('click', togglePlay);
    $('#fpNext')?.addEventListener('click', playNext);
    $('#fpPrev')?.addEventListener('click', playPrev);
    $('#fpShuffle')?.addEventListener('click', () => { state.shuffle = !state.shuffle; updatePlayerUI(); });
    $('#fpRepeat')?.addEventListener('click', () => { state.repeat = (state.repeat + 1) % 3; updatePlayerUI(); });
    $('#fpMinimize')?.addEventListener('click', closeFullPlayer);
    $('#fpClose')?.addEventListener('click', () => { closeFullPlayer(); audio().pause(); state.isPlaying = false; updatePlayerUI(); });
    $('#miniMetaClick')?.addEventListener('click', openFullPlayer);
    $('#fpLike')?.addEventListener('click', toggleLike);
    $('#fpLyricsBtn')?.addEventListener('click', () => $('#fpLyrics')?.classList.toggle('hidden'));
    $('#fpAddPl')?.addEventListener('click', () => {
      const t = state.queue[state.currentIndex]; if (t) addToPlaylist(t.id);
    });
    $('#fpSeek')?.addEventListener('input', () => {
      const a = audio(); if (!a.duration) return;
      a.currentTime = (Number($('#fpSeek').value) / 1000) * a.duration;
    });
    $('#fpVolume')?.addEventListener('input', () => {
      state.volume = Number($('#fpVolume').value) / 100;
      audio().volume = state.volume;
    });

    const a = audio();
    a.addEventListener('timeupdate', () => {
      if (!a.duration) return;
      const pct = (a.currentTime / a.duration) * 100;
      if ($('#miniProgressBar')) $('#miniProgressBar').style.width = pct + '%';
      if ($('#fpSeek')) $('#fpSeek').value = Math.floor((a.currentTime / a.duration) * 1000);
      if ($('#fpElapsed')) $('#fpElapsed').textContent = formatTime(a.currentTime);
      if ($('#fpDuration')) $('#fpDuration').textContent = formatTime(a.duration);
    });
    a.addEventListener('ended', () => {
      if (state.repeat === 2) loadTrack(state.currentIndex, true);
      else playNext();
    });
    a.addEventListener('play', () => { state.isPlaying = true; updateEqualizer(true); updatePlayerUI(); });
    a.addEventListener('pause', () => { state.isPlaying = false; updateEqualizer(false); updatePlayerUI(); });
    a.volume = state.volume;

    $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    $('#btnAuth')?.addEventListener('click', () => state.user ? switchView('more') : openAuth('login'));
    $('#btnLoginOpen')?.addEventListener('click', () => openAuth('login'));
    $('#btnForgotOpen')?.addEventListener('click', () => { $('#recoverOverlay')?.classList.add('open'); });
    $('#authClose')?.addEventListener('click', closeAuth);
    $('#authToggle')?.addEventListener('click', () => openAuth(state.authMode === 'login' ? 'register' : 'login'));
    $('#authForm')?.addEventListener('submit', handleAuth);
    $('#authContinueNoEmail')?.addEventListener('click', handleContinueWithoutEmailVerify);
    $('#btnLogout')?.addEventListener('click', handleLogout);
    $('#submitForm')?.addEventListener('submit', handleSubmit);
    $('#subCover')?.addEventListener('change', () => setFileSizeHint('#subCover', '#subCoverSize'));
    $('#subAudio')?.addEventListener('change', () => setFileSizeHint('#subAudio', '#subAudioSize'));
    $('#btnSubmitOpen')?.addEventListener('click', () => {
      targetPlaylistId = null;
      if (!state.user) openAuth('login');
      else $('#submitOverlay')?.classList.add('open');
    });
    $('#btnSubmitTrack')?.addEventListener('click', () => { targetPlaylistId = null; $('#submitOverlay')?.classList.add('open'); });
    $('#submitClose')?.addEventListener('click', () => { targetPlaylistId = null; $('#submitOverlay')?.classList.remove('open'); });
    $('#btnEditProfile')?.addEventListener('click', () => {
      if (!state.profile) return;
      $('#epUsername').value = state.profile.username || '';
      $('#epDisplayName').value = state.profile.display_name || '';
      $('#epBio').value = state.profile.bio || '';
      $('#editProfileOverlay')?.classList.add('open');
    });
    $('#editProfileClose')?.addEventListener('click', () => $('#editProfileOverlay')?.classList.remove('open'));
    $('#editProfileForm')?.addEventListener('submit', handleEditProfile);
    $('#recoverClose')?.addEventListener('click', () => $('#recoverOverlay')?.classList.remove('open'));
    $('#recoverForm')?.addEventListener('submit', handleRecover);
    $('#newPassForm')?.addEventListener('submit', handleNewPass);
    
    $('#btnCreatePlaylist')?.addEventListener('click', openPlaylistCreate);
    $('#playlistCreateClose')?.addEventListener('click', closePlaylistCreate);
    $('#playlistCreateForm')?.addEventListener('submit', createPlaylistFromForm);
    $('#playlistCreateOverlay')?.addEventListener('click', e => { if (e.target.id === 'playlistCreateOverlay') closePlaylistCreate(); });
    $('#btnPlaylistBack')?.addEventListener('click', () => loadPlaylists());
    $('#btnPlaylistPlayAll')?.addEventListener('click', () => { if (currentPlaylistId) playPlaylist(currentPlaylistId); });
    $('#btnPlaylistEdit')?.addEventListener('click', openPlaylistEdit);
    $('#btnPlaylistDelete')?.addEventListener('click', deleteCurrentPlaylist);
    $('#btnPlaylistAddTrack')?.addEventListener('click', openPlaylistTrackUpload);

    $('#playlistPickClose')?.addEventListener('click', closePlaylistPick);
    $('#playlistPickOverlay')?.addEventListener('click', e => { if (e.target.id === 'playlistPickOverlay') closePlaylistPick(); });
    $('#playlistPickNew')?.addEventListener('click', () => { closePlaylistPick(); openPlaylistCreate(); });

    $('#btnBackHome')?.addEventListener('click', () => switchView('home'));
    $('#btnMySubmissions')?.addEventListener('click', async () => {
      if (!sb || !state.user) return;
      const { data } = await sb.from('tracks').select('id, title, status, created_at').eq('uploaded_by', state.user.id).order('created_at', { ascending: false });
      alert((data || []).map(t => `${t.title}: ${STATUS_FA[t.status] || t.status}`).join('\n') || 'ارسالی ندارید.');
    });
    $$('#adminTabs button').forEach(b => b.addEventListener('click', () => {
      $$('#adminTabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      loadAdmin(b.dataset.tab);
    }));

    if (sb) sb.auth.onAuthStateChange(() => refreshSession());
  }


  // ---------- Home discovery (real data only) ----------
  async function loadHomeDiscovery() {
    if (!sb) return;
    const strip = $('#verifiedArtistsStrip');
    const section = $('#verifiedArtistsSection');
    if (!strip || !section) return;
    const { data, error } = await sb.from('profiles')
      .select('id, username, display_name, avatar_url, is_verified, role')
      .eq('is_verified', true)
      .order('username', { ascending: true })
      .limit(24);
    if (error || !data || !data.length) {
      section.hidden = true;
      strip.innerHTML = '';
      return;
    }
    section.hidden = false;
    strip.innerHTML = data.map(u => {
      const name = escapeHtml(u.display_name || u.username || 'هنرمند');
      const art = u.avatar_url
        ? `<img src="${escapeHtml(u.avatar_url)}" alt="" loading="lazy" width="64" height="64">`
        : `<span class="artist-ph">♪</span>`;
      return `<button type="button" class="artist-chip" data-kind="user" data-uid="${escapeHtml(u.id)}" role="listitem">
        ${art}<div class="name">${name}</div></button>`;
    }).join('');
  }

  // ---------- Ads (public render + owner admin) ----------
  function isSafeHttpsUrl(url) {
    try {
      const u = new URL(String(url || ''));
      return u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async function loadPublicAds() {
    if (!sb) return;
    const placements = ['home_hero', 'home_secondary', 'catalog_top'];
    const slotMap = {
      home_hero: '#adSlotHomeHero',
      home_secondary: '#adSlotHomeSecondary',
      catalog_top: '#adSlotCatalogTop'
    };
    let rows = [];
    try {
      const { data, error } = await sb.from('ad_campaigns')
        .select('id, name, placement, image_url, destination_url, alt_text, priority, status, starts_at, ends_at')
        .eq('status', 'active')
        .order('priority', { ascending: false })
        .limit(30);
      if (error) {
        // table may not exist yet
        placements.forEach(pl => {
          const el = $(slotMap[pl]);
          if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
        });
        return;
      }
      const now = Date.now();
      rows = (data || []).filter(c => {
        if (!isSafeHttpsUrl(c.destination_url) || !c.image_url) return false;
        if (c.starts_at && new Date(c.starts_at).getTime() > now) return false;
        if (c.ends_at && new Date(c.ends_at).getTime() <= now) return false;
        return true;
      });
    } catch (e) {
      console.warn('ads', e);
      return;
    }
    placements.forEach(pl => {
      const el = $(slotMap[pl]);
      if (!el) return;
      const pick = rows.filter(r => r.placement === pl).sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
      if (!pick) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
      }
      el.classList.remove('hidden');
      el.innerHTML = `<span class="ad-label">تبلیغ</span>
        <a href="${escapeHtml(pick.destination_url)}" target="_blank" rel="noopener noreferrer sponsored"
           data-ad-click="${escapeHtml(pick.id)}">
          <img src="${escapeHtml(pick.image_url)}" alt="${escapeHtml(pick.alt_text || 'تبلیغ')}" loading="lazy">
        </a>`;
      recordAdEvent(pick.id, 'impression');
    });
  }

  async function recordAdEvent(campaignId, eventType) {
    if (!sb || !campaignId) return;
    if (eventType === 'impression') {
      if (state.adImpressionSent.has(campaignId)) return;
      state.adImpressionSent.add(campaignId);
    }
    try {
      await sb.from('ad_events').insert({ campaign_id: campaignId, event_type: eventType });
    } catch (e) {
      // ignore analytics failures — never invent counts
    }
  }

  async function loadAdminAds(box) {
    if (!state.isOwner) {
      box.innerHTML = '<p class="msg msg-error">فقط مالک.</p>';
      return;
    }
    const { data: campaigns, error } = await sb.from('ad_campaigns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) {
      box.innerHTML = `<p class="msg msg-error">جدول تبلیغات آماده نیست. migration-003-ads.sql را در Supabase اجرا کنید.<br>${escapeHtml(error.message)}</p>`;
      return;
    }
    // counts
    const ids = (campaigns || []).map(c => c.id);
    let counts = {};
    if (ids.length) {
      const { data: evs } = await sb.from('ad_events').select('campaign_id, event_type').in('campaign_id', ids);
      (evs || []).forEach(e => {
        const k = e.campaign_id;
        if (!counts[k]) counts[k] = { impression: 0, click: 0 };
        if (e.event_type === 'impression') counts[k].impression++;
        if (e.event_type === 'click') counts[k].click++;
      });
    }
    const list = (campaigns || []).map(c => {
      const ct = counts[c.id] || { impression: 0, click: 0 };
      const ctr = ct.impression > 0 ? ((ct.click / ct.impression) * 100).toFixed(1) + '%' : '—';
      return `<div class="admin-item">
        <strong>${escapeHtml(c.name)}</strong>
        <span class="status-pill status-${c.status === 'active' ? 'published' : 'pending'}">${escapeHtml(c.status)}</span>
        <div style="font-size:0.75rem;color:var(--text-dim);margin-top:4px">
          ${escapeHtml(c.placement)} · نمایش: ${ct.impression} · کلیک: ${ct.click} · CTR: ${ctr}
        </div>
        <div class="actions">
          <button type="button" class="btn btn-ghost btn-sm" data-ad-status="${escapeHtml(c.id)}" data-to="${c.status === 'active' ? 'paused' : 'active'}">${c.status === 'active' ? 'توقف' : 'فعال'}</button>
          <button type="button" class="btn btn-danger btn-sm" data-ad-del="${escapeHtml(c.id)}">حذف</button>
        </div>
      </div>`;
    }).join('') || '<p class="msg msg-info">هنوز کمپینی نیست.</p>';

    box.innerHTML = `
      <form id="adCreateForm" class="admin-ad-form">
        <p class="msg msg-info">کمپین جدید: تصویر را از گوشی/کامپیوتر انتخاب کنید (JPG، PNG، WebP یا GIF تا ۸ مگابایت). لینک مقصد باید HTTPS باشد.</p>
        <div class="form-group"><label>نام</label><input id="adName" required maxlength="120"></div>
        <div class="form-group"><label>جایگاه</label>
          <select id="adPlacement">
            <option value="home_hero">بنر اصلی خانه</option>
            <option value="home_secondary">بنر دوم خانه</option>
            <option value="catalog_top">بالای فهرست آهنگ‌ها</option>
          </select>
        </div>
        <div class="form-group">
          <label for="adImageFile">آپلود تصویر / گیف از دستگاه *</label>
          <input type="file" id="adImageFile" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif">
          <div class="file-size-hint" id="adImageFileHint"></div>
          <div id="adImagePreview" class="ad-image-preview hidden"></div>
        </div>
        <div class="form-group">
          <label for="adImage">یا آدرس تصویر آماده (اختیاری اگر فایل انتخاب شده)</label>
          <input id="adImage" type="url" placeholder="https://...">
        </div>
        <div class="form-group"><label>لینک مقصد (HTTPS) *</label><input id="adDest" type="url" required placeholder="https://..."></div>
        <div class="form-group"><label>متن جایگزین</label><input id="adAlt" maxlength="120" value="تبلیغ"></div>
        <div class="form-row-2">
          <div class="form-group"><label>شروع (اختیاری)</label><input id="adStart" type="datetime-local"></div>
          <div class="form-group"><label>پایان (اختیاری)</label><input id="adEnd" type="datetime-local"></div>
        </div>
        <div class="form-group"><label>اولویت</label><input id="adPriority" type="number" value="0"></div>
        <div id="adUploadMsg"></div>
        <button type="submit" class="btn btn-primary" id="adSubmitBtn">آپلود و فعال‌سازی</button>
      </form>
      <div class="admin-list" style="margin-top:14px">${list}</div>`;

    const fileInput = $('#adImageFile');
    fileInput?.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      const hint = $('#adImageFileHint');
      const prev = $('#adImagePreview');
      if (!f) {
        if (hint) hint.textContent = '';
        if (prev) { prev.classList.add('hidden'); prev.innerHTML = ''; }
        return;
      }
      if (hint) hint.textContent = `انتخاب‌شده: ${f.name} · ${(f.size / (1024 * 1024)).toFixed(2)} مگابایت`;
      if (prev) {
        const url = URL.createObjectURL(f);
        prev.classList.remove('hidden');
        prev.innerHTML = `<img src="${url}" alt="پیش‌نمایش" style="max-width:100%;max-height:140px;border-radius:12px;object-fit:cover">`;
      }
    });

    $('#adCreateForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.isOwner || !sb) return;
      const btn = $('#adSubmitBtn');
      const msg = $('#adUploadMsg');
      const name = $('#adName').value.trim();
      const placement = $('#adPlacement').value;
      const destination_url = $('#adDest').value.trim();
      const alt_text = ($('#adAlt').value || 'تبلیغ').trim();
      const priority = Number($('#adPriority').value) || 0;
      const starts_at = $('#adStart').value ? new Date($('#adStart').value).toISOString() : null;
      const ends_at = $('#adEnd').value ? new Date($('#adEnd').value).toISOString() : null;
      const file = fileInput && fileInput.files && fileInput.files[0];
      let image_url = ($('#adImage').value || '').trim();

      if (!isSafeHttpsUrl(destination_url)) {
        showMsg(msg, 'لینک مقصد باید HTTPS معتبر باشد.', 'error');
        return;
      }

      if (file) {
        const mime = (file.type || '').toLowerCase();
        const nameOk = /\.(jpe?g|png|webp|gif)$/i.test(file.name);
        if (!AD_IMAGE_OK.includes(mime) && !nameOk) {
          showMsg(msg, 'فرمت مجاز: JPG، PNG، WebP یا GIF.', 'error');
          return;
        }
        if (file.size > MAX_AD_IMAGE) {
          showMsg(msg, 'حجم تصویر حداکثر ۸ مگابایت است.', 'error');
          return;
        }
        if (btn) btn.disabled = true;
        showMsg(msg, 'در حال آپلود تصویر از دستگاه…', 'info');
        try {
          const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
          const path = `${state.user.id}/ads/${Date.now()}-${safe}`;
          const contentType = mime || (nameOk && file.name.toLowerCase().endsWith('.gif') ? 'image/gif' : 'image/jpeg');
          await uploadWithProgress('covers', path, file, contentType, null);
          image_url = sb.storage.from('covers').getPublicUrl(path).data.publicUrl;
        } catch (upErr) {
          showMsg(msg, upErr.message || 'آپلود تصویر ناموفق بود.', 'error');
          if (btn) btn.disabled = false;
          return;
        }
      }

      if (!image_url || !isSafeHttpsUrl(image_url)) {
        showMsg(msg, 'یک فایل از دستگاه انتخاب کنید یا آدرس HTTPS تصویر وارد کنید.', 'error');
        if (btn) btn.disabled = false;
        return;
      }

      if (btn) btn.disabled = true;
      showMsg(msg, 'در حال ثبت کمپین…', 'info');
      const { error } = await sb.from('ad_campaigns').insert({
        name, placement, image_url, destination_url, alt_text, priority,
        status: 'active', starts_at, ends_at, created_by: state.user.id
      });
      if (btn) btn.disabled = false;
      if (error) showMsg(msg, error.message, 'error');
      else {
        showMsg(msg, 'کمپین فعال شد.', 'ok');
        loadAdmin('ads');
        loadPublicAds();
      }
    });
  }


  function init() {
    if (!hasSupabase) $('#configBanner')?.classList.remove('hidden');
    setPlayerEnabled(false);
    bind();
    checkRecoverySession();
    loadCatalog();
    refreshSession();
    renderContactLinks();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
