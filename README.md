# FocusTube

A distraction-free YouTube Shorts player. Search any topic, watch only what you came for — no infinite feed, no recommendations sidebar, no redirects to youtube.com.

## Features

- Search YouTube via your own Data API v3 key (proxied through the backend so the key never reaches the browser)
- Results filtered to **shorts only** (videos ≤ 60 seconds)
- Filter chips: All Shorts · Under 30s · Under 60s · Most Viewed · Recent
- Saved topics persist in `localStorage`
- Inline player using the YouTube IFrame API — no leaving the page
- Bookmark videos (stored in `localStorage`)
- Mobile responsive

## Tech

- **Backend:** Node.js + Express, acts as a thin proxy to the YouTube Data API
- **Frontend:** Vanilla HTML / CSS / JavaScript (no build step)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the env template and add your key
cp .env.example .env
#   then edit .env and set YOUTUBE_API_KEY=...

# 3. Run
npm start
# or for auto-reload during development:
npm run dev
```

Open <http://localhost:3000>.

## Getting a YouTube API key

1. Go to <https://console.cloud.google.com/apis/credentials>
2. Create a project (or pick one)
3. Enable **YouTube Data API v3** under *APIs & Services › Library*
4. Create an API key under *Credentials*
5. Paste it into your `.env` as `YOUTUBE_API_KEY=...`

> The free quota is 10,000 units/day. Each search uses ~101 units (1 search + 1 videos lookup), so you get ~99 searches/day before hitting the cap.

## API

### `GET /api/search?q=<query>&order=<order>`

Proxies a search to the YouTube Data API and returns only results ≤ 60 seconds.

- `q` — required, search string
- `order` — optional, one of `relevance` (default), `date`, `viewCount`, `rating`, `title`

Response:

```json
{
  "items": [
    {
      "id": "abc123",
      "title": "Perfect biryani in 45 seconds",
      "channelTitle": "...",
      "publishedAt": "2026-04-01T12:00:00Z",
      "thumbnail": "https://i.ytimg.com/...",
      "durationSeconds": 45,
      "viewCount": 2100000
    }
  ]
}
```

## Security

- API key lives only in `.env` on the server. The browser never sees it.
- The frontend talks exclusively to `/api/search`, never to `googleapis.com`.
- `.env` is gitignored. **Do not commit your real key — `.env.example` is for placeholders only.**

## Project layout

```
.
├── server.js          # Express backend / API proxy
├── package.json
├── .env.example       # Template — copy to .env and fill in
├── .gitignore
└── public/
    ├── index.html     # UI
    ├── styles.css
    └── app.js         # Search, filters, player, bookmarks
```
