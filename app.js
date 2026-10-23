/**
 * MEGA MUSIC — Phase 1
 * Local catalog + functional player + search
 * Ready for Supabase connection in later phases
 */

(function () {
  'use strict';

  // ---------- Local demo catalog (Phase 1) ----------
  // Public-domain / free sample audio for demo only.
  // Replace with Supabase records in Phase 2.
  const DEMO_TRACKS = [
    {
      id: '1',
      title: 'Midnight Drive',
      artist: 'Neon Pulse',
      album: 'City Lights',
      duration: 198,
      cover: 'https://picsum.photos/seed/mega1/400/400',
      audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      tags: ['electronic', 'night']
    },
    {
      id: '2',
      title: 'پیشرو',
      artist: 'آرتیست ایرانی',
      album: 'آلبوم نمونه',
      duration: 215,
      cover: 'https://picsum.photos/seed/mega2/400/400',
      audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
      tags: ['persian', 'hiphop']
    },
    {
      id: '3',
      title: 'Red Horizon',
      artist: 'Glass Echo',
      album: 'Fragments',
      duration: 187,
      cover: 'https://picsum.photos/seed/mega3/400/400',
      audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
      tags: ['ambient', 'cinematic']
    },
    {
      id: '4',
      title: 'Shadow Beat',
      artist: 'Dark Circuit',
      album: 'Voltage',
      duration: 204,
      cover: 'https://picsum.photos/seed/mega4/400/400',
      audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
      tags: ['bass', 'electronic']
    },
    {
      id: '5',
      title: 'لالایی شهری',
      artist: 'صدا و نور',
      album: 'شب‌های تهران',
      duration: 176,
      cover: 'https://picsum.photos/seed/mega5/400/400',
      audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
      tags: ['persian', 'chill']
    },
    {
      id: '6',
      title: 'Glass Reflection',
      artist: 'Aether',
      album: 'Clarity',
      duration: 221,
      cover: 'https://picsum.photos/seed/mega6/400/400',
      audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
      tags: ['indie', 'dream']
    },
    {
      id: '7',
      title: 'Pulse of the Night',
      artist: 'Neon Pulse',
      album: 'City Lights',
      duration: 192,
      cover: 'https://picsum.photos/seed/mega7/400/400',
      audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
      tags: ['electronic']
    },
    {
      id: '8',
      title: 'یادگاری',
      artist: 'آرتیست ایرانی',
      album: 'آلبوم نمونه',
      duration: 208,
      cover: 'https://picsum.photos/seed/mega8/400/400',
      audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
      tags: ['persian', 'pop']
    }
  ];

  // ---------- State ----------
  const state = {
    tracks: [...DEMO_TRACKS],
    filtered: [...DEMO_TRACKS],
    currentIndex: -1,
    isPlaying: false,
    volume: 0.8
  };

  // ---------- DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const els = {
    search: $('#searchInput'),
    trackGrid: $('#trackGrid'),
    sectionTitle: $('#sectionTitle'),
    emptyState: $('#emptyState'),
    audio: $('#mainAudio'),
    playerArt: $('#playerArt'),
    playerTitle: $('#playerTitle'),
    playerArtist: $('#playerArtist'),
    btnPlay: $('#btnPlay'),
    btnPrev: $('#btnPrev'),
    btnNext: $('#btnNext'),
    progress: $('#progress'),
    timeElapsed: $('#timeElapsed'),
    timeTotal: $('#timeTotal'),
    volume: $('#volume'),
    btnVolume: $('#btnVolume'),
    configBanner: $('#configBanner')
  };

  // ---------- Helpers ----------
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function normalize(str) {
    return (str || '')
      .toLowerCase()
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .trim();
  }

  // ---------- Render ----------
  function renderTracks(list) {
    if (!els.trackGrid) return;
    if (!list.length) {
      els.trackGrid.innerHTML = '';
      els.emptyState?.classList.remove('hidden');
      return;
    }
    els.emptyState?.classList.add('hidden');
    els.trackGrid.innerHTML = list.map((t, i) => {
      const playing = state.currentIndex === state.tracks.indexOf(t) && state.isPlaying;
      return `
        <article class="track-card ${playing ? 'playing' : ''}" data-id="${t.id}" role="button" tabindex="0">
          <div class="track-card-art">
            <img src="${t.cover}" alt="" loading="lazy" width="400" height="400">
            <button class="track-card-play" aria-label="Play ${escapeHtml(t.title)}">
              <svg><use href="icons.svg#${playing ? 'icon-pause' : 'icon-play'}"></use></svg>
            </button>
          </div>
          <div class="track-card-title">${escapeHtml(t.title)}</div>
          <div class="track-card-artist">${escapeHtml(t.artist)}</div>
        </article>`;
    }).join('');
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function updatePlayerUI() {
    const track = state.tracks[state.currentIndex];
    if (!track) {
      els.playerTitle.textContent = 'هیچ آهنگی انتخاب نشده';
      els.playerArtist.textContent = '—';
      els.playerArt.src = '';
      els.playerArt.alt = '';
      return;
    }
    els.playerTitle.textContent = track.title;
    els.playerArtist.textContent = track.artist;
    els.playerArt.src = track.cover;
    els.playerArt.alt = track.title;
    const icon = state.isPlaying ? 'icon-pause' : 'icon-play';
    els.btnPlay.innerHTML = `<svg><use href="icons.svg#${icon}"></use></svg>`;
    els.btnPlay.setAttribute('aria-label', state.isPlaying ? 'Pause' : 'Play');
    // Update card play icons
    renderTracks(state.filtered);
  }

  // ---------- Player engine (single shared audio) ----------
  function loadTrack(index, autoplay = true) {
    if (index < 0 || index >= state.tracks.length) return;
    state.currentIndex = index;
    const track = state.tracks[index];
    els.audio.src = track.audio;
    els.audio.load();
    updatePlayerUI();
    if (autoplay) {
      els.audio.play().then(() => {
        state.isPlaying = true;
        updatePlayerUI();
      }).catch(() => {
        state.isPlaying = false;
        updatePlayerUI();
      });
    }
  }

  function togglePlay() {
    if (state.currentIndex < 0) {
      loadTrack(0, true);
      return;
    }
    if (state.isPlaying) {
      els.audio.pause();
      state.isPlaying = false;
    } else {
      els.audio.play().then(() => { state.isPlaying = true; }).catch(() => {});
    }
    updatePlayerUI();
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

  // ---------- Search ----------
  function doSearch(q) {
    const nq = normalize(q);
    if (!nq) {
      state.filtered = [...state.tracks];
      els.sectionTitle.textContent = 'کشف موسیقی';
    } else {
      state.filtered = state.tracks.filter(t =>
        normalize(t.title).includes(nq) ||
        normalize(t.artist).includes(nq) ||
        normalize(t.album).includes(nq) ||
        (t.tags || []).some(tag => normalize(tag).includes(nq))
      );
      els.sectionTitle.textContent = `نتایج جستجو (${state.filtered.length})`;
    }
    renderTracks(state.filtered);
  }

  // ---------- Events ----------
  function bindEvents() {
    els.search?.addEventListener('input', (e) => doSearch(e.target.value));

    els.trackGrid?.addEventListener('click', (e) => {
      const card = e.target.closest('.track-card');
      if (!card) return;
      const id = card.dataset.id;
      const idx = state.tracks.findIndex(t => t.id === id);
      if (idx === -1) return;
      if (state.currentIndex === idx && state.isPlaying) {
        togglePlay();
      } else {
        loadTrack(idx, true);
      }
    });

    els.btnPlay?.addEventListener('click', togglePlay);
    els.btnNext?.addEventListener('click', playNext);
    els.btnPrev?.addEventListener('click', playPrev);

    els.progress?.addEventListener('input', () => {
      const pct = Number(els.progress.value) / 100;
      if (els.audio.duration) els.audio.currentTime = pct * els.audio.duration;
    });

    els.volume?.addEventListener('input', () => {
      state.volume = Number(els.volume.value) / 100;
      els.audio.volume = state.volume;
    });

    els.btnVolume?.addEventListener('click', () => {
      if (els.audio.volume > 0) {
        els.audio.dataset.prevVol = els.audio.volume;
        els.audio.volume = 0;
        els.volume.value = 0;
        els.btnVolume.innerHTML = '<svg><use href="icons.svg#icon-volume-mute"></use></svg>';
      } else {
        const v = Number(els.audio.dataset.prevVol) || 0.8;
        els.audio.volume = v;
        els.volume.value = v * 100;
        els.btnVolume.innerHTML = '<svg><use href="icons.svg#icon-volume"></use></svg>';
      }
    });

    els.audio.addEventListener('timeupdate', () => {
      if (!els.audio.duration) return;
      const pct = (els.audio.currentTime / els.audio.duration) * 100;
      els.progress.value = pct;
      els.timeElapsed.textContent = formatTime(els.audio.currentTime);
    });

    els.audio.addEventListener('loadedmetadata', () => {
      els.timeTotal.textContent = formatTime(els.audio.duration);
    });

    els.audio.addEventListener('ended', () => {
      playNext();
    });

    els.audio.addEventListener('play', () => {
      state.isPlaying = true;
      updatePlayerUI();
    });
    els.audio.addEventListener('pause', () => {
      state.isPlaying = false;
      updatePlayerUI();
    });

    // Nav buttons (Phase 1: scroll / filter)
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.dataset.view;
        if (view === 'home') {
          doSearch('');
          els.search.value = '';
        }
      });
    });
  }

  // ---------- Config check ----------
  function checkConfig() {
    const cfg = window.MEGA_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      els.configBanner?.classList.remove('hidden');
    } else {
      els.configBanner?.classList.add('hidden');
    }
  }

  // ---------- Init ----------
  function init() {
    checkConfig();
    els.audio.volume = state.volume;
    if (els.volume) els.volume.value = state.volume * 100;
    renderTracks(state.filtered);
    bindEvents();
    updatePlayerUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
