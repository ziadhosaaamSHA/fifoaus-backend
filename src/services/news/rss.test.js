import { describe, expect, it } from "vitest";
import { fetchRssNewsItems } from "./rss.js";

const sampleFeed = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>FIFO mining workforce expands in WA</title>
      <link>https://example.com/fifo-mining</link>
      <guid>fifo-mining-1</guid>
      <description><![CDATA[New mining workforce update in Western Australia.]]></description>
      <pubDate>Thu, 11 Jun 2026 03:00:00 GMT</pubDate>
      <category>Mining</category>
    </item>
    <item>
      <title>City restaurant opens</title>
      <link>https://example.com/restaurant</link>
      <guid>restaurant-1</guid>
      <description>Food news</description>
      <pubDate>Thu, 11 Jun 2026 04:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Copper project reaches construction phase</title>
      <title>Duplicate title tag</title>
      <link>https://example.com/copper-project</link>
      <guid>copper-project-1</guid>
      <description>New resources development.</description>
      <pubDate>Thu, 11 Jun 2026 02:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

function mockFetch() {
  return Promise.resolve({
    ok: true,
    async text() {
      return sampleFeed;
    }
  });
}

describe("fetchRssNewsItems", () => {
  it("parses RSS items and filters by news keywords", async () => {
    const items = await fetchRssNewsItems({
      sourceConfig: {
        source: "test-source",
        publisher: "Test Source",
        feedUrl: "https://example.com/feed",
        tags: ["australia"]
      },
      fetchImpl: mockFetch
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: "test-source",
      title: "FIFO mining workforce expands in WA",
      publisher: "Test Source",
      url: "https://example.com/fifo-mining"
    });
    expect(items[0].matchedKeywords).toEqual(expect.arrayContaining(["fifo", "mining"]));
    expect(items[0].tags).toEqual(expect.arrayContaining(["australia", "Mining"]));
    expect(items[1]).toMatchObject({
      title: "Copper project reaches construction phase",
      url: "https://example.com/copper-project"
    });
    expect(items[1].matchedKeywords).toContain("copper");
  });
});
