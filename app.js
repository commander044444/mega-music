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
    likedIds: new Set()
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
  async function runSearch(q, cat) {
    const nq = normalize(q);
    const resultsBox = $('#searchResults') || $('#trackList');
    const emptyEl = $('#searchEmpty') || $('#emptyState');
    if (!nq) {
      if (cat === 'tracks' || cat === 'all') {
        state.filtered = [...state.tracks];
        renderTracks(state.filtered, resultsBox, emptyEl);
      } else {
        resultsBox.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
      }
      return;
    }
    if (!sb) {
      state.filtered = state.tracks.filter(t =>
        normalize(t.title).includes(nq) || normalize(t.artist).includes(nq) ||
        (t.tags || []).some(x => normalize(x).includes(nq)));
      renderTracks(state.filtered, resultsBox, emptyEl);
      return;
    }

    resultsBox.innerHTML = '<div class="spinner"></div>';
    const parts = [];
    try {
      if (cat === 'tracks' || cat === 'all') {
        const { data } = await sb.from('tracks')
          .select('id, title, artist_name, album, cover_url, audio_url, duration_seconds, tags, lyrics, status, uploaded_by')
          .eq('status', 'published')
          .or(`title.ilike.%${q.replace(/%/g, '')}%,artist_name.ilike.%${q.replace(/%/g, '')}%`)
          .limit(40);
        (data || []).forEach(t => parts.push({ type: 'track', data: mapTrack(t) }));
      }
      if (cat === 'users' || cat === 'all') {
        const { data } = await sb.from('profiles')
          .select('id, username, display_name, avatar_url, is_verified, role, bio')
          .or(`username.ilike.%${q.replace(/%/g, '')}%,display_name.ilike.%${q.replace(/%/g, '')}%`)
          .limit(30);
        (data || []).forEach(u => parts.push({ type: 'user', data: u }));
      }
      if (cat === 'playlists' || cat === 'all') {
        const { data } = await sb.from('playlists')
          .select('id, title, description, cover_url, is_public, is_official, user_id')
          .eq('is_public', true)
          .ilike('title', `%${q.replace(/%/g, '')}%`)
          .limit(20);
        (data || []).forEach(p => parts.push({ type: 'playlist', data: p }));
      }
    } catch (e) { console.warn('search', e); }

    if (!parts.length) {
      resultsBox.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    resultsBox.innerHTML = parts.map(p => {
      if (p.type === 'track') {
        const t = p.data;
        return `<article class="track-row" data-id="${escapeHtml(t.id)}" data-kind="track">
          <div class="row-actions"><button type="button" class="row-btn play" data-action="play"><svg><use href="icons.svg#icon-play"></use></svg></button></div>
          <div class="row-meta"><div class="row-title">${escapeHtml(t.title)}</div><div class="row-artist">${escapeHtml(t.artist)}</div></div>
          ${t.cover ? `<img class="row-art" src="${escapeHtml(t.cover)}" alt="" loading="lazy">` : '<div class="row-art"></div>'}
        </article>`;
      }
      if (p.type === 'user') {
        const u = p.data;
        const badge = u.is_verified || u.role === 'owner' ? verifiedBadge() : '';
        return `<div class="user-row" data-uid="${escapeHtml(u.id)}" data-kind="user">
          <img class="user-avatar" src="${escapeHtml(u.avatar_url || '')}" alt="" onerror="this.style.background='#1a1a1e'">
          <div class="user-meta"><div class="user-name">${escapeHtml(u.display_name || u.username || 'کاربر')} ${badge}</div>
          <div class="user-handle">@${escapeHtml(u.username || '—')}</div></div></div>`;
      }
      const pl = p.data;
      return `<div class="user-row" data-pid="${escapeHtml(pl.id)}" data-kind="playlist">
        <div class="user-avatar" style="border-radius:10px;display:grid;place-items:center;font-size:0.7rem">PL</div>
        <div class="user-meta"><div class="user-name">${escapeHtml(pl.title)}${pl.is_official ? ' · رسمی' : ''}</div>
        <div class="user-handle">${escapeHtml(pl.description || 'پلی‌لیست')}</div></div></div>`;
    }).join('');

    // keep track list in state for play from search
    const trackParts = parts.filter(p => p.type === 'track').map(p => p.data);
    if (trackParts.length) {
      state.filtered = trackParts;
      trackParts.forEach(t => {
        if (!state.queue.find(x => x.id === t.id)) state.queue.push(t);
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
  async function refreshSession() {
    if (!sb) { state.user = null; state.profile = null; state.isOwner = false; state.isStaff = false; updateAuthUI(); return; }
    const { data: { session } } = await sb.auth.getSession();
    state.user = session?.user || null;
    if (state.user) {
      const { data: profile } = await sb.from('profiles')
        .select('id, username, display_name, role, avatar_url, bio, is_verified, is_banned, banned_until')
        .eq('id', state.user.id).maybeSingle();
      state.profile = profile;
      state.isOwner = profile?.role === 'owner';
      state.isStaff = profile?.role === 'owner' || profile?.role === 'admin';
      await loadLikes();
    } else {
      state.profile = null; state.isOwner = false; state.isStaff = false;
    }
    updateAuthUI();
  }

  async function loadLikes() {
    state.likedIds = new Set();
    if (!sb || !state.user) return;
    const { data } = await sb.from('likes').select('track_id').eq('user_id', state.user.id);
    (data || []).forEach(r => state.likedIds.add(r.track_id));
  }

  function updateAuthUI() {
    if (state.user && state.profile) {
      $('#profileGuest')?.classList.add('hidden');
      $('#profileUser')?.classList.remove('hidden');
      const p = state.profile;
      const badge = (p.is_verified || p.role === 'owner') ? verifiedBadge() : '';
      const banned = p.is_banned ? '<p class="msg msg-error">حساب شما محدود شده است.</p>' : '';
      const emailOk = isEmailConfirmed(state.user);
      const emailNote = emailOk
        ? '<p class="msg msg-ok" style="margin-top:8px">ایمیل تأیید شده است.</p>'
        : '<p class="msg msg-info" style="margin-top:8px">ایمیل هنوز تأیید نشده است (وضعیت Auth).</p>';
      $('#myProfileHeader').innerHTML = `
        <img class="profile-avatar" src="${escapeHtml(p.avatar_url || '')}" alt="" onerror="this.src=''">
        <div class="profile-name">${escapeHtml(p.display_name || p.username || '')} ${badge}</div>
        <div class="profile-handle">@${escapeHtml(p.username || '—')} · ${escapeHtml(p.role || 'user')}</div>
        <div class="profile-bio">${escapeHtml(p.bio || '')}</div>${banned}${emailNote}`;
      if (state.isStaff) {
        $('#adminSection')?.classList.remove('hidden');
        loadAdmin('overview');
      } else {
        $('#adminSection')?.classList.add('hidden');
      }
      const hint = $('#submitHint');
      if (hint) {
        hint.textContent = state.isOwner
          ? 'به‌عنوان مالک می‌توانید مستقیماً منتشر کنید.'
          : 'آهنگ شما برای بررسی ارسال می‌شود و پس از تأیید منتشر خواهد شد.';
      }
      const subBtn = $('#btnDoSubmit');
      if (subBtn) subBtn.textContent = state.isOwner ? 'بارگذاری و انتشار' : 'ارسال برای بررسی';
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
            throw new Error('ایمیل شما هنوز تأیید نشده است. صندوق ورودی را بررسی کنید یا بعداً دوباره تلاش کنید.');
          }
          if (isEmailRateLimitError(error)) {
            throw new Error('محدودیت ارسال ایمیل فعال است. کمی بعد دوباره تلاش کنید.');
          }
          throw error;
        }
        if (!data.session) {
          throw new Error('ورود انجام نشد. لطفاً دوباره تلاش کنید.');
        }
        closeAuth();
        await refreshSession();
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
    showMsg($('#submitMsg'), 'در حال بارگذاری...', 'info');

    const uid = state.user.id;
    const ts = Date.now();
    let coverPath = null, audioPath = null, inserted = false;
    try {
      let coverUrl = null;
      if (coverFile) {
        const safe = coverFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
        coverPath = `${uid}/${ts}-c-${safe}`;
        const { error } = await sb.storage.from('covers').upload(coverPath, coverFile, { upsert: false, contentType: coverFile.type || 'image/jpeg' });
        if (error) throw error;
        coverUrl = sb.storage.from('covers').getPublicUrl(coverPath).data.publicUrl;
      }
      const safeA = audioFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      audioPath = `${uid}/${ts}-a-${safeA}`;
      const { error: aErr } = await sb.storage.from('audio').upload(audioPath, audioFile, { upsert: false, contentType: audioFile.type || 'audio/mpeg' });
      if (aErr) throw aErr;
      const audioUrl = sb.storage.from('audio').getPublicUrl(audioPath).data.publicUrl;

      const status = state.isOwner ? 'published' : 'pending';
      const { error: iErr } = await sb.from('tracks').insert({
        title, artist_name: artist, album: album || null, cover_url: coverUrl,
        audio_url: audioUrl, tags, language, lyrics: lyrics || null,
        is_downloadable: false, status, uploaded_by: uid
      });
      if (iErr) throw iErr;
      inserted = true;
      showMsg($('#submitMsg'), status === 'published' ? 'آهنگ منتشر شد.' : 'ارسال شد و در انتظار بررسی است.', 'ok');
      $('#submitForm').reset();
      if (status === 'published') await loadCatalog();
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
  async function loadPlaylists() {
    const box = $('#playlistsPanel');
    const empty = $('#playlistsEmpty');
    if (!sb) { if (empty) empty.classList.remove('hidden'); return; }
    const { data } = await sb.from('playlists')
      .select('id, title, description, cover_url, is_public, is_official, user_id')
      .or('is_public.eq.true,is_official.eq.true' + (state.user ? `,user_id.eq.${state.user.id}` : ''))
      .order('created_at', { ascending: false })
      .limit(50);
    if (!data?.length) {
      box.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    box.innerHTML = data.map(pl => `
      <div class="admin-item" data-pid="${escapeHtml(pl.id)}">
        <strong>${escapeHtml(pl.title)}</strong>
        ${pl.is_official ? ' <span class="status-pill status-published">رسمی</span>' : ''}
        <div style="color:var(--text-muted);font-size:0.8rem">${escapeHtml(pl.description || '')}</div>
        <div class="actions"><button type="button" class="btn btn-ghost btn-sm" data-play-pl="${escapeHtml(pl.id)}">پخش</button></div>
      </div>`).join('');
    if (state.user) $('#btnCreatePlaylist').style.display = 'block';
  }

  async function playPlaylist(pid) {
    if (!sb) return;
    const { data: items } = await sb.from('playlist_items')
      .select('track_id, position, tracks(id, title, artist_name, cover_url, audio_url, duration_seconds, tags, lyrics, status)')
      .eq('playlist_id', pid).order('position');
    const tracks = (items || []).map(i => i.tracks).filter(t => t && t.status === 'published').map(mapTrack);
    if (!tracks.length) { alert('این پلی‌لیست خالی است یا آهنگ منتشرشده ندارد.'); return; }
    state.queue = tracks;
    loadTrack(0, true);
  }

  async function createPlaylist() {
    if (!sb || !state.user) { openAuth('login'); return; }
    const title = prompt('نام پلی‌لیست:');
    if (!title || !title.trim()) return;
    const { error } = await sb.from('playlists').insert({
      user_id: state.user.id, title: title.trim(), is_public: true,
      is_official: state.isOwner
    });
    if (error) alert(error.message); else loadPlaylists();
  }

  async function addToPlaylist(trackId) {
    if (!sb || !state.user) { openAuth('login'); return; }
    const { data: pls } = await sb.from('playlists').select('id, title').eq('user_id', state.user.id);
    if (!pls?.length) {
      if (confirm('پلی‌لیستی ندارید. یکی بسازیم؟')) await createPlaylist();
      return;
    }
    const names = pls.map((p, i) => `${i + 1}. ${p.title}`).join('\n');
    const choice = prompt(`شماره پلی‌لیست:\n${names}`);
    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || !pls[idx]) return;
    const { error } = await sb.from('playlist_items').insert({
      playlist_id: pls[idx].id, track_id: trackId, position: Date.now()
    });
    if (error) alert(/duplicate|unique/i.test(error.message) ? 'این آهنگ قبلاً در پلی‌لیست است.' : error.message);
    else alert('افزوده شد.');
  }

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
        const { data } = await sb.from('profiles')
          .select('id, username, display_name, role, is_verified, is_banned, created_at')
          .order('created_at', { ascending: false }).limit(40);
        box.innerHTML = `<div class="admin-list">${(data || []).map(u => `
          <div class="admin-item">
            <strong>${escapeHtml(u.display_name || u.username || '')}</strong>
            @${escapeHtml(u.username || '—')} · ${escapeHtml(u.role)}
            ${u.is_verified ? verifiedBadge() : ''}
            ${u.is_banned ? '<span class="status-pill status-rejected">مسدود</span>' : ''}
            <div class="actions">
              ${state.isOwner && u.role !== 'owner' ? `<button type="button" class="btn btn-ghost btn-sm" data-ban="${u.id}" data-banned="${u.is_banned}">${u.is_banned ? 'رفع مسدودیت' : 'مسدود'}</button>` : ''}
              ${state.isOwner && u.role !== 'owner' ? `<button type="button" class="btn btn-ghost btn-sm" data-verify="${u.id}" data-v="${u.is_verified}">${u.is_verified ? 'لغو تأیید' : 'تأیید'}</button>` : ''}
            </div>
          </div>`).join('')}</div>`;
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
    if (!sb || !state.isStaff) return;
    const v = !(currently === 'true' || currently === true);
    const { error } = await sb.from('profiles').update({ is_verified: v }).eq('id', uid);
    if (error) alert(error.message); else loadAdmin('users');
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
  function switchView(name) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#view-${name}`)?.classList.add('active');
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    if (name === 'playlists') loadPlaylists();
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
      state.searchCat = state.searchCat || 'tracks';
      debouncedSearch(e.target.value, $('#homeCats .cat-chip.active')?.dataset.cat || 'tracks');
    });
    $('#searchInput2')?.addEventListener('input', e => {
      debouncedSearch(e.target.value, $('#searchCats .cat-chip.active')?.dataset.cat || 'all');
    });
    $$('#homeCats .cat-chip, #searchCats .cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.parentElement.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const q = ($('#searchInput2')?.value || $('#searchInput')?.value || '');
        debouncedSearch(q, chip.dataset.cat);
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
    a.addEventListener('play', () => { state.isPlaying = true; updatePlayerUI(); });
    a.addEventListener('pause', () => { state.isPlaying = false; updatePlayerUI(); });
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
    $('#btnSubmitOpen')?.addEventListener('click', () => {
      if (!state.user) openAuth('login');
      else $('#submitOverlay')?.classList.add('open');
    });
    $('#btnSubmitTrack')?.addEventListener('click', () => $('#submitOverlay')?.classList.add('open'));
    $('#submitClose')?.addEventListener('click', () => $('#submitOverlay')?.classList.remove('open'));
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
    $('#btnCreatePlaylist')?.addEventListener('click', createPlaylist);
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

  function init() {
    if (!hasSupabase) $('#configBanner')?.classList.remove('hidden');
    setPlayerEnabled(false);
    bind();
    checkRecoverySession();
    loadCatalog();
    refreshSession();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
