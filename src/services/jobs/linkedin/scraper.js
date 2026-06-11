import { findFifoKeywordMatches } from "../helpers/filters.js";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const PLATFORM = "linkedin";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(value = "") {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value = "") {
  return value.replace(/<[^>]+>/g, " ");
}

function cleanText(value = "") {
  return decodeHtmlEntities(stripTags(value)).replace(/\s+/g, " ").trim();
}

function extractText(block, regex) {
  return cleanText(block.match(regex)?.[1] || "");
}

function extractAttribute(block, regex) {
  return decodeHtmlEntities(block.match(regex)?.[1] || "").trim();
}

function extractExternalId(url) {
  return (
    url.match(/-(\d+)(?:\?|$)/)?.[1] ||
    url.match(/\/view\/[^"/?]*(\d+)(?:\?|$)/)?.[1] ||
    url
  );
}

function normalizeLinkedInUrl(url) {
  if (!url) return null;
  return url.startsWith("http") ? url : new URL(url, "https://www.linkedin.com").toString();
}

function createJobFromBlock(block) {
  const url = normalizeLinkedInUrl(
    extractAttribute(block, /<a\b[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/i)
  );
  const title = extractText(
    block,
    /<h3\b[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i
  );
  const company = extractText(
    block,
    /<h4\b[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i
  );
  const location = extractText(
    block,
    /<span\b[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i
  );
  const timeMatch = block.match(
    /<time\b[^>]*class="[^"]*job-search-card__listdate[^"]*"[^>]*datetime="([^"]+)"[^>]*>([\s\S]*?)<\/time>/i
  );
  const listedAtUtc = decodeHtmlEntities(timeMatch?.[1] || "").trim();
  const listedAt = cleanText(timeMatch?.[2] || listedAtUtc);

  if (!url || !title) return null;

  const job = {
    externalId: extractExternalId(url),
    title,
    company,
    location,
    workType: "",
    salary: "",
    highlights: [],
    summary: "",
    listedAt,
    listedAtUtc,
    url,
    platform: PLATFORM,
    matchedKeywords: []
  };

  job.matchedKeywords = findFifoKeywordMatches(job);
  return job;
}

function listedAtSortTime(job) {
  const listedAt = job.listedAt.toLowerCase();
  const relativeMatch = listedAt.match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(minute|minutes|hour|hours|day|days)\s+ago$/);
  const words = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12
  };

  if (relativeMatch) {
    const amount = words[relativeMatch[1]] || Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    const multiplier = unit.startsWith("minute")
      ? 60 * 1000
      : unit.startsWith("hour")
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
    return Date.now() - amount * multiplier;
  }

  return job.listedAtUtc ? Date.parse(job.listedAtUtc) : 0;
}

export function extractJobsFromHtml(html) {
  const jobs = [];
  const seenIds = new Set();
  const cardRegex =
    /<(?:li|div)\b[^>]*class="[^"]*(?:jobs-search__results-list|base-card|job-search-card)[^"]*"[^>]*>[\s\S]*?<a\b[^>]*class="[^"]*base-card__full-link[^"]*"[\s\S]*?<\/(?:li|div)>/gi;

  for (const match of html.matchAll(cardRegex)) {
    const job = createJobFromBlock(match[0]);
    if (!job || seenIds.has(job.externalId)) continue;
    seenIds.add(job.externalId);
    jobs.push(job);
  }

  if (jobs.length > 0) return jobs;

  const fallbackRegex =
    /<a\b[^>]*class="[^"]*base-card__full-link[^"]*"[\s\S]*?(?=<a\b[^>]*class="[^"]*base-card__full-link|$)/gi;
  for (const match of html.matchAll(fallbackRegex)) {
    const job = createJobFromBlock(match[0]);
    if (!job || seenIds.has(job.externalId)) continue;
    seenIds.add(job.externalId);
    jobs.push(job);
  }

  return jobs;
}

async function fetchLinkedInPage({ searchUrl, fetchImpl }) {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-AU,en;q=0.9"
        }
      });

      if (!response.ok) {
        const error = new Error(`LinkedIn returned ${response.status}`);
        error.status = response.status;
        throw error;
      }

      return await response.text();
    } catch (err) {
      lastError = err;
      const status = err?.status;
      const shouldRetry = attempt < maxAttempts && RETRYABLE_STATUS_CODES.has(status);

      if (!shouldRetry) {
        throw err;
      }

      const backoffMs = attempt * 1500;
      console.warn(
        `[linkedin] fetch attempt ${attempt} failed with ${status}, retrying in ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

export async function fetchLinkedInFifoJobs({ searchUrl, maxResults, fetchImpl = fetch }) {
  const html = await fetchLinkedInPage({ searchUrl, fetchImpl });
  return extractJobsFromHtml(html)
    .filter((job) => job.matchedKeywords.length > 0)
    .sort((a, b) => {
      return listedAtSortTime(b) - listedAtSortTime(a);
    })
    .slice(0, maxResults);
}
