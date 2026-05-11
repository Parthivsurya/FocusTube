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
    audioUnlocked: 'focustube.audioUnlocked',
  };

  const state = {
    query: '',
    filter: 'all',
    rawItems: [],
    bookmarks: loadJSON(STORAGE.bookmarks, {}),
    topics: loadJSON(STORAGE.topics, ['biryani making', 'gym workout', 'python coding']),
    nextPageToken: null,
    isLoadingMore: false,
    shortsList: [],
    shortsIndex: -1,
    audioUnlocked: loadJSON(STORAGE.audioUnlocked, false),
    // Why activateShort was called: 'click' (strong gesture: button, key,
    // card-tap, speaker) vs 'scroll' (touchend / wheel / scrollend). Mobile
    // browsers treat touch-after-scroll as a weak gesture — sending unMute
    // pauses the iframe. kickPlay reads this to decide whether to send unMute.
    lastSource: 'click',
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

  // --- Shorts overlay ---
  // A single persistent YouTube iframe is relocated as you scroll.
  // This bypasses mobile autoplay restrictions by keeping the "blessed" iframe alive.

  function updateMuteBtn() {
    const btn = document.querySelector('.shorts-mute');
    if (!btn) return;
    btn.textContent = state.audioUnlocked ? '🔊' : '🔇';
    btn.setAttribute('aria-label', state.audioUnlocked ? 'Mute' : 'Unmute');
  }

  function shortsItemHTML(v, i, total) {
    return `
      <div class="shorts-item" data-index="${i}">
        <div class="shorts-stage" id="stage-${i}">
          <div class="thumb" style="background-image: url('${escapeHtml(v.thumbnail)}')"></div>
          <div class="player-mount" id="player-mount-${i}"></div>
          <div class="shorts-meta">
            <div class="t">${escapeHtml(v.title)}</div>
            <div class="m">${escapeHtml(v.channelTitle || '')} · ${formatViews(v.viewCount)}</div>
            <div class="i">${i + 1} / <span class="total-count">${total}</span></div>
          </div>
        </div>
      </div>`;
  }

  function openShorts(list, startIndex) {
    state.shortsList = list;
    if (!document.getElementById('shorts-overlay')) buildShortsOverlay();

    const overlay = document.getElementById('shorts-overlay');
    const listEl = overlay.querySelector('.shorts-list');
    const wrapper = document.getElementById('persistent-player-wrapper');
    
    // Rescue the wrapper before overwriting listEl
    if (wrapper && wrapper.parentNode !== overlay) {
      wrapper.style.display = 'none';
      overlay.appendChild(wrapper);
    }

    listEl.innerHTML = list.map((v, i) => shortsItemHTML(v, i, list.length)).join('');

    document.body.classList.add('shorts-open');
    overlay.classList.add('open');

    // Force shortsIndex to allow synchronous activation
    state.shortsIndex = startIndex;
    
    // Sync init player to bypass mobile autoplay restrictions
    const container = document.getElementById(`player-mount-${startIndex}`);
    if (container && wrapper) {
      wrapper.style.display = 'block';
      container.appendChild(wrapper);
    }
    
    const v = list[startIndex];
    
    if (!state.ytPlayer && window.YT && window.YT.Player) {
       // Create the single persistent iframe
       state.ytPlayer = new YT.Player('shorts-frame', {
          videoId: v.id,
          playerVars: { 
            autoplay: 1, 
            rel: 0, 
            modestbranding: 1, 
            playsinline: 1, 
            controls: 1, 
            origin: window.location.origin,
            mute: state.audioUnlocked ? 0 : 1 // Start unmuted if user unlocked audio!
          },
          events: {
            onStateChange: (e) => {
              if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) {
                 const activeStage = document.getElementById(`stage-${state.shortsIndex}`);
                 if (activeStage) activeStage.classList.add('active');
              }
            }
          }
       });
    } else if (state.ytPlayer && typeof state.ytPlayer.loadVideoById === 'function') {
       if (state.audioUnlocked) state.ytPlayer.unMute();
       else state.ytPlayer.mute();
       state.ytPlayer.loadVideoById(v.id);
       const activeStage = document.getElementById(`stage-${startIndex}`);
       if (activeStage) activeStage.classList.add('active');
    }

    const target = listEl.querySelector(`.shorts-item[data-index="${startIndex}"]`);
    if (target) {
      // Small timeout ensures the DOM has rendered the list before scrolling
      setTimeout(() => target.scrollIntoView({ behavior: 'auto' }), 0);
    }
  }

  function closeShorts() {
    const overlay = document.getElementById('shorts-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('shorts-open');
    if (state.ytPlayer && typeof state.ytPlayer.stopVideo === 'function') {
      try { state.ytPlayer.stopVideo(); } catch {}
    }
    
    const wrapper = document.getElementById('persistent-player-wrapper');
    if (wrapper && overlay) {
      wrapper.style.display = 'none';
      overlay.appendChild(wrapper);
    }
    state.shortsIndex = -1;
  }

  function goShorts(delta) {
    const next = state.shortsIndex + delta;
    if (next < 0 || next >= state.shortsList.length) return;
    
    activateShort(next, 'click');

    const listEl = document.querySelector('.shorts-list');
    const target = listEl.querySelector(`.shorts-item[data-index="${next}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  }

  function activateShort(idx, source = 'click') {
    if (idx < 0 || idx >= state.shortsList.length) return;
    if (state.shortsIndex === idx) return;
    state.lastSource = source;

    const overlay = document.getElementById('shorts-overlay');
    if (!overlay) return;

    overlay.querySelectorAll('.shorts-stage').forEach(el => el.classList.remove('active'));

    state.shortsIndex = idx;

    const upBtn = overlay.querySelector('.shorts-nav.up');
    const downBtn = overlay.querySelector('.shorts-nav.down');
    if (upBtn) upBtn.disabled = idx === 0;
    if (downBtn) downBtn.disabled = idx === state.shortsList.length - 1;

    const mount = document.getElementById(`player-mount-${idx}`);
    const wrapper = document.getElementById('persistent-player-wrapper');
    
    if (mount && wrapper) {
      wrapper.style.display = 'block';
      mount.appendChild(wrapper);
    }
    
    const v = state.shortsList[idx];
    const stage = document.getElementById(`stage-${idx}`);
    
    if (state.ytPlayer && typeof state.ytPlayer.loadVideoById === 'function') {
       if (state.audioUnlocked) state.ytPlayer.unMute();
       else state.ytPlayer.mute();
       
       state.ytPlayer.loadVideoById(v.id);
       if (stage) stage.classList.add('active');
    }
  }

  function buildShortsOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'shorts-overlay';
    overlay.className = 'shorts-overlay';
    overlay.innerHTML = `
      <button class="shorts-close" aria-label="Close">×</button>
      <button class="shorts-mute" aria-label="Unmute">🔇</button>
      <button class="shorts-nav up" aria-label="Previous">▲</button>
      <button class="shorts-nav down" aria-label="Next">▼</button>
      <div id="persistent-player-wrapper" style="display: none; width: 100%; height: 100%;">
        <div id="shorts-frame"></div>
      </div>
      <div class="shorts-list"></div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.shorts-close').addEventListener('click', closeShorts);
    overlay.querySelector('.shorts-nav.up').addEventListener('click', () => goShorts(-1));
    overlay.querySelector('.shorts-nav.down').addEventListener('click', () => goShorts(1));

    overlay.querySelector('.shorts-mute').addEventListener('click', () => {
      state.audioUnlocked = !state.audioUnlocked;
      saveJSON(STORAGE.audioUnlocked, state.audioUnlocked);
      updateMuteBtn();
      if (state.ytPlayer && typeof state.ytPlayer.unMute === 'function') {
        if (state.audioUnlocked) {
          state.ytPlayer.unMute();
        } else {
          state.ytPlayer.mute();
        }
      }
    });
    updateMuteBtn();

    document.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('shorts-open')) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goShorts(1); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goShorts(-1); }
      else if (e.key === 'Escape') closeShorts();
    });

    const listEl = overlay.querySelector('.shorts-list');
    let scrollTimer = null;
    // Pick the index nearest the current scroll position. `predict` adds the
    // direction of recent motion so we can flip before snap actually settles.
    const pickIndex = (predict = 0) => {
      const itemHeight = listEl.clientHeight;
      if (!itemHeight) return -1;
      let idx = Math.round((listEl.scrollTop + predict) / itemHeight);
      if (idx < 0) idx = 0;
      if (idx >= state.shortsList.length) idx = state.shortsList.length - 1;
      return idx;
    };
    const settleTo = (idx) => {
      if (idx < 0 || idx >= state.shortsList.length) return;
      if (idx !== state.shortsIndex) activateShort(idx, 'scroll');
      if (idx >= state.shortsList.length - 5) loadMore();
    };
    const onScrollSettle = () => {
      if (!state.shortsList || !state.shortsList.length) return;
      settleTo(pickIndex(0));
    };
    listEl.addEventListener('scroll', () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(onScrollSettle, 100);
    }, { passive: true });
    if ('onscrollend' in window) {
      listEl.addEventListener('scrollend', () => {
        if (scrollTimer) clearTimeout(scrollTimer);
        onScrollSettle();
      });
    }

    // --- Gesture-bound activation (mobile autoplay path) ---
    // Mobile browsers require media play() to run inside a user-activation
    // window. setTimeout-based settling drops out of that window, so we also
    // fire activateShort synchronously on touchend/pointerup — same code path
    // as the down-arrow button, which is the only one that currently triggers
    // autoplay on mobile.
    let touchStartY = 0;
    let touchStartScroll = 0;
    let touchStartTime = 0;
    listEl.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches[0]) return;
      touchStartY = e.touches[0].clientY;
      touchStartScroll = listEl.scrollTop;
      touchStartTime = performance.now();
    }, { passive: true });
    const gestureSettle = (endY) => {
      if (!state.shortsList || !state.shortsList.length) return;
      const itemHeight = listEl.clientHeight;
      if (!itemHeight) return;
      const dy = touchStartY - endY; // positive = swipe up (scroll down)
      const dt = Math.max(1, performance.now() - touchStartTime);
      const velocity = dy / dt; // px per ms
      // Decide the target index based on where the snap will land.
      // Threshold of 1/4 of an item or a fling above 0.3 px/ms commits to next/prev.
      const startIdx = Math.round(touchStartScroll / itemHeight);
      let targetIdx = pickIndex(0);
      const swipeFraction = dy / itemHeight;
      if (Math.abs(swipeFraction) >= 0.25 || Math.abs(velocity) >= 0.3) {
        targetIdx = startIdx + (dy > 0 ? 1 : -1);
      }
      if (targetIdx < 0) targetIdx = 0;
      if (targetIdx >= state.shortsList.length) targetIdx = state.shortsList.length - 1;
      // Synchronous activation inside the gesture context — this is the bit
      // that unlocks autoplay on mobile.
      if (targetIdx !== state.shortsIndex) {
        activateShort(targetIdx, 'scroll');
        // Make sure the scroll lands on it, even if snap was about to revert.
        const target = listEl.querySelector(`.shorts-item[data-index="${targetIdx}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      }
      if (targetIdx >= state.shortsList.length - 5) loadMore();
    };
    listEl.addEventListener('touchend', (e) => {
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      gestureSettle(t ? t.clientY : touchStartY);
    }, { passive: true });
    // Wheel-based scroll on desktop / trackpad: react on the trailing edge.
    let wheelTimer = null;
    listEl.addEventListener('wheel', () => {
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(onScrollSettle, 120);
    }, { passive: true });
  }

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

    const newHtml = newItems
      .map((v, i) => shortsItemHTML(v, startIdx + i, state.shortsList.length))
      .join('');

    listEl.querySelectorAll('.total-count').forEach((el) => {
      el.textContent = state.shortsList.length;
    });
    listEl.insertAdjacentHTML('beforeend', newHtml);

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
