import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLinkedInFifoJobs } from "./scraper.js";

const sampleHtml = `
<ul class="jobs-search__results-list">
  <li class="base-card relative w-full hover:no-underline focus:no-underline base-card--link base-search-card base-search-card--link job-search-card">
    <a class="base-card__full-link absolute top-0 right-0 bottom-0 left-0 p-0 z-[2]" href="https://au.linkedin.com/jobs/view/fifo-mining-supervisor-at-miningco-4123456789">
      <span class="sr-only">FIFO Mining Supervisor</span>
    </a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">FIFO Mining Supervisor</h3>
      <h4 class="base-search-card__subtitle">
        <a class="hidden-nested-link" href="https://au.linkedin.com/company/miningco">MiningCo</a>
      </h4>
      <span class="job-search-card__location">Perth, Western Australia, Australia</span>
      <time class="job-search-card__listdate--new" datetime="2026-06-10">1 day ago</time>
    </div>
  </li>
  <li class="base-card relative w-full hover:no-underline focus:no-underline base-card--link base-search-card base-search-card--link job-search-card">
    <a class="base-card__full-link absolute top-0 right-0 bottom-0 left-0 p-0 z-[2]" href="https://au.linkedin.com/jobs/view/software-engineer-at-techco-4987654321">
      <span class="sr-only">Software Engineer</span>
    </a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">Software Engineer</h3>
      <h4 class="base-search-card__subtitle">
        <a class="hidden-nested-link" href="https://au.linkedin.com/company/techco">TechCo</a>
      </h4>
      <span class="job-search-card__location">Sydney, New South Wales, Australia</span>
      <time class="job-search-card__listdate" datetime="2026-06-09">2 days ago</time>
    </div>
  </li>
</ul>
`;

function mockFetch(_url, _options) {
  return Promise.resolve({
    ok: true,
    async text() {
      return sampleHtml;
    }
  });
}

describe("fetchLinkedInFifoJobs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters public LinkedIn search cards to FIFO jobs and annotates matches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));

    const jobs = await fetchLinkedInFifoJobs({
      searchUrl: "https://example.com/jobs/search",
      maxResults: 10,
      fetchImpl: mockFetch
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      externalId: "4123456789",
      title: "FIFO Mining Supervisor",
      company: "MiningCo",
      location: "Perth, Western Australia, Australia",
      salary: "",
      workType: "",
      listedAt: "1 day ago",
      listedAtUtc: "2026-06-10",
      listedAtEstimatedAt: "2026-06-10T12:00:00.000Z",
      platform: "linkedin"
    });
    expect(jobs[0].url).toContain("au.linkedin.com/jobs/view");
    expect(jobs[0].matchedKeywords).toContain("fifo");
    expect(jobs[0].matchedKeywords).toContain("fifo mining");
  });
});
