import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { findNewsKeywordMatches } from "./filters.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  cdataPropName: "text",
  trimValues: true
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(textValue).find(Boolean) || "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return textValue(value.text || value["#text"] || value.href);
  return "";
}

function stripHtml(value) {
  return textValue(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  if (Array.isArray(value)) return normalizeUrl(value[0]);
  if (value && typeof value === "object") return value.href || textValue(value);
  return textValue(value);
}

function stableExternalId({ source, guid, url, title }) {
  const raw = guid || url || title;
  return crypto.createHash("sha256").update(`${source}:${raw}`).digest("hex").slice(0, 24);
}

function normalizeRssItem(rawItem, sourceConfig) {
  const url = normalizeUrl(rawItem.link);
  const guid = textValue(rawItem.guid || rawItem.id);
  const title = stripHtml(rawItem.title);
  const summary = stripHtml(rawItem.description || rawItem.summary || rawItem["content:encoded"]);
  const publishedAt =
    textValue(rawItem.pubDate || rawItem.published || rawItem.updated || rawItem["dc:date"]) || "";
  const categories = asArray(rawItem.category).map(stripHtml).filter(Boolean);

  if (!title || !url) return null;

  const item = {
    externalId: stableExternalId({
      source: sourceConfig.source,
      guid,
      url,
      title
    }),
    source: sourceConfig.source,
    title,
    summary,
    url,
    publisher: sourceConfig.publisher,
    publishedAt,
    tags: [...new Set([...sourceConfig.tags, ...categories])],
    matchedKeywords: []
  };

  item.matchedKeywords = findNewsKeywordMatches(item);
  return item;
}

function extractFeedItems(parsed) {
  if (parsed.rss?.channel?.item) return asArray(parsed.rss.channel.item);
  if (parsed.feed?.entry) return asArray(parsed.feed.entry);
  return [];
}

export async function fetchRssNewsItems({ sourceConfig, fetchImpl = fetch }) {
  const response = await fetchImpl(sourceConfig.feedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FIFOAUSBot/1.0; +https://fifoaus.com)",
      Accept: "application/rss+xml,application/atom+xml,text/xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    const error = new Error(`${sourceConfig.source} returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  return extractFeedItems(parsed)
    .map((item) => normalizeRssItem(item, sourceConfig))
    .filter(Boolean)
    .filter((item) => item.matchedKeywords.length > 0)
    .sort((a, b) => {
      const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return bTime - aTime;
    });
}
