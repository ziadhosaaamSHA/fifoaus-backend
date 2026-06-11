import {
  cleanupNewsItems,
  ensureNewsItemsTable,
  isDbEnabled,
  listNewsItems,
  markNewsItemsProcessed,
  markNewsItemSeen
} from "../db/newsItems.js";
import { filterByContentAge, getNewsPublishedTime } from "../content/ageFilter.js";
import { fetchRssNewsItems } from "./rss.js";

const NEWS_SOURCES = {
  "abc-news": {
    source: "abc-news",
    publisher: "ABC News",
    feedUrl: "https://www.abc.net.au/news/feed/51120/rss.xml",
    tags: ["australia", "general-news"]
  },
  "australian-mining": {
    source: "australian-mining",
    publisher: "Australian Mining",
    feedUrl: "https://www.australianmining.com.au/feed/",
    tags: ["mining", "resources", "australia"]
  },
  "australian-mining-review": {
    source: "australian-mining-review",
    publisher: "Australian Mining Review",
    feedUrl: "https://australianminingreview.com.au/feed/",
    tags: ["mining", "resources", "australia"]
  },
  "guardian-au": {
    source: "guardian-au",
    publisher: "The Guardian Australia",
    feedUrl: "https://www.theguardian.com/au/rss",
    tags: ["australia", "general-news"]
  },
  "industry-qld": {
    source: "industry-qld",
    publisher: "Industry Queensland",
    feedUrl: "https://industryqld.com.au/feed/",
    tags: ["mining", "resources", "queensland", "australia"]
  },
  "mining-com": {
    source: "mining-com",
    publisher: "MINING.COM",
    feedUrl: "https://www.mining.com/feed/",
    tags: ["mining", "resources"]
  },
  "mining-magazine-au": {
    source: "mining-magazine-au",
    publisher: "Mining Magazine Australia",
    feedUrl: "https://miningmagazine.com.au/feed/",
    tags: ["mining", "resources", "australia"]
  },
  "mining-technology": {
    source: "mining-technology",
    publisher: "Mining Technology",
    feedUrl: "https://www.mining-technology.com/feed/",
    tags: ["mining", "resources"]
  },
  paydirt: {
    source: "paydirt",
    publisher: "Paydirt Media",
    feedUrl: "https://www.paydirt.com.au/feed/",
    tags: ["mining", "resources", "australia"]
  }
};

function getNewsSourceConfig(source) {
  const config = NEWS_SOURCES[source];
  if (!config) {
    throw new Error(`unknown_news_source:${source}`);
  }
  return config;
}

export function getNewsSourceNames() {
  return Object.keys(NEWS_SOURCES);
}

export async function fetchNewsPreview({ source, maxResults, minAgeHours, maxAgeHours, fetchImpl = fetch }) {
  const sourceConfig = getNewsSourceConfig(source);
  const scrapedItems = await fetchRssNewsItems({ sourceConfig, fetchImpl });
  const items = filterByContentAge(scrapedItems, {
    minAgeHours,
    maxAgeHours,
    getTime: getNewsPublishedTime
  });

  return {
    source,
    sourceKey: sourceConfig.source,
    scrapedCount: items.length,
    items: items.slice(0, maxResults || 20)
  };
}

export async function syncNews({ source, maxResults, minAgeHours, maxAgeHours, fetchImpl = fetch }) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  const sourceConfig = getNewsSourceConfig(source);
  await ensureNewsItemsTable();

  const scrapedItems = await fetchRssNewsItems({ sourceConfig, fetchImpl });
  const items = filterByContentAge(scrapedItems, {
    minAgeHours,
    maxAgeHours,
    getTime: getNewsPublishedTime
  });
  const selectedItems = items.slice(0, maxResults || 20);
  const newItems = [];

  for (const item of selectedItems) {
    const inserted = await markNewsItemSeen(item);
    if (inserted) newItems.push(item);
  }

  return {
    source,
    sourceKey: sourceConfig.source,
    scrapedCount: selectedItems.length,
    newCount: newItems.length,
    items: newItems
  };
}

export async function syncAllNews({ maxResults, minAgeHours, maxAgeHours, fetchImpl = fetch } = {}) {
  const results = {};
  for (const source of getNewsSourceNames()) {
    results[source] = await syncNews({ source, maxResults, minAgeHours, maxAgeHours, fetchImpl });
  }
  return results;
}

export async function listNews({ source, status, limit = 20, minAgeHours, maxAgeHours }) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  await ensureNewsItemsTable();
  return listNewsItems({ source, status, limit, minAgeHours, maxAgeHours });
}

export async function markNewsProcessed({ items }) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  await ensureNewsItemsTable();
  return markNewsItemsProcessed({ items });
}

export async function cleanupNews({ processedOlderThanDays, pendingOlderThanDays } = {}) {
  if (!isDbEnabled()) {
    throw new Error("database_not_configured");
  }

  await ensureNewsItemsTable();
  return cleanupNewsItems({ processedOlderThanDays, pendingOlderThanDays });
}
