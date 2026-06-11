export const NEWS_FILTER_KEYWORDS = [
  "fifo",
  "dido",
  "mining",
  "resources",
  "resource",
  "oil",
  "gas",
  "construction",
  "major project",
  "workforce",
  "pilbara",
  "western australia",
  "queensland",
  "coal",
  "iron ore",
  "gold",
  "lithium",
  "critical minerals",
  "copper",
  "nickel",
  "rare earth"
];

function searchableText(item) {
  return [
    item?.title,
    item?.summary,
    item?.publisher,
    Array.isArray(item?.tags) ? item.tags.join(" ") : ""
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function findNewsKeywordMatches(item) {
  const text = searchableText(item);
  if (!text) return [];
  return NEWS_FILTER_KEYWORDS.filter((keyword) => text.includes(keyword));
}
