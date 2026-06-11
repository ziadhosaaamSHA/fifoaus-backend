import { isDbEnabled, query } from "./pool.js";

export { isDbEnabled };

export async function ensureNewsItemsTable() {
  if (!isDbEnabled()) return;

  await query(`
    CREATE TABLE IF NOT EXISTS news_items (
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      url TEXT NOT NULL,
      publisher TEXT,
      published_at TIMESTAMPTZ,
      tags TEXT[],
      matched_keywords TEXT[],
      payload JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      PRIMARY KEY (source, external_id)
    )
  `);
}

function rowToNewsItem(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    externalId: row.external_id,
    source: row.source,
    title: row.title || payload.title || "",
    summary: row.summary || payload.summary || "",
    url: row.url || payload.url || "",
    publisher: row.publisher || payload.publisher || "",
    publishedAt: row.published_at || payload.publishedAt || "",
    tags: Array.isArray(row.tags) ? row.tags : payload.tags || [],
    matchedKeywords: Array.isArray(row.matched_keywords)
      ? row.matched_keywords
      : payload.matchedKeywords || [],
    status: row.status || "pending",
    firstSeenAt: row.first_seen_at,
    processedAt: row.processed_at || null
  };
}

export async function markNewsItemSeen({
  source,
  externalId,
  title,
  summary,
  url,
  publisher,
  publishedAt,
  tags,
  matchedKeywords
}) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  const payload = {
    externalId,
    source,
    title: title || "",
    summary: summary || "",
    url,
    publisher: publisher || "",
    publishedAt: publishedAt || "",
    tags: Array.isArray(tags) ? tags : [],
    matchedKeywords: Array.isArray(matchedKeywords) ? matchedKeywords : []
  };

  const { rows } = await query(
    `
    INSERT INTO news_items (
      source,
      external_id,
      title,
      summary,
      url,
      publisher,
      published_at,
      tags,
      matched_keywords,
      payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (source, external_id) DO NOTHING
    RETURNING external_id
    `,
    [
      source,
      externalId,
      title || "",
      summary || null,
      url,
      publisher || null,
      publishedAt || null,
      Array.isArray(tags) ? tags : [],
      Array.isArray(matchedKeywords) ? matchedKeywords : [],
      payload
    ]
  );

  return rows.length > 0;
}

export async function listNewsItems({ source, status, limit = 20 }) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  const { rows } = await query(
    `
    SELECT *
    FROM news_items
    WHERE ($1::text IS NULL OR source = $1)
      AND ($2::text IS NULL OR status = $2)
    ORDER BY COALESCE(published_at, first_seen_at) DESC, first_seen_at DESC
    LIMIT $3
    `,
    [source || null, status || null, limit]
  );

  return rows.map(rowToNewsItem);
}

export async function markNewsItemsProcessed({ items }) {
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
    UPDATE news_items AS item
    SET
      status = 'processed',
      processed_at = NOW()
    FROM input
    WHERE item.source = input.source
      AND item.external_id = input.external_id
    RETURNING item.external_id
    `,
    [JSON.stringify(normalizedItems)]
  );

  return rows.length;
}

export async function cleanupNewsItems({
  processedOlderThanDays = 14,
  pendingOlderThanDays = 30
} = {}) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  const processedResult = await query(
    `
    DELETE FROM news_items
    WHERE status = 'processed'
      AND processed_at < NOW() - ($1::int * INTERVAL '1 day')
    RETURNING external_id
    `,
    [processedOlderThanDays]
  );

  const pendingResult = await query(
    `
    DELETE FROM news_items
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
