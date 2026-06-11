import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchSeekFifoJobs } from "./scraper.js";

// Mock HTML containing two job entries; only the first matches FIFO keywords.
const sampleHtml = `
<div>2 jobs</div>
<div>###</div>
<div>FIFO Mining Supervisor</div>
<div>at</div>
<div>MiningCo</div>
<div>This is a Full-time</div>
<div>Sydney, NSW</div>
<div>$120k</div>
<a href="/job/12345">View Job</a>
<div>* Flexible hours</div>
<div>Great opportunity in FIFO mining</div>
<div>Listed 2 days ago</div>
<div>###</div>
<div>Software Engineer</div>
<div>at</div>
<div>TechCo</div>
<div>This is a Part-time</div>
<div>Melbourne, VIC</div>
<div>$60k</div>
<div>* Office duties</div>
<div>Join our growing team</div>
<div>Listed 5 days ago</div>
<div>###</div>
`;

function mockFetch(_url, _options) {
  return Promise.resolve({
    ok: true,
    async text() {
      return sampleHtml;
    }
  });
}

describe("fetchSeekFifoJobs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters out non-FIFO jobs based on keyword list and annotates matches", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
      const jobs = await fetchSeekFifoJobs({
        searchUrl: "https://example.com/search",
        maxResults: 10,
        fetchImpl: mockFetch
      });
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.title.toLowerCase()).toContain("fifo mining");
      expect(job.company).toBe("MiningCo");
      expect(job.url).toContain("/job/12345");
      expect(job.platform).toBe("seek");
      expect(job.listedAt).toBe("Listed 2 days ago");
      expect(job.listedAtEstimatedAt).toBe("2026-06-09T12:00:00.000Z");
      expect(job.matchedKeywords).toContain("fifo");
      expect(job.matchedKeywords).toContain("fifo mining");
  });
});
