import express from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { getContentApiConfig } from "../../config.js";
import { isDbEnabled } from "../db/jobListings.js";
import {
  cleanupFifoJobs,
  fetchFifoJobsPreview,
  getJobSourceNames,
  listFifoJobs,
  markFifoJobsProcessed,
  syncAllFifoJobs,
  syncFifoJobs
} from "../jobs/sync.js";
import {
  cleanupNews,
  fetchNewsPreview,
  getNewsSourceNames,
  listNews,
  markNewsProcessed,
  syncAllNews,
  syncNews
} from "../news/sync.js";

const sourceSchema = z.enum(["seek", "linkedin"]);
const newsSourceSchema = z.enum([
  "abc-news",
  "australian-mining",
  "australian-mining-review",
  "guardian-au",
  "industry-qld",
  "mining-com",
  "mining-magazine-au",
  "mining-technology",
  "paydirt"
]);
const statusSchema = z.enum(["pending", "processed", "expired"]);
const limitSchema = z.coerce.number().int().positive().max(100).default(20);
const maxResultsSchema = z.coerce.number().int().positive().max(25).optional();
const markProcessedBodySchema = z.object({
  items: z
    .array(
      z.object({
        source: z.string().min(1),
        externalId: z.string().min(1)
      })
    )
    .min(1)
    .max(100)
});
const cleanupBodySchema = z
  .object({
    processedOlderThanDays: z.coerce.number().int().positive().max(365).optional(),
    pendingOlderThanDays: z.coerce.number().int().positive().max(365).optional()
  })
  .optional();

function getBearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || req.get("x-api-key") || "";
}

function requireApiToken(cfg) {
  return (req, res, next) => {
    if (!cfg.CONTENT_API_TOKEN) {
      return next();
    }

    if (getBearerToken(req) !== cfg.CONTENT_API_TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }

    return next();
  };
}

const asyncRoute =
  (fn) =>
    (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };

function parseNewsSources(value) {
  if (!value) return [];

  return String(value)
    .split(",")
    .map((source) =>
      source
        .trim()
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .replace(/^['"]/, "")
        .replace(/['"]$/, "")
        .replace(/^[A-Z_]+=/, "")
        .trim()
    )
    .filter(Boolean)
    .map((source) => newsSourceSchema.parse(source));
}

function sortNewsItemsNewestFirst(items) {
  return [...items].sort((a, b) => {
    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bTime - aTime;
  });
}

function combineNewsResults({ sources, results }) {
  const items = sortNewsItemsNewestFirst(results.flatMap((result) => result.items || []));

  return {
    source: sources.join(","),
    sources,
    scrapedCount: results.reduce((count, result) => count + (result.scrapedCount || 0), 0),
    newCount: results.reduce((count, result) => count + (result.newCount || 0), 0),
    items,
    results
  };
}

export function createContentApiApp() {
  const cfg = getContentApiConfig();
  const app = express();

  app.set("trust proxy", 1);
  app.use(express.json());

  // General rate limiter for all /api routes
  const generalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" }
  });

  // Strict limiter for expensive sync/scrape endpoints
  const syncLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_sync_requests" }
  });

  app.get("/health", (_req, res) =>
    res.status(200).json({
      ok: true,
      service: "content-api",
      database: isDbEnabled() ? "configured" : "missing"
    })
  );

  const api = express.Router();
  api.use(generalLimiter);
  api.use(requireApiToken(cfg));

  api.get("/jobs/sources", (_req, res) => {
    res.status(200).json({ sources: getJobSourceNames() });
  });

  api.get("/news/sources", (_req, res) => {
    res.status(200).json({ sources: getNewsSourceNames() });
  });

  api.get(
    "/jobs",
    asyncRoute(async (req, res) => {
      const source = req.query.source ? sourceSchema.parse(req.query.source) : undefined;
      const status = req.query.status ? statusSchema.parse(req.query.status) : undefined;
      const limit = limitSchema.parse(req.query.limit);
      const jobs = await listFifoJobs({ source, status, limit });

      res.status(200).json({
        jobs,
        count: jobs.length
      });
    })
  );

  api.get(
    "/jobs/fetch/:source",
    syncLimiter,
    asyncRoute(async (req, res) => {
      const source = sourceSchema.parse(req.params.source);
      const maxResults = maxResultsSchema.parse(req.query.maxResults);
      const result = await fetchFifoJobsPreview({ cfg, source, maxResults });

      res.status(200).json(result);
    })
  );

  api.post(
    "/jobs/sync",
    syncLimiter,
    asyncRoute(async (req, res) => {
      const maxResults = maxResultsSchema.parse(req.query.maxResults ?? req.body?.maxResults);
      const results = await syncAllFifoJobs({ cfg, maxResults });

      res.status(200).json({
        results
      });
    })
  );

  api.post(
    "/jobs/mark-processed",
    asyncRoute(async (req, res) => {
      const { items } = markProcessedBodySchema.parse(req.body);
      const updatedCount = await markFifoJobsProcessed({ items });

      res.status(200).json({ updatedCount });
    })
  );

  api.post(
    "/jobs/cleanup",
    asyncRoute(async (req, res) => {
      const cleanupOptions = cleanupBodySchema.parse(req.body) || {};
      const result = await cleanupFifoJobs(cleanupOptions);

      res.status(200).json(result);
    })
  );

  api.post(
    "/jobs/sync/:source",
    syncLimiter,
    asyncRoute(async (req, res) => {
      const source = sourceSchema.parse(req.params.source);
      const maxResults = maxResultsSchema.parse(req.query.maxResults ?? req.body?.maxResults);
      const result = await syncFifoJobs({ cfg, source, maxResults });

      res.status(200).json(result);
    })
  );

  api.get(
    "/news",
    asyncRoute(async (req, res) => {
      const sources = parseNewsSources(req.query.source);
      const status = req.query.status ? statusSchema.parse(req.query.status) : undefined;
      const limit = limitSchema.parse(req.query.limit);
      const items =
        sources.length > 0
          ? sortNewsItemsNewestFirst(
              (
                await Promise.all(
                  sources.map((source) => listNews({ source, status, limit }))
                )
              ).flat()
            ).slice(0, limit)
          : await listNews({ status, limit });

      res.status(200).json({
        items,
        count: items.length
      });
    })
  );

  api.get(
    "/news/fetch/:source",
    asyncRoute(async (req, res) => {
      const sources = parseNewsSources(req.params.source);
      const maxResults = maxResultsSchema.parse(req.query.maxResults);
      const results = await Promise.all(
        sources.map((source) => fetchNewsPreview({ source, maxResults }))
      );
      const result =
        results.length === 1 ? results[0] : combineNewsResults({ sources, results });

      res.status(200).json(result);
    })
  );

  api.post(
    "/news/sync",
    asyncRoute(async (req, res) => {
      const maxResults = maxResultsSchema.parse(req.query.maxResults ?? req.body?.maxResults);
      const results = await syncAllNews({ maxResults });

      res.status(200).json({ results });
    })
  );

  api.post(
    "/news/sync/:source",
    asyncRoute(async (req, res) => {
      const sources = parseNewsSources(req.params.source);
      const maxResults = maxResultsSchema.parse(req.query.maxResults ?? req.body?.maxResults);
      const results = await Promise.all(
        sources.map((source) => syncNews({ source, maxResults }))
      );
      const result =
        results.length === 1 ? results[0] : combineNewsResults({ sources, results });

      res.status(200).json(result);
    })
  );

  api.post(
    "/news/mark-processed",
    asyncRoute(async (req, res) => {
      const { items } = markProcessedBodySchema.parse(req.body);
      const updatedCount = await markNewsProcessed({ items });

      res.status(200).json({ updatedCount });
    })
  );

  api.post(
    "/news/cleanup",
    asyncRoute(async (req, res) => {
      const cleanupOptions = cleanupBodySchema.parse(req.body) || {};
      const result = await cleanupNews(cleanupOptions);

      res.status(200).json(result);
    })
  );

  app.use("/api", api);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err?.issues) {
      console.warn("[content-api] invalid request", err.issues);
      return res.status(400).json({
        error: "invalid_request",
        issues: err.issues
      });
    }
    if (err?.message === "database_not_configured") {
      console.warn("[content-api] database not configured for DB-backed route");
      return res.status(503).json({ error: "database_not_configured" });
    }
    if (err?.message?.startsWith("unknown_job_source:")) {
      console.warn("[content-api] unknown job source", err.message);
      return res.status(404).json({ error: err.message });
    }
    if (err?.message?.startsWith("unknown_news_source:")) {
      console.warn("[content-api] unknown news source", err.message);
      return res.status(404).json({ error: err.message });
    }
    if (err?.status >= 400 && err?.status < 600) {
      console.warn("[content-api] upstream fetch failed", err.message);
      return res.status(502).json({
        error: "upstream_fetch_failed",
        message: err.message
      });
    }

    console.error("[content-api] unhandled error", err);
    return res.status(500).json({ error: "internal_error" });
  });

  return app;
}
