require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.YOUTUBE_API_KEY;

if (!API_KEY) {
  console.warn(
    '[FocusTube] Warning: YOUTUBE_API_KEY is not set. ' +
      'Copy .env.example to .env and add your key — the /api/search endpoint will return 500 until you do.'
  );
}

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const YT_SEARCH = 'https://www.googleapis.com/youtube/v3/search';
const YT_VIDEOS = 'https://www.googleapis.com/youtube/v3/videos';

// Parse ISO 8601 duration (e.g. PT1M5S) to seconds.
function isoDurationToSeconds(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, h, mi, s] = m;
  return (parseInt(h || 0, 10) * 3600) + (parseInt(mi || 0, 10) * 60) + parseInt(s || 0, 10);
}

const { createClient } = require('redis');

const memoryCache = new Map();
const CACHE_TTL_REDIS = 60 * 60; // 1 hour in seconds
const CACHE_TTL_MS = CACHE_TTL_REDIS * 1000;

let redisClient = null;
let useRedis = false;

(async () => {
  const client = createClient({
    url: process.env.KV_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379'
  });

  client.on('error', (err) => {
    console.warn('[FocusTube] Redis error/unavailable, falling back to in-memory cache.', err.message);
    useRedis = false;
  });

  try {
    await client.connect();
    redisClient = client;
    useRedis = true;
    console.log('[FocusTube] Connected to Redis caching.');
  } catch (err) {
    console.warn('[FocusTube] Could not connect to Redis, falling back to in-memory cache.');
    useRedis = false;
  }
})();

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing query parameter "q".' });
  if (!API_KEY) return res.status(500).json({ error: 'Server is missing YOUTUBE_API_KEY.' });

  const order = ['relevance', 'date', 'viewCount', 'rating', 'title'].includes(req.query.order)
    ? req.query.order
    : 'relevance';

  const pageToken = (req.query.pageToken || '').toString().trim();
  const cacheKey = `${q.toLowerCase()}-${order}-${pageToken}`;
  if (useRedis && redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        console.log(`[FocusTube] Serving "${q}" (page ${pageToken || '1'}) from Redis`);
        const parsed = JSON.parse(cached);
        return res.json({ items: parsed.items, nextPageToken: parsed.nextPageToken });
      }
    } catch (err) {
      console.warn('[FocusTube] Redis GET error:', err.message);
    }
  } else {
    if (memoryCache.has(cacheKey)) {
      const cached = memoryCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        console.log(`[FocusTube] Serving "${q}" (page ${pageToken || '1'}) from memory cache`);
        return res.json({ items: cached.items, nextPageToken: cached.nextPageToken });
      }
    }
  }

  try {
    const searchUrl = new URL(YT_SEARCH);
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', q);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('videoDuration', 'short'); // < 4 min — we'll narrow to <60s next
    searchUrl.searchParams.set('maxResults', '40');
    if (pageToken) searchUrl.searchParams.set('pageToken', pageToken);
    searchUrl.searchParams.set('order', order);
    searchUrl.searchParams.set('safeSearch', 'moderate');
    searchUrl.searchParams.set('key', API_KEY);

    const searchResp = await fetch(searchUrl);
    if (!searchResp.ok) {
      const text = await searchResp.text();
      return res.status(searchResp.status).json({ error: 'YouTube search failed.', detail: text });
    }
    const searchData = await searchResp.json();
    const ids = (searchData.items || [])
      .map((item) => item.id && item.id.videoId)
      .filter(Boolean);

    if (ids.length === 0) return res.json({ items: [], nextPageToken: searchData.nextPageToken });

    const videosUrl = new URL(YT_VIDEOS);
    videosUrl.searchParams.set('part', 'snippet,contentDetails,statistics');
    videosUrl.searchParams.set('id', ids.join(','));
    videosUrl.searchParams.set('key', API_KEY);

    const videosResp = await fetch(videosUrl);
    if (!videosResp.ok) {
      const text = await videosResp.text();
      return res.status(videosResp.status).json({ error: 'YouTube videos lookup failed.', detail: text });
    }
    const videosData = await videosResp.json();

    const items = (videosData.items || [])
      .map((v) => {
        const seconds = isoDurationToSeconds(v.contentDetails && v.contentDetails.duration);
        const thumbs = (v.snippet && v.snippet.thumbnails) || {};
        const thumb = thumbs.medium || thumbs.high || thumbs.default || {};
        return {
          id: v.id,
          title: v.snippet.title,
          channelTitle: v.snippet.channelTitle,
          publishedAt: v.snippet.publishedAt,
          thumbnail: thumb.url,
          durationSeconds: seconds,
          viewCount: parseInt((v.statistics && v.statistics.viewCount) || '0', 10),
        };
      })
      .filter((v) => v.durationSeconds > 0 && v.durationSeconds <= 60);

    const responseData = { items, nextPageToken: searchData.nextPageToken };
    
    if (useRedis && redisClient) {
      try {
        await redisClient.setEx(cacheKey, CACHE_TTL_REDIS, JSON.stringify(responseData));
      } catch (err) {
        console.warn('[FocusTube] Redis SET error:', err.message);
      }
    } else {
      memoryCache.set(cacheKey, { ...responseData, timestamp: Date.now() });
    }

    res.json(responseData);
  } catch (err) {
    console.error('[FocusTube] /api/search error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FocusTube running at http://localhost:${PORT}`);
  });
}

module.exports = app;
