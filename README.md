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
```

Set `CONTENT_API_TOKEN` to protect `/api/*` routes. The consumer app should use the same token.

`processed` is a global lifecycle status for storage cleanup, not a per-channel
delivery marker. Consumers decide when an item is safe to retire globally.
