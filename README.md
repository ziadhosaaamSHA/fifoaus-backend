# FIFO AUS Content API

Standalone Node/Express API for content ingestion and retrieval.

## Railway

Use this directory as the Railway service root and run:

```bash
npm start
```

## Endpoints

```http
GET /health
GET /api/jobs
GET /api/jobs?source=seek&limit=20
GET /api/jobs?source=linkedin&limit=20
GET /api/jobs/sources
GET /api/jobs/fetch/:source
POST /api/jobs/sync
POST /api/jobs/sync/seek
POST /api/jobs/sync/linkedin
POST /api/jobs/mark-processed
POST /api/jobs/cleanup

GET /api/news
GET /api/news?source=australian-mining-review&limit=20
GET /api/news?status=pending
GET /api/news/sources
GET /api/news/fetch/:source
POST /api/news/sync
POST /api/news/sync/:source
POST /api/news/mark-processed
POST /api/news/cleanup
```

Set `CONTENT_API_TOKEN` to protect `/api/*` routes. The consumer app should use the same token.

`processed` is a global lifecycle status for storage cleanup, not a per-channel
delivery marker. Consumers decide when an item is safe to retire globally.

Initial RSS news sources:

- `abc-news`
- `australian-mining`
- `australian-mining-review`
- `guardian-au`
- `industry-qld`
- `mining-com`
- `mining-magazine-au`
- `mining-technology`
- `paydirt`

News items use the same broad lifecycle model as jobs: `pending`, `processed`,
and `expired`. RSS fetch endpoints return normalized previews without writing to
the database; sync endpoints persist only newly seen items.
