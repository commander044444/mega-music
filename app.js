/**
 * MEGA MUSIC — Final phase
 * Empty catalog by design. Real tracks only via Supabase after owner upload.
 * No demo songs, no sample audio, no fabricated data.
 */
(function () {
  'use strict';

  const cfg = window.MEGA_CONFIG || {};
  const hasSupabase = !!(cfg.supabaseUrl && cfg.supabaseAnonKey &&
    cfg.supabaseUrl.startsWith('http') && cfg.supabaseAnonKey.length > 20);

  let supabase = null;
  if (hasSupabase && window.supabase) {
    supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }

  // ---------- State (starts empty) ----------
  const state = {
    tracks: [],          // ONLY from Supabase published tracks — never seeded
    filtered: [],
    currentIndex: -1,
    isPlaying: false,
    user: null,
    profile: null,
    isOwner: false,
    mode: 'login'        // login | register
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const els = {
    configBanner: $('#configBanner'),
    trackList: $('#trackList'),
    emptyState: $('#emptyState'),
    trackCount: $('#trackCount'),
    heroSub: $('#heroSub'),
    searchInput: $('#searchInput'),
    searchInput2: $('#searchInput2'),
    searchResults: $('#searchResults'),
    searchEmpty: $('#searchEmpty'),
    audio: $('#mainAudio'),
    miniPlayer: $('#miniPlayer'),
    miniArt: $('#miniArt'),
    miniTitle: $('#miniTitle'),
    miniArtist: $('#miniArtist'),
    miniProgressBar: $('#miniProgressBar'),
    btnPlay: $('#btnPlay'),
    btnPrev: $('#btnPrev'),
    btnNext: $('#btnNext'),
    authOverlay: $('#authOverlay'),
    authForm: $('#authForm'),
    authTitle: $('#authTitle'),
    authSubmit: $('#authSubmit'),
    authToggle: $('#authToggle'),
    authMsg: $('#authMsg'),
    authEmail: $('#authEmail'),
    authPassword: $('#authPassword'),
    authUsername: $('#authUsername'),
    groupUsername: $('#groupUsername'),
    profileGuest: $('#profileGuest'),
    profileUser: $('#profileUser'),
    userInfo: $('#userInfo'),
    ownerPanel: $('#ownerPanel'),
    uploadForm: $('#uploadForm'),
    uploadMsg: $('#uploadMsg')
  };

  // ---------- Helpers ----------
  function normalize(str) {
    return (str || '')
      .toLowerCase()
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .trim();
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function showMsg(el, text, type) {
    if (!el) return;
    el.innerHTML = text ? `<div class="msg msg-${type}">${escapeHtml(text)}</div>` : '';
  }

  // ---------- Catalog (empty until real data) ----------
  async function loadCatalog() {
    state.tracks = [];
    state.filtered = [];

    if (!supabase) {
      renderList();
      updateCount();
      return;
    }

    try {
      const { data, error } = await supabase
        .from('tracks')
        .select('id, title, artist_name, album, cover_url, audio_url, duration_seconds, tags, is_downloadable, status')
        .eq('status', 'published')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Catalog load:', error.message);
        state.tracks = [];
      } else {
        state.tracks = (data || []).map(t => ({
          id: t.id,
          title: t.title,
          artist: t.artist_name || 'نامشخص',
          album: t.album || '',
          cover: t.cover_url || '',
          audio: t.audio_url || '',
          duration: t.duration_seconds || 0,
          tags: t.tags || [],
          downloadable: !!t.is_downloadable
        }));
      }
    } catch (e) {
      console.warn('Catalog error', e);
      state.tracks = [];
    }

    state.filtered = [...state.tracks];
    renderList();
    updateCount();
  }

  function updateCount() {
    const n = state.tracks.length;
    if (els.trackCount) els.trackCount.textContent = String(n);
    if (els.heroSub) {
      els.heroSub.textContent = n === 0
        ? 'صفحه اصلی — هنوز آهنگی اضافه نشده'
        : `صفحه اصلی — ${n} آهنگ منتشرشده`;
    }
  }

  function renderList(targetList, targetEmpty, list) {
    const container = targetList || els.trackList;
    const empty = targetEmpty || els.emptyState;
    const items = list != null ? list : state.filtered;

    if (!container) return;

    if (!items.length) {
      container.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');

    container.innerHTML = items.map(t => {
      const globalIdx = state.tracks.findIndex(x => x.id === t.id);
      const playing = globalIdx === state.currentIndex && state.isPlaying;
      const cover = t.cover
        ? `<img class="row-art" src="${escapeHtml(t.cover)}" alt="" loading="lazy" width="56" height="56">`
        : `<div class="row-art" style="display:grid;place-items:center;color:var(--text-dim);font-size:0.7rem;">—</div>`;

      return `
        <article class="track-row ${playing ? 'playing' : ''}" data-id="${escapeHtml(t.id)}" role="listitem" tabindex="0">
          <div class="row-actions">
            <button type="button" class="row-btn add" data-action="add" aria-label="افزودن" title="افزودن به پلی‌لیست">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button type="button" class="row-btn play ${playing ? 'playing' : ''}" data-action="play" aria-label="${playing ? 'توقف' : 'پخش'}">
              <svg><use href="icons.svg#${playing ? 'icon-pause' : 'icon-play'}"></use></svg>
            </button>
          </div>
          <div class="row-meta">
            <div class="row-title">${escapeHtml(t.title)}</div>
            <div class="row-artist">${escapeHtml(t.artist)}</div>
            <div class="row-progress"><span style="width:${playing && els.audio.duration ? (els.audio.currentTime / els.audio.duration * 100) : 0}%"></span></div>
          </div>
          ${cover}
        </article>`;
    }).join('');
  }

  function doSearch(q) {
    const nq = normalize(q);
    if (!nq) {
      state.filtered = [...state.tracks];
    } else {
      state.filtered = state.tracks.filter(t =>
        normalize(t.title).includes(nq) ||
        normalize(t.artist).includes(nq) ||
        normalize(t.album).includes(nq) ||
        (t.tags || []).some(tag => normalize(tag).includes(nq))
      );
    }
    renderList();
    if (els.searchResults) {
      renderList(els.searchResults, els.searchEmpty, state.filtered);
    }
  }

  // ---------- Player (disabled when empty) ----------
  function setPlayerEnabled(on) {
    [els.btnPlay, els.btnPrev, els.btnNext].forEach(b => {
      if (b) b.disabled = !on;
    });
  }

  function updateMiniUI() {
    const t = state.tracks[state.currentIndex];
    if (!t) {
      els.miniPlayer?.classList.remove('visible');
      setPlayerEnabled(false);
      return;
    }
    els.miniPlayer?.classList.add('visible');
    setPlayerEnabled(true);
    if (els.miniTitle) els.miniTitle.textContent = t.title;
    if (els.miniArtist) els.miniArtist.textContent = t.artist;
    if (els.miniArt) {
      els.miniArt.src = t.cover || '';
      els.miniArt.alt = t.title;
    }
    const icon = state.isPlaying ? 'icon-pause' : 'icon-play';
    if (els.btnPlay) {
      els.btnPlay.innerHTML = `<svg><use href="icons.svg#${icon}"></use></svg>`;
      els.btnPlay.setAttribute('aria-label', state.isPlaying ? 'توقف' : 'پخش');
    }
    renderList();
  }

  function loadTrack(index, autoplay) {
    if (index < 0 || index >= state.tracks.length) return;
    const t = state.tracks[index];
    if (!t.audio) {
      showMsg(els.uploadMsg, 'فایل صوتی برای این آهنگ در دسترس نیست.', 'error');
      return;
    }
    state.currentIndex = index;
    els.audio.src = t.audio;
    els.audio.load();
    updateMiniUI();
    if (autoplay) {
      els.audio.play().then(() => {
        state.isPlaying = true;
        updateMiniUI();
      }).catch(() => {
        state.isPlaying = false;
        updateMiniUI();
      });
    }
  }

  function togglePlay() {
    if (!state.tracks.length || state.currentIndex < 0) return;
    if (state.isPlaying) {
      els.audio.pause();
      state.isPlaying = false;
    } else {
      els.audio.play().then(() => { state.isPlaying = true; }).catch(() => {});
    }
    updateMiniUI();
  }

  function playNext() {
    if (!state.tracks.length) return;
    const next = (state.currentIndex + 1) % state.tracks.length;
    loadTrack(next, true);
  }

  function playPrev() {
    if (!state.tracks.length) return;
    const prev = state.currentIndex <= 0 ? state.tracks.length - 1 : state.currentIndex - 1;
    loadTrack(prev, true);
  }

  // ---------- Auth ----------
  async function refreshSession() {
    if (!supabase) {
      state.user = null;
      state.profile = null;
      state.isOwner = false;
      updateAuthUI();
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    state.user = session?.user || null;
    if (state.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, role, display_name')
        .eq('id', state.user.id)
        .maybeSingle();
      state.profile = profile;
      state.isOwner = profile?.role === 'owner';
    } else {
      state.profile = null;
      state.isOwner = false;
    }
    updateAuthUI();
  }

  function updateAuthUI() {
    if (state.user) {
      els.profileGuest?.classList.add('hidden');
      els.profileUser?.classList.remove('hidden');
      if (els.userInfo) {
        const name = state.profile?.display_name || state.profile?.username || state.user.email;
        const role = state.profile?.role || 'user';
        els.userInfo.textContent = `${name} · ${role}`;
      }
      if (state.isOwner) {
        els.ownerPanel?.classList.remove('hidden');
      } else {
        els.ownerPanel?.classList.add('hidden');
      }
    } else {
      els.profileGuest?.classList.remove('hidden');
      els.profileUser?.classList.add('hidden');
      els.ownerPanel?.classList.add('hidden');
    }
  }

  function openAuth(mode) {
    state.mode = mode || 'login';
    if (els.authTitle) els.authTitle.textContent = state.mode === 'login' ? 'ورود' : 'ثبت‌نام';
    if (els.authSubmit) els.authSubmit.textContent = state.mode === 'login' ? 'ورود' : 'ثبت‌نام';
    if (els.authToggle) els.authToggle.textContent = state.mode === 'login' ? 'حساب ندارید؟ ثبت‌نام' : 'قبلاً ثبت‌نام کرده‌اید؟ ورود';
    if (els.groupUsername) els.groupUsername.style.display = state.mode === 'register' ? 'block' : 'none';
    showMsg(els.authMsg, '', 'info');
    els.authOverlay?.classList.add('open');
  }

  function closeAuth() {
    els.authOverlay?.classList.remove('open');
  }

  async function handleAuth(e) {
    e.preventDefault();
    if (!supabase) {
      showMsg(els.authMsg, 'Supabase پیکربندی نشده است. config.js را تنظیم کنید.', 'error');
      return;
    }
    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    const username = els.authUsername?.value.trim() || '';

    try {
      if (state.mode === 'register') {
        if (!username || username.length < 3) {
          showMsg(els.authMsg, 'نام کاربری حداقل ۳ کاراکتر باشد.', 'error');
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username } }
        });
        if (error) throw error;
        showMsg(els.authMsg, 'ثبت‌نام انجام شد. در صورت فعال بودن تأیید ایمیل، صندوق ورودی را بررسی کنید.', 'ok');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        closeAuth();
        await refreshSession();
      }
    } catch (err) {
      showMsg(els.authMsg, err.message || 'خطا در احراز هویت', 'error');
    }
  }

  async function handleLogout() {
    if (supabase) await supabase.auth.signOut();
    state.user = null;
    state.profile = null;
    state.isOwner = false;
    updateAuthUI();
  }

  // ---------- Owner upload ----------
  async function handleUpload(e) {
    e.preventDefault();
    if (!supabase || !state.isOwner) {
      showMsg(els.uploadMsg, 'فقط مالک می‌تواند آهنگ بارگذاری کند.', 'error');
      return;
    }

    const title = $('#upTitle').value.trim();
    const artist = $('#upArtist').value.trim();
    const album = $('#upAlbum').value.trim();
    const tagsRaw = $('#upTags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(/[,،]/).map(s => s.trim()).filter(Boolean) : [];
    const downloadable = $('#upDownloadable').checked;
    const coverFile = $('#upCover').files[0];
    const audioFile = $('#upAudio').files[0];

    if (!title || !artist || !audioFile) {
      showMsg(els.uploadMsg, 'عنوان، هنرمند و فایل صوتی الزامی است.', 'error');
      return;
    }

    const btn = $('#btnUpload');
    if (btn) btn.disabled = true;
    showMsg(els.uploadMsg, 'در حال بارگذاری...', 'info');

    try {
      const uid = state.user.id;
      const ts = Date.now();
      let coverUrl = null;
      let audioUrl = null;

      if (coverFile) {
        const path = `covers/${uid}/${ts}-${coverFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: cErr } = await supabase.storage.from('covers').upload(path, coverFile, { upsert: false });
        if (cErr) throw cErr;
        const { data: cPub } = supabase.storage.from('covers').getPublicUrl(path);
        coverUrl = cPub?.publicUrl || null;
      }

      const audioPath = `audio/${uid}/${ts}-${audioFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: aErr } = await supabase.storage.from('audio').upload(audioPath, audioFile, { upsert: false });
      if (aErr) throw aErr;
      const { data: aPub } = supabase.storage.from('audio').getPublicUrl(audioPath);
      audioUrl = aPub?.publicUrl;
      if (!audioUrl) throw new Error('آدرس فایل صوتی ساخته نشد.');

      const { error: iErr } = await supabase.from('tracks').insert({
        title,
        artist_name: artist,
        album: album || null,
        cover_url: coverUrl,
        audio_url: audioUrl,
        tags,
        is_downloadable: downloadable,
        status: 'published',
        uploaded_by: uid
      });
      if (iErr) throw iErr;

      showMsg(els.uploadMsg, 'آهنگ با موفقیت منتشر شد.', 'ok');
      els.uploadForm.reset();
      await loadCatalog();
    } catch (err) {
      showMsg(els.uploadMsg, err.message || 'خطا در بارگذاری', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---------- Navigation ----------
  function switchView(name) {
    $$('.view').forEach(v => v.classList.remove('active'));
    const view = $(`#view-${name}`);
    if (view) view.classList.add('active');
    $$('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === name);
    });
  }

  // ---------- Events ----------
  function bind() {
    els.searchInput?.addEventListener('input', e => doSearch(e.target.value));
    els.searchInput2?.addEventListener('input', e => {
      doSearch(e.target.value);
      if (els.searchInput) els.searchInput.value = e.target.value;
    });

    els.trackList?.addEventListener('click', e => {
      const row = e.target.closest('.track-row');
      if (!row) return;
      const id = row.dataset.id;
      const idx = state.tracks.findIndex(t => String(t.id) === String(id));
      if (idx < 0) return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'add') {
        // Playlist add requires auth — Phase ready
        if (!state.user) openAuth('login');
        return;
      }
      if (state.currentIndex === idx && state.isPlaying) togglePlay();
      else loadTrack(idx, true);
    });

    els.btnPlay?.addEventListener('click', togglePlay);
    els.btnNext?.addEventListener('click', playNext);
    els.btnPrev?.addEventListener('click', playPrev);

    els.audio?.addEventListener('timeupdate', () => {
      if (!els.audio.duration) return;
      const pct = (els.audio.currentTime / els.audio.duration) * 100;
      if (els.miniProgressBar) els.miniProgressBar.style.width = pct + '%';
    });
    els.audio?.addEventListener('ended', playNext);
    els.audio?.addEventListener('play', () => { state.isPlaying = true; updateMiniUI(); });
    els.audio?.addEventListener('pause', () => { state.isPlaying = false; updateMiniUI(); });

    $$('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $('#btnAuth')?.addEventListener('click', () => {
      if (state.user) switchView('more');
      else openAuth('login');
    });
    $('#btnLoginOpen')?.addEventListener('click', () => openAuth('login'));
    $('#authClose')?.addEventListener('click', closeAuth);
    els.authOverlay?.addEventListener('click', e => {
      if (e.target === els.authOverlay) closeAuth();
    });
    els.authToggle?.addEventListener('click', () => {
      openAuth(state.mode === 'login' ? 'register' : 'login');
    });
    els.authForm?.addEventListener('submit', handleAuth);
    $('#btnLogout')?.addEventListener('click', handleLogout);
    els.uploadForm?.addEventListener('submit', handleUpload);

    if (supabase) {
      supabase.auth.onAuthStateChange(() => refreshSession());
    }
  }

  // ---------- Init ----------
  function init() {
    if (!hasSupabase) {
      els.configBanner?.classList.remove('hidden');
    }
    setPlayerEnabled(false);
    bind();
    loadCatalog();
    refreshSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
