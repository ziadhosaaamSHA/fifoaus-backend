const WORD_NUMBERS = {
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
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20
};

function numberFromToken(value) {
  const normalized = value.toLowerCase();
  return WORD_NUMBERS[normalized] || Number(normalized);
}

export function estimateListedAtFromRelativeText(value, observedAt = new Date()) {
  const text = String(value || "")
    .replace(/^listed\s+/i, "")
    .trim()
    .toLowerCase();

  if (!text) return "";

  const match = text.match(
    /^(?<amount>\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(?<unit>m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s+ago$/
  );

  if (!match?.groups) return "";

  const amount = numberFromToken(match.groups.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "";

  const unit = match.groups.unit;
  const multiplier = unit.startsWith("m")
    ? 60 * 1000
    : unit.startsWith("h")
      ? 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;

  return new Date(observedAt.getTime() - amount * multiplier).toISOString();
}

export function listedAtSortTime(job) {
  const estimatedAt = job.listedAtEstimatedAt ? Date.parse(job.listedAtEstimatedAt) : 0;
  if (estimatedAt) return estimatedAt;

  const listedAtUtc = job.listedAtUtc ? Date.parse(job.listedAtUtc) : 0;
  return listedAtUtc || 0;
}
