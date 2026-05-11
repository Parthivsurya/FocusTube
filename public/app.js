(() => {
  const $ = (sel) => document.querySelector(sel);
  const els = {
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
    nextPageToken: null,
    isLoadingMore: false,
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
        const idx = items.findIndex((x) => x.id === id);
        if (idx >= 0) openShorts(items, idx);
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

  // --- Shorts overlay (native scroll snapping) ---
  // Uses the YouTube IFrame API — embedding does NOT consume Data API quota,
  // so scrolling through cached results never triggers /api/search.

  function openShorts(list, startIndex) {
    state.shortsList = list;
    state.shortsIndex = -1; // force trigger on first observe
    if (!document.getElementById('shorts-overlay')) buildShortsOverlay();
    
    const overlay = document.getElementById('shorts-overlay');
    const listEl = overlay.querySelector('.shorts-list');
    
    // Build items
    listEl.innerHTML = list.map((v, i) => `
      <div class="shorts-item" data-index="${i}">
        <div class="shorts-stage" id="stage-${i}">
          <div class="thumb" style="background-image: url('${escapeHtml(v.thumbnail)}')"></div>
          <div class="player-container" id="player-container-${i}"></div>
          <div class="shorts-meta">
            <div class="t">${escapeHtml(v.title)}</div>
            <div class="m">${escapeHtml(v.channelTitle || '')} · ${formatViews(v.viewCount)}</div>
            <div class="i">${i + 1} / <span class="total-count">${list.length}</span></div>
          </div>
        </div>
      </div>
    `).join('');

    document.body.classList.add('shorts-open');
    overlay.classList.add('open');

    // Setup intersection observer for the items
    if (state.shortsObserver) state.shortsObserver.disconnect();
    state.shortsObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const idx = parseInt(entry.target.dataset.index, 10);
          activateShort(idx);
          if (idx >= state.shortsList.length - 5) {
            loadMore();
          }
        }
      });
    }, {
      root: listEl,
      threshold: 0.6
    });

    listEl.querySelectorAll('.shorts-item').forEach(el => state.shortsObserver.observe(el));

    // Scroll to the start index
    requestAnimationFrame(() => {
      const target = listEl.querySelector(`.shorts-item[data-index="${startIndex}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'auto' });
      }
    });
  }

  function closeShorts() {
    const overlay = document.getElementById('shorts-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('shorts-open');
    if (state.ytPlayer && typeof state.ytPlayer.stopVideo === 'function') {
      try { state.ytPlayer.stopVideo(); } catch {}
    }
  }

  function goShorts(delta) {
    const next = state.shortsIndex + delta;
    if (next < 0 || next >= state.shortsList.length) return;
    const overlay = document.getElementById('shorts-overlay');
    const listEl = overlay.querySelector('.shorts-list');
    const target = listEl.querySelector(`.shorts-item[data-index="${next}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function buildShortsOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'shorts-overlay';
    overlay.className = 'shorts-overlay';
    overlay.innerHTML = `
      <button class="shorts-close" aria-label="Close">×</button>
      <button class="shorts-nav up" aria-label="Previous">▲</button>
      <button class="shorts-nav down" aria-label="Next">▼</button>
      <div class="shorts-list"></div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.shorts-close').addEventListener('click', closeShorts);
    overlay.querySelector('.shorts-nav.up').addEventListener('click', () => goShorts(-1));
    overlay.querySelector('.shorts-nav.down').addEventListener('click', () => goShorts(1));

    document.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('shorts-open')) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goShorts(1); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goShorts(-1); }
      else if (e.key === 'Escape') closeShorts();
    });
  }

  function activateShort(idx) {
    if (state.shortsIndex === idx) return;
    state.shortsIndex = idx;
    const v = state.shortsList[idx];
    if (!v) return;

    const overlay = document.getElementById('shorts-overlay');
    overlay.querySelector('.shorts-nav.up').disabled = idx === 0;
    overlay.querySelector('.shorts-nav.down').disabled = idx === state.shortsList.length - 1;

    // Remove active class from all stages
    overlay.querySelectorAll('.shorts-stage').forEach(el => el.classList.remove('active'));

    const mount = () => {
      // destroy previous player to free memory
      if (state.ytPlayer && typeof state.ytPlayer.destroy === 'function') {
        try { state.ytPlayer.destroy(); } catch {}
        state.ytPlayer = null;
      }
      
      // Also clear old player containers to ensure no stray iframes
      overlay.querySelectorAll('.player-container').forEach(el => { el.innerHTML = ''; });

      const container = document.getElementById(`player-container-${idx}`);
      if (!container) return;
      container.innerHTML = '<div id="shorts-frame"></div>';
      
      const stage = overlay.querySelector(`#stage-${idx}`);
      
      state.ytPlayer = new YT.Player('shorts-frame', {
        videoId: v.id,
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, controls: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) {
               if (stage) stage.classList.add('active');
            }
          }
        }
      });
    };

    // Debounce the mount slightly to avoid rapid creations during fast scrolling
    if (state.mountTimeout) clearTimeout(state.mountTimeout);
    state.mountTimeout = setTimeout(() => {
      if (state.ytReady && window.YT && window.YT.Player) mount();
      else state.pendingPlayId = { mount };
    }, 150);
  }

  window.onYouTubeIframeAPIReady = function () {
    state.ytReady = true;
    if (state.pendingPlayId) {
      state.pendingPlayId.mount();
      state.pendingPlayId = null;
    }
  };

  let isSearching = false;

  async function runSearch(q) {
    q = (q || '').trim();
    if (!q || isSearching) return;
    
    state.query = q;
    isSearching = true;
    state.nextPageToken = null;
    els.grid.innerHTML = `<div class="loading" style="grid-column:1/-1">Searching…</div>`;
    els.resultsMeta.textContent = '';
    
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        const msg = (data && data.error) || `Request failed (${res.status}).`;
        els.grid.innerHTML = `<div class="error" style="grid-column:1/-1">${escapeHtml(msg)}</div>`;
        isSearching = false;
        return;
      }
      state.rawItems = data.items || [];
      state.nextPageToken = data.nextPageToken;
      renderGrid();
    } catch (err) {
      els.grid.innerHTML = `<div class="error" style="grid-column:1/-1">Network error. Is the server running?</div>`;
    }
    isSearching = false;
  }

  els.searchBtn.addEventListener('click', () => runSearch(els.input.value));
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch(els.input.value);
  });

  async function loadMore() {
    if (state.isLoadingMore || !state.nextPageToken || isSearching) return;
    state.isLoadingMore = true;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(state.query)}&pageToken=${state.nextPageToken}`);
      const data = await res.json();
      if (res.ok) {
        state.nextPageToken = data.nextPageToken;
        const newItems = (data.items || []).filter(newItem => !state.rawItems.find(existing => existing.id === newItem.id));
        if (newItems.length > 0) {
          state.rawItems.push(...newItems);
          if (document.body.classList.contains('shorts-open') && state.shortsList) {
             appendShorts(newItems);
          }
          renderGrid();
        }
      }
    } catch (err) {
      console.error('Failed to load more', err);
    }
    state.isLoadingMore = false;
  }

  function appendShorts(newItems) {
    const overlay = document.getElementById('shorts-overlay');
    if (!overlay) return;
    const listEl = overlay.querySelector('.shorts-list');
    const startIdx = state.shortsList.length;
    
    state.shortsList.push(...newItems);
    
    const newHtml = newItems.map((v, i) => {
      const idx = startIdx + i;
      return `
        <div class="shorts-item" data-index="${idx}">
          <div class="shorts-stage" id="stage-${idx}">
            <div class="thumb" style="background-image: url('${escapeHtml(v.thumbnail)}')"></div>
            <div class="player-container" id="player-container-${idx}"></div>
            <div class="shorts-meta">
              <div class="t">${escapeHtml(v.title)}</div>
              <div class="m">${escapeHtml(v.channelTitle || '')} · ${formatViews(v.viewCount)}</div>
              <div class="i">${idx + 1} / <span class="total-count">${state.shortsList.length}</span></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    listEl.querySelectorAll('.total-count').forEach(el => el.textContent = state.shortsList.length);
    listEl.insertAdjacentHTML('beforeend', newHtml);
    
    const addedItems = Array.from(listEl.querySelectorAll('.shorts-item')).slice(startIdx);
    addedItems.forEach(el => state.shortsObserver.observe(el));
    
    if (state.shortsIndex < state.shortsList.length - 1) {
      overlay.querySelector('.shorts-nav.down').disabled = false;
    }
  }

  window.addEventListener('scroll', () => {
    if (!document.body.classList.contains('shorts-open') && (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
      loadMore();
    }
  });

  renderChips();
  renderTopics();
  renderGrid();
})();
