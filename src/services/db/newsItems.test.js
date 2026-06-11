import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("./pool.js", () => ({
  isDbEnabled: () => true,
  query: (...args) => queryMock(...args)
}));

const {
  cleanupNewsItems,
  ensureNewsItemsTable,
  listNewsItems,
  markNewsItemsProcessed,
  markNewsItemSeen
} = await import("./newsItems.js");

describe("newsItems persistence", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("creates the news_items table", async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await ensureNewsItemsTable();

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS news_items");
    expect(queryMock.mock.calls[0][0]).toContain("PRIMARY KEY (source, external_id)");
  });

  it("persists a news item with source dedupe", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ external_id: "abc123" }] });

    await expect(
      markNewsItemSeen({
        source: "australian-mining-review",
        externalId: "abc123",
        title: "Gold project advances",
        summary: "A mining project update",
        url: "https://example.com/story",
        publisher: "Australian Mining Review",
        publishedAt: "2026-06-11T00:00:00.000Z",
        tags: ["mining"],
        matchedKeywords: ["mining", "gold"]
      })
    ).resolves.toBe(true);

    expect(queryMock.mock.calls[0][0]).toContain("ON CONFLICT (source, external_id) DO NOTHING");
    expect(queryMock.mock.calls[0][1]).toEqual([
      "australian-mining-review",
      "abc123",
      "Gold project advances",
      "A mining project update",
      "https://example.com/story",
      "Australian Mining Review",
      "2026-06-11T00:00:00.000Z",
      ["mining"],
      ["mining", "gold"],
      expect.objectContaining({
        externalId: "abc123",
        source: "australian-mining-review"
      })
    ]);
  });

  it("lists news items with optional source and status filters", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          source: "australian-mining-review",
          external_id: "abc123",
          title: "Gold project advances",
          summary: "A mining project update",
          url: "https://example.com/story",
          publisher: "Australian Mining Review",
          published_at: "2026-06-11T00:00:00.000Z",
          tags: ["mining"],
          matched_keywords: ["mining", "gold"],
          status: "pending",
          first_seen_at: "2026-06-11T01:00:00.000Z",
          processed_at: null,
          payload: null
        }
      ]
    });

    await expect(
      listNewsItems({ source: "australian-mining-review", status: "pending", limit: 5 })
    ).resolves.toEqual([
      expect.objectContaining({
        externalId: "abc123",
        source: "australian-mining-review",
        matchedKeywords: ["mining", "gold"]
      })
    ]);
    expect(queryMock.mock.calls[0][1]).toEqual(["australian-mining-review", "pending", 5]);
  });

  it("marks news items processed", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ external_id: "abc123" }] });

    await expect(
      markNewsItemsProcessed({
        items: [{ source: "australian-mining-review", externalId: "abc123" }]
      })
    ).resolves.toBe(1);

    expect(queryMock.mock.calls[0][0]).toContain("status = 'processed'");
    expect(JSON.parse(queryMock.mock.calls[0][1][0])).toEqual([
      { source: "australian-mining-review", external_id: "abc123" }
    ]);
  });

  it("cleans up old processed and stale pending news items", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ external_id: "processed-1" }] })
      .mockResolvedValueOnce({ rows: [{ external_id: "pending-1" }] });

    await expect(cleanupNewsItems()).resolves.toEqual({
      processedDeletedCount: 1,
      pendingDeletedCount: 1,
      deletedCount: 2
    });
    expect(queryMock.mock.calls[0][1]).toEqual([14]);
    expect(queryMock.mock.calls[1][1]).toEqual([30]);
  });
});
