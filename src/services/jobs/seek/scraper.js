import { findFifoKeywordMatches } from "../helpers/filters.js";

const SEEK_BASE_URL = "https://au.seek.com";
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const PLATFORM = "seek";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(value) {
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

function stripTags(value) {
  return value.replace(/<[^>]+>/g, "\n");
}

function htmlToLines(html) {
  return decodeHtmlEntities(stripTags(html))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractJobLinks(html) {
  const jobLinks = [];
  const seen = new Set();
  const regex = /href="([^"]*\/job\/\d+[^"]*)"/g;

  for (const match of html.matchAll(regex)) {
    const rawUrl = decodeHtmlEntities(match[1]);
    const absoluteUrl = new URL(rawUrl, SEEK_BASE_URL).toString();

    if (!absoluteUrl.includes("/job/")) continue;
    if (seen.has(absoluteUrl)) continue;

    seen.add(absoluteUrl);
    jobLinks.push({
      url: absoluteUrl,
      externalId: absoluteUrl.match(/\/job\/(\d+)/)?.[1] || absoluteUrl
    });
  }

  return jobLinks;
}

function isNoiseLine(line) {
  return (
    line === "Featured" ||
    line === "New" ||
    line === "New to you" ||
    line === "Done" ||
    line === "Modify my search" ||
    line === "Select a job" ||
    line === "Display details here" ||
    line === "Image"
  );
}

function isJobBoundary(line) {
  return line === "###";
}

function isRelativeTime(line) {
  return /(?:\d+\s*(?:m|h|d)|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:minute|minutes|hour|hours|day|days)\s+ago$/i.test(
    line
  );
}

function extractJobsFromLines(lines) {
  const jobs = [];
  const startIndex = lines.findIndex((line) => /^\d[\d,]* jobs$/i.test(line));
  const scanFrom = startIndex >= 0 ? startIndex + 1 : 0;

  for (let index = scanFrom; index < lines.length; index += 1) {
    if (!isJobBoundary(lines[index])) continue;

    let cursor = index + 1;
    while (cursor < lines.length && isNoiseLine(lines[cursor])) {
      cursor += 1;
    }

    const title = lines[cursor];
    if (!title || isJobBoundary(title)) continue;

    cursor += 1;

    let company = "";
    if (lines[cursor] === "at") {
      company = lines[cursor + 1] || "";
      cursor += 2;
    } else if (lines[cursor]?.startsWith("at ")) {
      company = lines[cursor].slice(3).trim();
      cursor += 1;
    }

    while (cursor < lines.length && !/^This is a /i.test(lines[cursor]) && !isJobBoundary(lines[cursor])) {
      cursor += 1;
    }
    if (cursor >= lines.length || isJobBoundary(lines[cursor])) continue;

    const workType = lines[cursor];
    const location = lines[cursor + 1] || "";
    cursor += 2;

    let salary = "";
    if (
      lines[cursor] &&
      !lines[cursor].startsWith("*") &&
      !lines[cursor].startsWith("subClassification:") &&
      !lines[cursor].startsWith("classification:") &&
      !isRelativeTime(lines[cursor]) &&
      !lines[cursor].startsWith("Listed ")
    ) {
      salary = lines[cursor];
      cursor += 1;
    }

    const highlights = [];
    while (cursor < lines.length && lines[cursor].startsWith("*")) {
      highlights.push(lines[cursor].replace(/^\*\s*/, ""));
      cursor += 1;
    }

    let summary = "";
    while (cursor < lines.length && !isJobBoundary(lines[cursor])) {
      const currentLine = lines[cursor];
      if (
        currentLine.startsWith("subClassification:") ||
        currentLine.startsWith("classification:") ||
        isRelativeTime(currentLine) ||
        currentLine.startsWith("Listed ")
      ) {
        break;
      }
      if (!summary && !isNoiseLine(currentLine)) {
        summary = currentLine;
      }
      cursor += 1;
    }

    let listedAt = "";
    while (cursor < lines.length && !isJobBoundary(lines[cursor])) {
      if (lines[cursor].startsWith("Listed ")) {
        listedAt = lines[cursor];
        break;
      }
      if (!listedAt && isRelativeTime(lines[cursor])) {
        listedAt = lines[cursor];
      }
      cursor += 1;
    }

    jobs.push({
      title,
      company,
      location,
      workType,
      salary,
      highlights,
      summary,
      listedAt
    });
  }

  return jobs;
}

function mergeJobs(textJobs, linkJobs) {
  const merged = [];
  const seenIds = new Set();

  for (let index = 0; index < textJobs.length; index += 1) {
    const job = textJobs[index];
    const link = linkJobs[index];
    const externalId = link?.externalId || `${job.title}:${job.company}:${job.location}`;

    if (seenIds.has(externalId)) continue;
    seenIds.add(externalId);

    merged.push({
      ...job,
      externalId,
      url: link?.url || null
    });
  }

  return merged.filter((job) => job.url);
}

function escapeJsonStringFragment(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function decodeJsonString(value) {
  return decodeHtmlEntities(JSON.parse(`"${escapeJsonStringFragment(value)}"`));
}

function parseJsonStringArray(rawArray) {
  return JSON.parse(`[${rawArray}]`).map((value) =>
    typeof value === "string" ? decodeHtmlEntities(value) : value
  );
}

function normalizeJob(job) {
  const matchedKeywords = findFifoKeywordMatches(job);

  return {
    title: job.title || "",
    company: job.company || "",
    location: job.location || "",
    workType: job.workType || "",
    salary: job.salary || "",
    highlights: Array.isArray(job.highlights) ? job.highlights : [],
    summary: job.summary || "",
    listedAt: job.listedAt || "",
    listedAtUtc: job.listedAtUtc || "",
    externalId: job.externalId,
    url: job.url,
    platform: PLATFORM,
    matchedKeywords
  };
}

function extractJobsFromStructuredData(html) {
  const structuredJobs = [];
  const seenIds = new Set();
  const regex =
    /"JobSearchV6Data:\{\\"id\\":\\"(?<id>\d+)\\",\\"tracking\\":\\"(?<tracking>.*?)\\"\}":\{(?<payload>.*?)\},"JobSearchV6/gs;

  for (const match of html.matchAll(regex)) {
    const { id, payload } = match.groups || {};
    if (!id || !payload || seenIds.has(id)) continue;

    const title = payload.match(/"title":"(.*?)"/)?.[1];
    const company = payload.match(/"companyName":"(.*?)"/)?.[1];
    const location = payload.match(/"locations":\[\{"__typename":"JobSearchV6DataLocation","countryCode":"AU","label":"(.*?)"/)?.[1];
    const salary = payload.match(/"salaryLabel":"(.*?)"/)?.[1];
    const summary = payload.match(/"teaser":"(.*?)"/)?.[1];
    const sectionRank = Number(payload.match(/"sectionRank":(\d+)/)?.[1] || Number.MAX_SAFE_INTEGER);
    const listedAt = payload.match(/"label\(\{\\.*?\}\)":"(.*?)"/)?.[1];
    const listedAtUtc = payload.match(/"dateTimeUtc":"(.*?)"/)?.[1];

    const workTypesMatch = payload.match(/"workTypes":\[(.*?)\]/);
    const workType = workTypesMatch ? parseJsonStringArray(workTypesMatch[1]).join(", ") : "";

    const bulletPointsMatch = payload.match(/"bulletPoints":\[(.*?)\]/);
    const highlights = bulletPointsMatch ? parseJsonStringArray(bulletPointsMatch[1]) : [];

    if (!title) continue;
    seenIds.add(id);

    structuredJobs.push({
      sortRank: sectionRank,
      job: normalizeJob({
        externalId: id,
        title: decodeJsonString(title),
        company: company ? decodeJsonString(company) : "",
        location: location ? decodeJsonString(location) : "",
        workType,
        salary: salary ? decodeJsonString(salary) : "",
        highlights,
        summary: summary ? decodeJsonString(summary) : "",
        listedAt: listedAt ? decodeJsonString(listedAt) : "",
        listedAtUtc: listedAtUtc ? decodeJsonString(listedAtUtc) : "",
        url: `${SEEK_BASE_URL}/job/${id}`
      })
    });
  }

  return structuredJobs
    .sort((a, b) => {
      const aTime = a.job.listedAtUtc ? Date.parse(a.job.listedAtUtc) : 0;
      const bTime = b.job.listedAtUtc ? Date.parse(b.job.listedAtUtc) : 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return a.sortRank - b.sortRank;
    })
    .map((entry) => entry.job);
}

async function fetchSeekPage({ searchUrl, fetchImpl }) {
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
        const error = new Error(`SEEK returned ${response.status}`);
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
        `[seek] fetch attempt ${attempt} failed with ${status}, retrying in ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

export async function fetchSeekFifoJobs({ searchUrl, maxResults, fetchImpl = fetch }) {
  const html = await fetchSeekPage({ searchUrl, fetchImpl });
  const structuredJobs = extractJobsFromStructuredData(html);
  if (structuredJobs.length > 0) {
    return structuredJobs.filter((job) => job.matchedKeywords.length > 0).slice(0, maxResults);
  }

  const lines = htmlToLines(html);
  const textJobs = extractJobsFromLines(lines);
  const linkJobs = extractJobLinks(html);
  const jobs = mergeJobs(textJobs, linkJobs);

  const filteredJobs = jobs
    .map(normalizeJob)
    .filter((job) => job.matchedKeywords.length > 0);
  return filteredJobs.slice(0, maxResults);
}
