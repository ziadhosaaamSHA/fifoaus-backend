export function getJobPublishedTime(job) {
  const value = job?.listedAtEstimatedAt || job?.listedAtUtc || job?.firstSeenAt;
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

export function getNewsPublishedTime(item) {
  const value = item?.publishedAt || item?.firstSeenAt;
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

export function filterByContentAge(items, { minAgeHours, maxAgeHours, getTime, now = Date.now() }) {
  if (minAgeHours === undefined && maxAgeHours === undefined) return items;

  const minAgeMs = minAgeHours === undefined ? null : minAgeHours * 60 * 60 * 1000;
  const maxAgeMs = maxAgeHours === undefined ? null : maxAgeHours * 60 * 60 * 1000;

  return items.filter((item) => {
    const publishedTime = getTime(item);
    if (!publishedTime) return false;

    const ageMs = now - publishedTime;
    if (ageMs < 0) return false;
    if (minAgeMs !== null && ageMs < minAgeMs) return false;
    if (maxAgeMs !== null && ageMs > maxAgeMs) return false;
    return true;
  });
}
