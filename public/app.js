(() => {
  const $ = (sel) => document.querySelector(sel);
  const els = {
    notice: $('#notice'),
    input: $('#search-input'),
    searchBtn: $('#search-btn'),
    chips: $('#chips'),
    topics: $('#topics'),
    player: $('#player'),
    resultsMeta: $('#results-meta'),
    grid: $('#grid'),
  };

  const STORAGE = {
    topics: 'focustube.topics',
    bookmarks: 'focustube.bookmarks',
  };

  const state = {
    query: '',
    filter: 'all',
    rawItems: [],
    bookmarks: loadJSON(STORAGE.bookmarks, {}),
    topics: loadJSON(STORAGE.topics, ['biryani making', 'gym workout', 'python coding']),
    ytPlayer: null,
    ytReady: false,
    pendingPlayId: null,
  };

  function loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function formatViews(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M views';
    if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'K views';
    return n + ' views';
  }
  function formatDuration(s) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function renderChips() {
    const filters = [
      { id: 'all', label: 'All Shorts' },
      { id: 'u30', label: 'Under 30s' },
      { id: 'u60', label: 'Under 60s' },
      { id: 'views', label: 'Most Viewed' },
      { id: 'recent', label: 'Recent' },
    ];
    els.chips.innerHTML = filters.map((f) =>
      `<button class="chip ${state.filter === f.id ? 'active' : ''}" data-id="${f.id}">${f.label}</button>`
    ).join('');
    els.chips.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.id;
        renderChips();
        renderGrid();
      });
    });
  }

  function renderTopics() {
    const items = state.topics.map((t, i) => `
      <span class="topic" data-i="${i}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
        </svg>
        <span class="t">${escapeHtml(t)}</span>
        <span class="x" data-remove="${i}" title="Remove">×</span>
      </span>`).join('');
    els.topics.innerHTML = items + `<button class="topic add" id="add-topic">+ add topic</button>`;
    els.topics.querySelectorAll('.topic .t').forEach((node) => {
      node.addEventListener('click', () => {
        const i = parseInt(node.parentElement.dataset.i, 10);
        const topic = state.topics[i];
        els.input.value = topic;
        runSearch(topic);
      });
    });
    els.topics.querySelectorAll('.x[data-remove]').forEach((node) => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(node.dataset.remove, 10);
        state.topics.splice(i, 1);
        saveJSON(STORAGE.topics, state.topics);
        renderTopics();
      });
    });
    $('#add-topic').addEventListener('click', () => {
      const t = (els.input.value || '').trim();
      if (!t) { els.input.focus(); return; }
      if (state.topics.includes(t)) return;
      state.topics.push(t);
      saveJSON(STORAGE.topics, state.topics);
      renderTopics();
    });
  }

  function applyFilter(items) {
    let out = items.slice();
    if (state.filter === 'u30') out = out.filter((v) => v.durationSeconds <= 30);
    else if (state.filter === 'u60') out = out.filter((v) => v.durationSeconds <= 60);
    if (state.filter === 'views') out.sort((a, b) => b.viewCount - a.viewCount);
    else if (state.filter === 'recent') out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    return out;
  }

  function renderGrid() {
    const items = applyFilter(state.rawItems);
    if (state.query) {
      els.resultsMeta.textContent = `Results for "${state.query}" — ${items.length} short${items.length === 1 ? '' : 's'} found`;
    } else {
      els.resultsMeta.textContent = '';
    }
    if (items.length === 0) {
      els.grid.innerHTML = state.query
        ? `<div class="empty" style="grid-column:1/-1">No shorts matched. Try a different topic or filter.</div>`
        : `<div class="empty" style="grid-column:1/-1">Search a topic above to get started.</div>`;
      return;
    }
    els.grid.innerHTML = items.map((v) => {
      const bookmarked = !!state.bookmarks[v.id];
      return `
        <div class="card" data-id="${v.id}">
          <div class="thumb">
            <img src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" />
            <div class="play-overlay">
              <span class="pc">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
              </span>
            </div>
            <button class="bookmark ${bookmarked ? 'active' : ''}" data-bookmark="${v.id}" aria-label="Bookmark">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${bookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <span class="duration">${formatDuration(v.durationSeconds)}</span>
          </div>
          <div class="title">${escapeHtml(v.title)}</div>
          <div class="views">${formatViews(v.viewCount)}</div>
        </div>`;
    }).join('');

    els.grid.querySelectorAll('.card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-bookmark]')) return;
        const id = card.dataset.id;
        const v = state.rawItems.find((x) => x.id === id);
        if (v) playVideo(v);
      });
    });
    els.grid.querySelectorAll('[data-bookmark]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.bookmark;
        if (state.bookmarks[id]) delete state.bookmarks[id];
        else {
          const v = state.rawItems.find((x) => x.id === id);
          if (v) state.bookmarks[id] = { id: v.id, title: v.title, thumbnail: v.thumbnail };
        }
        saveJSON(STORAGE.bookmarks, state.bookmarks);
        renderGrid();
      });
    });
  }

  function playVideo(v) {
    els.player.innerHTML = `
      <div class="frame-wrap">
        <div id="yt-frame"></div>
        <div class="now-playing">
          <div class="t">${escapeHtml(v.title)}</div>
          <div class="m">${escapeHtml(v.channelTitle || '')} · ${formatViews(v.viewCount)}</div>
        </div>
      </div>`;

    const mount = () => {
      state.ytPlayer = new YT.Player('yt-frame', {
        height: '640',
        width: '360',
        videoId: v.id,
        playerVars: {
          autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, controls: 1,
        },
      });
    };

    if (state.ytReady && window.YT && window.YT.Player) mount();
    else state.pendingPlayId = { videoId: v.id, mount };

    els.player.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.onYouTubeIframeAPIReady = function () {
    state.ytReady = true;
    if (state.pendingPlayId) {
      state.pendingPlayId.mount();
      state.pendingPlayId = null;
    }
  };

  async function runSearch(q) {
    q = (q || '').trim();
    if (!q) return;
    state.query = q;
    els.grid.innerHTML = `<div class="loading" style="grid-column:1/-1">Searching…</div>`;
    els.resultsMeta.textContent = '';
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        const msg = (data && data.error) || `Request failed (${res.status}).`;
        els.grid.innerHTML = `<div class="error" style="grid-column:1/-1">${escapeHtml(msg)}</div>`;
        if (/api[_ ]?key/i.test(msg)) els.notice.classList.remove('hidden');
        return;
      }
      els.notice.classList.add('hidden');
      state.rawItems = data.items || [];
      renderGrid();
    } catch (err) {
      els.grid.innerHTML = `<div class="error" style="grid-column:1/-1">Network error. Is the server running?</div>`;
    }
  }

  els.searchBtn.addEventListener('click', () => runSearch(els.input.value));
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch(els.input.value);
  });

  // Probe API key — keep notice visible only if missing.
  fetch('/api/search?q=__probe__').then(async (r) => {
    if (r.status === 500) {
      const d = await r.json().catch(() => ({}));
      if (/api[_ ]?key/i.test(d.error || '')) els.notice.classList.remove('hidden');
    }
  }).catch(() => {});

  renderChips();
  renderTopics();
  renderGrid();
})();
