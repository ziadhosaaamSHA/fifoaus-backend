import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  getContentApiConfig: () => ({
    CONTENT_API_TOKEN: "test-token",
    SEEK_FIFO_SEARCH_URL: "https://example.com/seek",
    SEEK_FIFO_MAX_RESULTS: 10,
    LINKEDIN_FIFO_SEARCH_URL: "https://example.com/linkedin",
    LINKEDIN_FIFO_MAX_RESULTS: 10
  })
}));

vi.mock("../db/jobListings.js", () => ({
  isDbEnabled: () => true
}));

const listFifoJobsMock = vi.fn();
const fetchFifoJobsPreviewMock = vi.fn();
const markFifoJobsProcessedMock = vi.fn();
const cleanupFifoJobsMock = vi.fn();
const syncFifoJobsMock = vi.fn();
const syncAllFifoJobsMock = vi.fn();
const listNewsMock = vi.fn();
const fetchNewsPreviewMock = vi.fn();
const markNewsProcessedMock = vi.fn();
const cleanupNewsMock = vi.fn();
const syncNewsMock = vi.fn();
const syncAllNewsMock = vi.fn();

vi.mock("../jobs/sync.js", () => ({
  cleanupFifoJobs: (...args) => cleanupFifoJobsMock(...args),
  fetchFifoJobsPreview: (...args) => fetchFifoJobsPreviewMock(...args),
  getJobSourceNames: () => ["seek", "linkedin"],
  listFifoJobs: (...args) => listFifoJobsMock(...args),
  markFifoJobsProcessed: (...args) => markFifoJobsProcessedMock(...args),
  syncFifoJobs: (...args) => syncFifoJobsMock(...args),
  syncAllFifoJobs: (...args) => syncAllFifoJobsMock(...args)
}));

vi.mock("../news/sync.js", () => ({
  cleanupNews: (...args) => cleanupNewsMock(...args),
  fetchNewsPreview: (...args) => fetchNewsPreviewMock(...args),
  getNewsSourceNames: () => ["australian-mining-review", "guardian-au"],
  listNews: (...args) => listNewsMock(...args),
  markNewsProcessed: (...args) => markNewsProcessedMock(...args),
  syncNews: (...args) => syncNewsMock(...args),
  syncAllNews: (...args) => syncAllNewsMock(...args)
}));

const { createContentApiApp } = await import("./apiApp.js");

async function request(app, path, options = {}) {
  return new Promise((resolve) => {
    const server = app.listen(0, async () => {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
      const body = await response.json();
      server.close(() => resolve({ response, body }));
    });
  });
}

describe("content API app", () => {
  beforeEach(() => {
    listFifoJobsMock.mockReset();
    fetchFifoJobsPreviewMock.mockReset();
    markFifoJobsProcessedMock.mockReset();
    cleanupFifoJobsMock.mockReset();
    syncFifoJobsMock.mockReset();
    syncAllFifoJobsMock.mockReset();
    listNewsMock.mockReset();
    fetchNewsPreviewMock.mockReset();
    markNewsProcessedMock.mockReset();
    cleanupNewsMock.mockReset();
    syncNewsMock.mockReset();
    syncAllNewsMock.mockReset();
  });

  it("requires the configured API token for API routes", async () => {
    const app = createContentApiApp();
    const { response, body } = await request(app, "/api/jobs");

    expect(response.status).toBe(401);
    expect(body.error).toBe("unauthorized");
  });

  it("lists persisted jobs", async () => {
    listFifoJobsMock.mockResolvedValueOnce([{ externalId: "1", title: "FIFO Role" }]);
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/jobs?source=seek&status=pending&limit=5", {
      headers: { Authorization: "Bearer test-token" }
    });

    expect(response.status).toBe(200);
    expect(body.jobs).toHaveLength(1);
    expect(listFifoJobsMock).toHaveBeenCalledWith({
      source: "seek",
      status: "pending",
      limit: 5
    });
  });

  it("rejects invalid job status filters", async () => {
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/jobs?status=posted", {
      headers: { Authorization: "Bearer test-token" }
    });

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  it("syncs a single source", async () => {
    syncFifoJobsMock.mockResolvedValueOnce({
      source: "linkedin",
      newCount: 1,
      jobs: [{ externalId: "2" }]
    });
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/jobs/sync/linkedin?maxResults=3", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" }
    });

    expect(response.status).toBe(200);
    expect(body.source).toBe("linkedin");
    expect(syncFifoJobsMock).toHaveBeenCalledWith({
      cfg: expect.any(Object),
      source: "linkedin",
      maxResults: 3
    });
  });

  it("returns JSON for unknown API routes", async () => {
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/nope", {
      headers: { Authorization: "Bearer test-token" }
    });

    expect(response.status).toBe(404);
    expect(body.error).toBe("not_found");
  });

  it("marks jobs as processed", async () => {
    markFifoJobsProcessedMock.mockResolvedValueOnce(2);
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/jobs/mark-processed", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [
          { source: "seek:fifo", externalId: "92635027" },
          { source: "linkedin:fifo", externalId: "4423102032" }
        ]
      })
    });

    expect(response.status).toBe(200);
    expect(body.updatedCount).toBe(2);
    expect(markFifoJobsProcessedMock).toHaveBeenCalledWith({
      items: [
        { source: "seek:fifo", externalId: "92635027" },
        { source: "linkedin:fifo", externalId: "4423102032" }
      ]
    });
  });

  it("cleans up old processed and stale pending jobs", async () => {
    cleanupFifoJobsMock.mockResolvedValueOnce({
      processedDeletedCount: 1,
      pendingDeletedCount: 2,
      deletedCount: 3
    });
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/jobs/cleanup", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        processedOlderThanDays: 14,
        pendingOlderThanDays: 30
      })
    });

    expect(response.status).toBe(200);
    expect(body.deletedCount).toBe(3);
    expect(cleanupFifoJobsMock).toHaveBeenCalledWith({
      processedOlderThanDays: 14,
      pendingOlderThanDays: 30
    });
  });

  it("fetches a non-persistent preview from a source", async () => {
    fetchFifoJobsPreviewMock.mockResolvedValueOnce({
      source: "linkedin",
      scrapedCount: 1,
      jobs: [{ externalId: "2" }]
    });
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/jobs/fetch/linkedin?maxResults=3", {
      headers: { Authorization: "Bearer test-token" }
    });

    expect(response.status).toBe(200);
    expect(body.scrapedCount).toBe(1);
    expect(fetchFifoJobsPreviewMock).toHaveBeenCalledWith({
      cfg: expect.any(Object),
      source: "linkedin",
      maxResults: 3
    });
  });

  it("lists persisted news items", async () => {
    listNewsMock.mockResolvedValueOnce([{ externalId: "n1", title: "FIFO mine update" }]);
    const app = createContentApiApp();

    const { response, body } = await request(
      app,
      "/api/news?source=australian-mining-review&status=pending&limit=5",
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(listNewsMock).toHaveBeenCalledWith({
      source: "australian-mining-review",
      status: "pending",
      limit: 5
    });
  });

  it("lists persisted news across comma-separated sources", async () => {
    listNewsMock
      .mockResolvedValueOnce([
        {
          externalId: "n1",
          title: "Older mining update",
          publishedAt: "2026-06-10T01:00:00.000Z"
        }
      ])
      .mockResolvedValueOnce([
        {
          externalId: "n2",
          title: "Newer mining update",
          publishedAt: "2026-06-11T01:00:00.000Z"
        }
      ]);
    const app = createContentApiApp();

    const { response, body } = await request(
      app,
      "/api/news?source=australian-mining-review,guardian-au&status=pending&limit=5",
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );

    expect(response.status).toBe(200);
    expect(body.items.map((item) => item.externalId)).toEqual(["n2", "n1"]);
    expect(listNewsMock).toHaveBeenCalledWith({
      source: "australian-mining-review",
      status: "pending",
      limit: 5
    });
    expect(listNewsMock).toHaveBeenCalledWith({
      source: "guardian-au",
      status: "pending",
      limit: 5
    });
  });

  it("rejects invalid news status filters", async () => {
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/news?status=posted", {
      headers: { Authorization: "Bearer test-token" }
    });

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  it("fetches a non-persistent news preview from a source", async () => {
    fetchNewsPreviewMock.mockResolvedValueOnce({
      source: "australian-mining-review",
      scrapedCount: 1,
      items: [{ externalId: "n1" }]
    });
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/news/fetch/australian-mining-review?maxResults=3", {
      headers: { Authorization: "Bearer test-token" }
    });

    expect(response.status).toBe(200);
    expect(body.scrapedCount).toBe(1);
    expect(fetchNewsPreviewMock).toHaveBeenCalledWith({
      source: "australian-mining-review",
      maxResults: 3
    });
  });

  it("returns a clean upstream error when a news source blocks fetching", async () => {
    const upstreamError = new Error("guardian-au returned 403");
    upstreamError.status = 403;
    fetchNewsPreviewMock.mockRejectedValueOnce(upstreamError);
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/news/fetch/guardian-au?maxResults=3", {
      headers: { Authorization: "Bearer test-token" }
    });

    expect(response.status).toBe(502);
    expect(body.error).toBe("upstream_fetch_failed");
  });

  it("syncs a single news source", async () => {
    syncNewsMock.mockResolvedValueOnce({
      source: "guardian-au",
      newCount: 1,
      items: [{ externalId: "n2" }]
    });
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/news/sync/guardian-au?maxResults=3", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" }
    });

    expect(response.status).toBe(200);
    expect(body.source).toBe("guardian-au");
    expect(syncNewsMock).toHaveBeenCalledWith({
      source: "guardian-au",
      maxResults: 3
    });
  });

  it("syncs comma-separated news sources", async () => {
    syncNewsMock
      .mockResolvedValueOnce({
        source: "australian-mining-review",
        scrapedCount: 3,
        newCount: 1,
        items: [
          {
            externalId: "n1",
            publishedAt: "2026-06-10T01:00:00.000Z"
          }
        ]
      })
      .mockResolvedValueOnce({
        source: "guardian-au",
        scrapedCount: 2,
        newCount: 1,
        items: [
          {
            externalId: "n2",
            publishedAt: "2026-06-11T01:00:00.000Z"
          }
        ]
      });
    const app = createContentApiApp();

    const { response, body } = await request(
      app,
      "/api/news/sync/australian-mining-review,guardian-au?maxResults=3",
      {
        method: "POST",
        headers: { Authorization: "Bearer test-token" }
      }
    );

    expect(response.status).toBe(200);
    expect(body.sources).toEqual(["australian-mining-review", "guardian-au"]);
    expect(body.scrapedCount).toBe(5);
    expect(body.newCount).toBe(2);
    expect(body.items.map((item) => item.externalId)).toEqual(["n2", "n1"]);
    expect(syncNewsMock).toHaveBeenCalledWith({
      source: "australian-mining-review",
      maxResults: 3
    });
    expect(syncNewsMock).toHaveBeenCalledWith({
      source: "guardian-au",
      maxResults: 3
    });
  });

  it("marks news items as processed", async () => {
    markNewsProcessedMock.mockResolvedValueOnce(2);
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/news/mark-processed", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [
          { source: "australian-mining-review", externalId: "abc" },
          { source: "guardian-au", externalId: "def" }
        ]
      })
    });

    expect(response.status).toBe(200);
    expect(body.updatedCount).toBe(2);
    expect(markNewsProcessedMock).toHaveBeenCalledWith({
      items: [
        { source: "australian-mining-review", externalId: "abc" },
        { source: "guardian-au", externalId: "def" }
      ]
    });
  });

  it("cleans up old processed and stale pending news", async () => {
    cleanupNewsMock.mockResolvedValueOnce({
      processedDeletedCount: 1,
      pendingDeletedCount: 2,
      deletedCount: 3
    });
    const app = createContentApiApp();

    const { response, body } = await request(app, "/api/news/cleanup", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        processedOlderThanDays: 14,
        pendingOlderThanDays: 30
      })
    });

    expect(response.status).toBe(200);
    expect(body.deletedCount).toBe(3);
    expect(cleanupNewsMock).toHaveBeenCalledWith({
      processedOlderThanDays: 14,
      pendingOlderThanDays: 30
    });
  });
});
