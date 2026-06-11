// Shared FIFO keyword filter used by both SEEK and LinkedIn scrapers.
// Kept centralized so the two sources stay in sync — a job is considered
// "FIFO" if any keyword appears in any of its searchable text fields.

export const FIFO_FILTER_KEYWORDS = [
  "fifo",
  "fifo mining",
  "oil",
  "gas",
  "resource industry",
  "dido",
  "construction fifo",
  "construction"
];

function jobSearchableText(job) {
  return [
    job?.title,
    job?.company,
    job?.location,
    job?.workType,
    job?.summary,
    Array.isArray(job?.highlights) ? job.highlights.join(" ") : ""
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Returns the list of FIFO_FILTER_KEYWORDS substrings that appear in the
 * job's searchable text. Empty array if none match. Lower-cased keywords
 * only — comparison is also lower-cased, so callers get the canonical
 * lower-case form regardless of the original job casing.
 */
export function findFifoKeywordMatches(job) {
  const searchable = jobSearchableText(job);
  if (!searchable) return [];
  return FIFO_FILTER_KEYWORDS.filter((kw) => searchable.includes(kw));
}

/**
 * Returns true if the job matches at least one FIFO keyword.
 */
export function jobMatchesFifoFilter(job) {
  return findFifoKeywordMatches(job).length > 0;
}
