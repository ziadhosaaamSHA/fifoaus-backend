import express from "express";
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

const sourceSchema = z.enum(["seek", "linkedin"]);
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

export function createContentApiApp() {
  const cfg = getContentApiConfig();
  const app = express();

  app.set("trust proxy", 1);
  app.use(express.json());

  app.get("/health", (_req, res) =>
    res.status(200).json({
      ok: true,
      service: "content-api",
      database: isDbEnabled() ? "configured" : "missing"
    })
  );

  const api = express.Router();
  api.use(requireApiToken(cfg));

  api.get("/jobs/sources", (_req, res) => {
    res.status(200).json({ sources: getJobSourceNames() });
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
    asyncRoute(async (req, res) => {
      const source = sourceSchema.parse(req.params.source);
      const maxResults = maxResultsSchema.parse(req.query.maxResults);
      const result = await fetchFifoJobsPreview({ cfg, source, maxResults });

      res.status(200).json(result);
    })
  );

  api.post(
    "/jobs/sync",
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
    asyncRoute(async (req, res) => {
      const source = sourceSchema.parse(req.params.source);
      const maxResults = maxResultsSchema.parse(req.query.maxResults ?? req.body?.maxResults);
      const result = await syncFifoJobs({ cfg, source, maxResults });

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

    console.error("[content-api] unhandled error", err);
    return res.status(500).json({ error: "internal_error" });
  });

  return app;
}
