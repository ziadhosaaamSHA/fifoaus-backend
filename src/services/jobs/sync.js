import { getConfig } from "../../config.js";
import {
  countSeenJobListings,
  cleanupJobListings,
  ensureJobListingsTable,
  isDbEnabled,
  listJobListings,
  markJobListingsProcessed,
  markJobListingSeen
} from "../db/jobListings.js";
import { fetchLinkedInFifoJobs } from "./linkedin/scraper.js";
import { fetchSeekFifoJobs } from "./seek/scraper.js";

const SOURCE_CONFIG = {
  linkedin: {
    source: "linkedin:fifo",
    platform: "linkedin",
    fetchJobs: fetchLinkedInFifoJobs,
    getSearchUrl: (cfg) => cfg.LINKEDIN_FIFO_SEARCH_URL,
    getMaxResults: (cfg) => cfg.LINKEDIN_FIFO_MAX_RESULTS
  },
  seek: {
    source: "seek:fifo",
    platform: "seek",
    fetchJobs: fetchSeekFifoJobs,
    getSearchUrl: (cfg) => cfg.SEEK_FIFO_SEARCH_URL,
    getMaxResults: (cfg) => cfg.SEEK_FIFO_MAX_RESULTS
  }
};

function getSourceConfig(source) {
  const config = SOURCE_CONFIG[source];
  if (!config) {
    throw new Error(`unknown_job_source:${source}`);
  }
  return config;
}

export function getJobSourceNames() {
  return Object.keys(SOURCE_CONFIG);
}

export async function syncFifoJobs({
  cfg = getConfig(),
  source,
  searchUrl,
  maxResults
}) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  const sourceConfig = getSourceConfig(source);
  await ensureJobListingsTable();

  const seenBefore = await countSeenJobListings({ source: sourceConfig.source });
  const jobs = await sourceConfig.fetchJobs({
    searchUrl: searchUrl || sourceConfig.getSearchUrl(cfg),
    maxResults: maxResults || sourceConfig.getMaxResults(cfg)
  });

  const newJobs = [];
  for (const job of jobs) {
    const inserted = await markJobListingSeen({
      source: sourceConfig.source,
      externalId: job.externalId,
      title: job.title,
      url: job.url,
      platform: job.platform || sourceConfig.platform,
      matchedKeywords: job.matchedKeywords,
      company: job.company,
      location: job.location,
      workType: job.workType,
      salary: job.salary,
      highlights: job.highlights,
      summary: job.summary,
      listedAt: job.listedAt,
      listedAtUtc: job.listedAtUtc
    });

    if (inserted) {
      newJobs.push(job);
    }
  }

  return {
    source,
    sourceKey: sourceConfig.source,
    scrapedCount: jobs.length,
    newCount: newJobs.length,
    initialSync: seenBefore === 0,
    jobs: newJobs
  };
}

export async function fetchFifoJobsPreview({
  cfg = getConfig(),
  source,
  searchUrl,
  maxResults
}) {
  const sourceConfig = getSourceConfig(source);
  const jobs = await sourceConfig.fetchJobs({
    searchUrl: searchUrl || sourceConfig.getSearchUrl(cfg),
    maxResults: maxResults || sourceConfig.getMaxResults(cfg)
  });

  return {
    source,
    sourceKey: sourceConfig.source,
    scrapedCount: jobs.length,
    jobs
  };
}

export async function syncAllFifoJobs({ cfg = getConfig(), maxResults } = {}) {
  const results = {};
  for (const source of getJobSourceNames()) {
    results[source] = await syncFifoJobs({ cfg, source, maxResults });
  }
  return results;
}

export async function listFifoJobs({ source, status, limit = 20 }) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  await ensureJobListingsTable();
  const sourceConfig = source ? getSourceConfig(source) : null;
  return listJobListings({
    source: sourceConfig?.source,
    status,
    limit
  });
}

export async function markFifoJobsProcessed({ items }) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  await ensureJobListingsTable();
  return markJobListingsProcessed({ items });
}

export async function cleanupFifoJobs({ processedOlderThanDays, pendingOlderThanDays } = {}) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  await ensureJobListingsTable();
  return cleanupJobListings({ processedOlderThanDays, pendingOlderThanDays });
}
