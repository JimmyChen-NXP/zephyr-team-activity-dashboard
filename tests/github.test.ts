import { afterEach, describe, expect, it, vi } from "vitest";

import { collectLiveDashboard } from "@/lib/github";
import type { RangeOption, RosterMember } from "@/lib/types";

const range: RangeOption = {
  preset: "30d",
  label: "Last 30 days",
  from: "2026-03-01T00:00:00.000Z",
  to: "2026-03-31T23:59:59.000Z",
  timeZone: "UTC",
};

const roster: RosterMember[] = [
  { login: "alice", name: "Alice", email: null, createdAt: "2026-01-01T00:00:00.000Z", role: "Engineer" },
  { login: "bob", name: "Bob", email: null, createdAt: "2026-01-01T00:00:00.000Z", role: "Engineer" },
];

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("collectLiveDashboard", () => {
  it("includes team reviews on external-authored pull requests", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ total_count: 0, incomplete_results: false, items: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              id: 101,
              number: 101,
              title: "External authored PR",
              html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/101",
              repository_url: "https://api.github.com/repos/zephyrproject-rtos/zephyr",
              created_at: "2026-03-04T00:00:00.000Z",
              updated_at: "2026-03-06T00:00:00.000Z",
              closed_at: null,
              state: "open",
              user: { login: "external-author" },
              pull_request: { url: "https://api.github.com/repos/zephyrproject-rtos/zephyr/pulls/101" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ total_count: 0, incomplete_results: false, items: [] }))
      .mockResolvedValueOnce(jsonResponse({ total_count: 0, incomplete_results: false, items: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 101,
          number: 101,
          html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/101",
          draft: false,
          created_at: "2026-03-04T00:00:00.000Z",
          updated_at: "2026-03-06T00:00:00.000Z",
          merged_at: null,
          state: "open",
          requested_reviewers: [],
          user: { login: "external-author" },
          head: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
          base: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 9001,
            state: "APPROVED",
            submitted_at: "2026-03-05T12:00:00.000Z",
            user: { login: "alice" },
          },
        ]),
      );

    vi.stubGlobal("fetch", fetchMock);

    const data = await collectLiveDashboard(roster, range, "token");

    expect(data.summary.reviewsSubmitted).toBe(1);
    expect(data.summary.uniqueReviewedPrs).toBe(1);
    expect(data.reviewSources.externalAuthored).toBe(1);
    expect(data.reviewSources.selfAuthored).toBe(0);
    expect(data.reviewSources.teamAuthored).toBe(0);

    const alice = data.contributors.find((contributor) => contributor.login === "alice");
    expect(alice?.reviewsSubmitted).toBe(1);
    expect(alice?.reviewExternalAuthored).toBe(1);
    expect(alice?.uniqueReviewedPrs).toBe(1);

    expect(data.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "review",
          contributor: "alice",
          author: "external-author",
          reviewedPrKind: "authored-external",
          url: "https://github.com/zephyrproject-rtos/zephyr/pull/101",
        }),
      ]),
    );
  });
});
