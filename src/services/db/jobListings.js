import { isDbEnabled, query } from "./pool.js";

export { isDbEnabled };

export async function ensureJobListingsTable() {
  if (!isDbEnabled()) return;

  await query(`
    CREATE TABLE IF NOT EXISTS seek_listings_seen (
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT,
      url TEXT NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (source, external_id)
    )
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS platform TEXT
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS matched_keywords TEXT[]
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS company TEXT
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS location TEXT
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS work_type TEXT
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS salary TEXT
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS highlights TEXT[]
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS summary TEXT
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS listed_at TEXT
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS listed_at_utc TEXT
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS listed_at_estimated_at TIMESTAMPTZ
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS payload JSONB
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ
  `);

  await query(`
    ALTER TABLE seek_listings_seen
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ
  `);
}

export async function countSeenJobListings({ source }) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  const { rows } = await query(
    `
    SELECT COUNT(*)::int AS count
    FROM seek_listings_seen
    WHERE source = $1
    `,
    [source]
  );

  return rows[0]?.count || 0;
}

/**
 * Marks a listing as seen. `source` partitions scraper streams, e.g. "seek:fifo"
 * and "linkedin:fifo", while the table name remains SEEK-prefixed for backward
 * compatibility with existing deployments.
 */
export async function markJobListingSeen({
  source,
  externalId,
  title,
  url,
  platform,
  matchedKeywords,
  company,
  location,
  workType,
  salary,
  highlights,
  summary,
  listedAt,
  listedAtUtc,
  listedAtEstimatedAt
}) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  const { rows } = await query(
    `
    INSERT INTO seek_listings_seen (
      source,
      external_id,
      title,
      url,
      platform,
      matched_keywords,
      company,
      location,
      work_type,
      salary,
      highlights,
      summary,
      listed_at,
      listed_at_utc,
      listed_at_estimated_at,
      payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (source, external_id) DO NOTHING
    RETURNING external_id
    `,
    [
      source,
      externalId,
      title || null,
      url,
      platform || null,
      Array.isArray(matchedKeywords) ? matchedKeywords : [],
      company || null,
      location || null,
      workType || null,
      salary || null,
      Array.isArray(highlights) ? highlights : [],
      summary || null,
      listedAt || null,
      listedAtUtc || null,
      listedAtEstimatedAt || null,
      {
        externalId,
        title: title || "",
        company: company || "",
        location: location || "",
        workType: workType || "",
        salary: salary || "",
        highlights: Array.isArray(highlights) ? highlights : [],
        summary: summary || "",
        listedAt: listedAt || "",
        listedAtUtc: listedAtUtc || "",
        listedAtEstimatedAt: listedAtEstimatedAt || "",
        url,
        platform: platform || "",
        matchedKeywords: Array.isArray(matchedKeywords) ? matchedKeywords : []
      }
    ]
  );

  return rows.length > 0;
}

function rowToJob(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    externalId: row.external_id,
    title: row.title || payload.title || "",
    company: row.company || payload.company || "",
    location: row.location || payload.location || "",
    workType: row.work_type || payload.workType || "",
    salary: row.salary || payload.salary || "",
    highlights: Array.isArray(row.highlights) ? row.highlights : payload.highlights || [],
    summary: row.summary || payload.summary || "",
    listedAt: row.listed_at || payload.listedAt || "",
    listedAtUtc: row.listed_at_utc || payload.listedAtUtc || "",
    listedAtEstimatedAt: row.listed_at_estimated_at || payload.listedAtEstimatedAt || "",
    url: row.url || payload.url || "",
    platform: row.platform || payload.platform || "",
    matchedKeywords: Array.isArray(row.matched_keywords)
      ? row.matched_keywords
      : payload.matchedKeywords || [],
    firstSeenAt: row.first_seen_at,
    status: row.status || "pending",
    postedAt: row.posted_at || null,
    processedAt: row.processed_at || null
  };
}

export async function listJobListings({ source, status, limit = 20, minAgeHours, maxAgeHours }) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  const { rows } = await query(
    `
    WITH listings AS (
      SELECT
        *,
        COALESCE(
          listed_at_estimated_at,
          NULLIF(listed_at_utc, '')::timestamptz,
          first_seen_at
        ) AS published_time
      FROM seek_listings_seen
    )
    SELECT *
    FROM listings
    WHERE ($1::text IS NULL OR source = $1)
      AND ($2::text IS NULL OR status = $2)
      AND ($3::numeric IS NULL OR published_time <= NOW() - ($3::numeric * INTERVAL '1 hour'))
      AND ($4::numeric IS NULL OR published_time >= NOW() - ($4::numeric * INTERVAL '1 hour'))
    ORDER BY published_time DESC, first_seen_at DESC
    LIMIT $5
    `,
    [source || null, status || null, minAgeHours ?? null, maxAgeHours ?? null, limit]
  );

  return rows.map(rowToJob);
}

export async function markJobListingsProcessed({ items }) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  const normalizedItems = items.map((item) => ({
    source: item.source,
    external_id: item.externalId
  }));

  const { rows } = await query(
    `
    WITH input AS (
      SELECT *
      FROM jsonb_to_recordset($1::jsonb) AS x(source TEXT, external_id TEXT)
    )
    UPDATE seek_listings_seen AS listing
    SET
      status = 'processed',
      processed_at = NOW()
    FROM input
    WHERE listing.source = input.source
      AND listing.external_id = input.external_id
    RETURNING listing.external_id
    `,
    [JSON.stringify(normalizedItems)]
  );

  return rows.length;
}

export async function cleanupJobListings({
  processedOlderThanDays = 14,
  pendingOlderThanDays = 30
} = {}) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  const processedResult = await query(
    `
    DELETE FROM seek_listings_seen
    WHERE status = 'processed'
      AND processed_at < NOW() - ($1::int * INTERVAL '1 day')
    RETURNING external_id
    `,
    [processedOlderThanDays]
  );

  const pendingResult = await query(
    `
    DELETE FROM seek_listings_seen
    WHERE status = 'pending'
      AND first_seen_at < NOW() - ($1::int * INTERVAL '1 day')
    RETURNING external_id
    `,
    [pendingOlderThanDays]
  );

  const processedDeletedCount = processedResult.rows.length;
  const pendingDeletedCount = pendingResult.rows.length;

  return {
    processedDeletedCount,
    pendingDeletedCount,
    deletedCount: processedDeletedCount + pendingDeletedCount
  };
}
