import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("./pool.js", () => ({
  isDbEnabled: () => true,
  query: (...args) => queryMock(...args)
}));

const {
  cleanupJobListings,
  countSeenJobListings,
  ensureJobListingsTable,
  listJobListings,
  markJobListingsProcessed,
  markJobListingSeen
} = await import("./jobListings.js");

describe("jobListings persistence", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("keeps the listings table compatible while adding source metadata columns", async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await ensureJobListingsTable();

    expect(queryMock).toHaveBeenCalledTimes(15);
    expect(queryMock.mock.calls[0][0]).toContain("CREATE TABLE IF NOT EXISTS seek_listings_seen");
    expect(queryMock.mock.calls[1][0]).toContain("ADD COLUMN IF NOT EXISTS platform TEXT");
    expect(queryMock.mock.calls[2][0]).toContain("ADD COLUMN IF NOT EXISTS matched_keywords TEXT[]");
    expect(queryMock.mock.calls[13][0]).toContain("ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ");
    expect(queryMock.mock.calls[14][0]).toContain("ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ");
  });

  it("counts seen listings by source partition", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: 7 }] });

    await expect(countSeenJobListings({ source: "linkedin:fifo" })).resolves.toBe(7);
    expect(queryMock.mock.calls[0][1]).toEqual(["linkedin:fifo"]);
  });

  it("persists LinkedIn listing IDs with source partitioning and keyword metadata", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ external_id: "4423102032" }] });

    const inserted = await markJobListingSeen({
      source: "linkedin:fifo",
      externalId: "4423102032",
      title: "Project Supervisor | FIFO",
      url: "https://au.linkedin.com/jobs/view/project-supervisor-4423102032",
      platform: "linkedin",
      matchedKeywords: ["fifo"],
      company: "Sodexo",
      location: "Western Australia",
      workType: "",
      salary: "",
      highlights: [],
      summary: "",
      listedAt: "21 hours ago",
      listedAtUtc: "2026-06-10"
    });

    expect(inserted).toBe(true);
    expect(queryMock.mock.calls[0][0]).toContain("ON CONFLICT (source, external_id) DO NOTHING");
    expect(queryMock.mock.calls[0][1]).toEqual([
      "linkedin:fifo",
      "4423102032",
      "Project Supervisor | FIFO",
      "https://au.linkedin.com/jobs/view/project-supervisor-4423102032",
      "linkedin",
      ["fifo"],
      "Sodexo",
      "Western Australia",
      null,
      null,
      [],
      null,
      "21 hours ago",
      "2026-06-10",
      expect.objectContaining({
        externalId: "4423102032",
        platform: "linkedin",
        matchedKeywords: ["fifo"]
      })
    ]);
  });

  it("returns false when a LinkedIn listing was already seen", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      markJobListingSeen({
        source: "linkedin:fifo",
        externalId: "4423102032",
        title: "Project Supervisor | FIFO",
        url: "https://au.linkedin.com/jobs/view/project-supervisor-4423102032",
        platform: "linkedin",
        matchedKeywords: ["fifo"]
      })
    ).resolves.toBe(false);
  });

  it("lists persisted jobs as canonical job objects", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          external_id: "4423102032",
          title: "Project Supervisor | FIFO",
          company: "Sodexo",
          location: "Western Australia",
          work_type: "",
          salary: "",
          highlights: [],
          summary: "",
          listed_at: "21 hours ago",
          listed_at_utc: "2026-06-10",
          url: "https://au.linkedin.com/jobs/view/project-supervisor-4423102032",
          platform: "linkedin",
          matched_keywords: ["fifo"],
          first_seen_at: "2026-06-11T00:00:00.000Z",
          status: "pending",
          posted_at: null,
          processed_at: null,
          payload: null
        }
      ]
    });

    await expect(
      listJobListings({ source: "linkedin:fifo", status: "pending", limit: 5 })
    ).resolves.toEqual([
      expect.objectContaining({
        externalId: "4423102032",
        title: "Project Supervisor | FIFO",
        platform: "linkedin",
        matchedKeywords: ["fifo"],
        status: "pending",
        processedAt: null
      })
    ]);
    expect(queryMock.mock.calls[0][1]).toEqual(["linkedin:fifo", "pending", 5]);
  });

  it("marks matching listings as processed", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ external_id: "4423102032" }, { external_id: "92635027" }]
    });

    await expect(
      markJobListingsProcessed({
        items: [
          { source: "linkedin:fifo", externalId: "4423102032" },
          { source: "seek:fifo", externalId: "92635027" }
        ]
      })
    ).resolves.toBe(2);

    expect(queryMock.mock.calls[0][0]).toContain("status = 'processed'");
    expect(queryMock.mock.calls[0][0]).toContain("processed_at = NOW()");
    expect(JSON.parse(queryMock.mock.calls[0][1][0])).toEqual([
      { source: "linkedin:fifo", external_id: "4423102032" },
      { source: "seek:fifo", external_id: "92635027" }
    ]);
  });

  it("returns zero when asked to mark no listings as processed", async () => {
    await expect(markJobListingsProcessed({ items: [] })).resolves.toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("cleans up old processed and stale pending listings with defaults", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ external_id: "processed-1" }] })
      .mockResolvedValueOnce({ rows: [{ external_id: "pending-1" }, { external_id: "pending-2" }] });

    await expect(cleanupJobListings()).resolves.toEqual({
      processedDeletedCount: 1,
      pendingDeletedCount: 2,
      deletedCount: 3
    });

    expect(queryMock.mock.calls[0][0]).toContain("status = 'processed'");
    expect(queryMock.mock.calls[0][1]).toEqual([14]);
    expect(queryMock.mock.calls[1][0]).toContain("status = 'pending'");
    expect(queryMock.mock.calls[1][1]).toEqual([30]);
  });
});
