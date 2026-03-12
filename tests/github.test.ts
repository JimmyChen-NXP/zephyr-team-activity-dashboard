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

function searchResponse(items: unknown[]) {
  return jsonResponse({
    total_count: items.length,
    incomplete_results: false,
    items,
  });
}

function getUrl(input: string | URL | Request) {
  if (typeof input === "string") {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("collectLiveDashboard", () => {
  it("includes team reviews on external-authored pull requests discovered by reviewer queries", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = getUrl(input);

      if (url.pathname === "/search/issues") {
        const query = decodeURIComponent(url.searchParams.get("q") ?? "");

        if (query.includes("is:pr") && query.includes("updated:2026-03-01T00:00:00.000Z..2026-03-31T23:59:59.000Z")) {
          return searchResponse([
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
          ]);
        }

        return searchResponse([]);
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/101") {
        return jsonResponse({
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
        });
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/101/reviews") {
        return jsonResponse([
          {
            id: 9001,
            state: "APPROVED",
            submitted_at: "2026-03-05T12:00:00.000Z",
            user: { login: "alice" },
          },
        ]);
      }

      throw new Error(`Unhandled fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const data = await collectLiveDashboard(roster, range, "token");

    expect(data.summary.reviewsSubmitted).toBe(1);
    expect(data.summary.uniqueReviewedPrs).toBe(1);
    expect(data.reviewSources.externalAuthored).toBe(1);

    const alice = data.contributors.find((contributor) => contributor.login === "alice");
    expect(alice?.reviewsSubmitted).toBe(1);
    expect(alice?.reviewExternalAuthored).toBe(1);

    expect(data.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "review",
          contributor: "alice",
          author: "external-author",
          reviewedPrKind: "authored-external",
        }),
      ]),
    );
  });

  it("counts merged PRs and closed issues with roster-scoped search queries", async () => {
    const searchQueries: string[] = [];
    let returnedClosedIssue = false;
    let returnedClosedPr = false;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = getUrl(input);

      if (url.pathname === "/search/issues") {
        const query = decodeURIComponent(url.searchParams.get("q") ?? "");
        searchQueries.push(query);

        if (!returnedClosedIssue && query.includes("is:issue") && query.includes("is:closed") && query.includes("closed:")) {
          returnedClosedIssue = true;
          return searchResponse([
            {
              id: 201,
              number: 201,
              title: "Closed issue",
              html_url: "https://github.com/zephyrproject-rtos/zephyr/issues/201",
              repository_url: "https://api.github.com/repos/zephyrproject-rtos/zephyr",
              created_at: "2026-03-03T00:00:00.000Z",
              updated_at: "2026-03-07T00:00:00.000Z",
              closed_at: "2026-03-07T00:00:00.000Z",
              state: "closed",
              user: { login: "external-author" },
              assignees: [{ login: "alice" }],
            },
          ]);
        }

        if (!returnedClosedPr && query.includes("is:pr") && query.includes("is:closed") && query.includes("closed:")) {
          returnedClosedPr = true;
          return searchResponse([
            {
              id: 301,
              number: 301,
              title: "Merged PR",
              html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/301",
              repository_url: "https://api.github.com/repos/zephyrproject-rtos/zephyr",
              created_at: "2026-03-01T00:00:00.000Z",
              updated_at: "2026-03-08T00:00:00.000Z",
              closed_at: "2026-03-08T00:00:00.000Z",
              state: "closed",
              user: { login: "bob" },
              pull_request: { url: "https://api.github.com/repos/zephyrproject-rtos/zephyr/pulls/301" },
            },
          ]);
        }

        return searchResponse([]);
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/301") {
        return jsonResponse({
          id: 301,
          number: 301,
          html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/301",
          draft: false,
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-08T00:00:00.000Z",
          merged_at: "2026-03-08T00:00:00.000Z",
          state: "closed",
          requested_reviewers: [],
          user: { login: "bob" },
          head: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
          base: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
        });
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/301/reviews") {
        return jsonResponse([]);
      }

      throw new Error(`Unhandled fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const data = await collectLiveDashboard(roster, range, "token");

    expect(data.summary.closedIssues).toBe(1);
    expect(data.summary.mergedPrs).toBe(1);
    expect(searchQueries.every((query) => query.includes("org:zephyrproject-rtos"))).toBe(true);
    expect(searchQueries.some((query) => query.includes("is:issue") && query.includes("closed:"))).toBe(true);
    expect(searchQueries.some((query) => query.includes("is:pr") && query.includes("is:closed") && query.includes("closed:"))).toBe(true);
  });

  it("counts pending review requests on external-authored pull requests", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = getUrl(input);

      if (url.pathname === "/search/issues") {
        const query = decodeURIComponent(url.searchParams.get("q") ?? "");

        if (query.includes("is:pr is:open") && query.includes("updated:")) {
          return searchResponse([
            {
              id: 401,
              number: 401,
              title: "External pending review",
              html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/401",
              repository_url: "https://api.github.com/repos/zephyrproject-rtos/zephyr",
              created_at: "2026-03-10T00:00:00.000Z",
              updated_at: "2026-03-12T00:00:00.000Z",
              closed_at: null,
              state: "open",
              user: { login: "external-author" },
              pull_request: { url: "https://api.github.com/repos/zephyrproject-rtos/zephyr/pulls/401" },
            },
          ]);
        }

        return searchResponse([]);
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/401") {
        return jsonResponse({
          id: 401,
          number: 401,
          html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/401",
          draft: false,
          created_at: "2026-03-10T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
          merged_at: null,
          state: "open",
          requested_reviewers: [{ login: "alice" }],
          user: { login: "external-author" },
          head: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
          base: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
        });
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/401/reviews") {
        return jsonResponse([]);
      }

      throw new Error(`Unhandled fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const data = await collectLiveDashboard(roster, range, "token");

    expect(data.summary.pendingReviewRequests).toBe(1);
    const alice = data.contributors.find((contributor) => contributor.login === "alice");
    expect(alice?.pendingReviewRequests).toBe(1);
    expect(data.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "review_request",
          contributor: "alice",
          author: "external-author",
        }),
      ]),
    );
  });

  it("includes activity that lands exactly on the selected range boundaries", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = getUrl(input);

      if (url.pathname === "/search/issues") {
        const query = decodeURIComponent(url.searchParams.get("q") ?? "");

        if (query.includes("is:pr") && query.includes("is:closed") && query.includes("closed:2026-03-01T00:00:00.000Z..2026-03-31T23:59:59.000Z")) {
          return searchResponse([
            {
              id: 601,
              number: 601,
              title: "Boundary merged PR",
              html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/601",
              repository_url: "https://api.github.com/repos/zephyrproject-rtos/zephyr",
              created_at: "2026-03-01T00:00:00.000Z",
              updated_at: "2026-03-31T23:59:59.000Z",
              closed_at: "2026-03-31T23:59:59.000Z",
              state: "closed",
              user: { login: "bob" },
              pull_request: { url: "https://api.github.com/repos/zephyrproject-rtos/zephyr/pulls/601" },
            },
          ]);
        }

        if (query.includes("is:pr") && query.includes("updated:2026-03-01T00:00:00.000Z..2026-03-31T23:59:59.000Z")) {
          return searchResponse([
            {
              id: 602,
              number: 602,
              title: "Boundary reviewed PR",
              html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/602",
              repository_url: "https://api.github.com/repos/zephyrproject-rtos/zephyr",
              created_at: "2026-03-01T00:00:00.000Z",
              updated_at: "2026-03-31T23:59:59.000Z",
              closed_at: null,
              state: "open",
              user: { login: "external-author" },
              pull_request: { url: "https://api.github.com/repos/zephyrproject-rtos/zephyr/pulls/602" },
            },
          ]);
        }

        return searchResponse([]);
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/601") {
        return jsonResponse({
          id: 601,
          number: 601,
          html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/601",
          draft: false,
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-31T23:59:59.000Z",
          merged_at: "2026-03-31T23:59:59.000Z",
          state: "closed",
          requested_reviewers: [],
          user: { login: "bob" },
          head: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
          base: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
        });
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/602") {
        return jsonResponse({
          id: 602,
          number: 602,
          html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/602",
          draft: false,
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-31T23:59:59.000Z",
          merged_at: null,
          state: "open",
          requested_reviewers: [],
          user: { login: "external-author" },
          head: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
          base: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
        });
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/601/reviews") {
        return jsonResponse([]);
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/602/reviews") {
        return jsonResponse([
          {
            id: 9601,
            state: "APPROVED",
            submitted_at: "2026-03-01T00:00:00.000Z",
            user: { login: "alice" },
          },
          {
            id: 9602,
            state: "COMMENTED",
            submitted_at: "2026-03-31T23:59:59.000Z",
            user: { login: "alice" },
          },
        ]);
      }

      throw new Error(`Unhandled fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const data = await collectLiveDashboard(roster, range, "token");

    expect(data.summary.mergedPrs).toBe(1);
    expect(data.summary.reviewsSubmitted).toBe(2);
    expect(data.reviewOutcomes.approved).toBe(1);
    expect(data.reviewOutcomes.commented).toBe(1);
  });

  it("surfaces a warning when any roster-scoped query returns incomplete results", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = getUrl(input);

      if (url.pathname === "/search/issues") {
        const query = decodeURIComponent(url.searchParams.get("q") ?? "");

        if (query.includes("is:issue") && query.includes("is:open") && query.includes("updated:")) {
          return jsonResponse({
            total_count: 0,
            incomplete_results: true,
            items: [],
          });
        }

        return searchResponse([]);
      }

      throw new Error(`Unhandled fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const data = await collectLiveDashboard(roster, range, "token");

    expect(data.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: "GitHub Search returned incomplete results for one or more queries. Totals may be partial.",
        }),
      ]),
    );
  });

  it("uses commenter-discovered PRs as review targets when needed", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = getUrl(input);

      if (url.pathname === "/search/issues") {
        const query = decodeURIComponent(url.searchParams.get("q") ?? "");

        if (query.includes("is:pr") && query.includes("updated:2026-03-01T00:00:00.000Z..2026-03-31T23:59:59.000Z")) {
          return searchResponse([
            {
              id: 501,
              number: 501,
              title: "Comment-discovered PR",
              html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/501",
              repository_url: "https://api.github.com/repos/zephyrproject-rtos/zephyr",
              created_at: "2026-03-09T00:00:00.000Z",
              updated_at: "2026-03-11T00:00:00.000Z",
              closed_at: null,
              state: "open",
              user: { login: "external-author" },
              pull_request: { url: "https://api.github.com/repos/zephyrproject-rtos/zephyr/pulls/501" },
            },
          ]);
        }

        return searchResponse([]);
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/501") {
        return jsonResponse({
          id: 501,
          number: 501,
          html_url: "https://github.com/zephyrproject-rtos/zephyr/pull/501",
          draft: false,
          created_at: "2026-03-09T00:00:00.000Z",
          updated_at: "2026-03-11T00:00:00.000Z",
          merged_at: null,
          state: "open",
          requested_reviewers: [],
          user: { login: "external-author" },
          head: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
          base: { repo: { full_name: "zephyrproject-rtos/zephyr" } },
        });
      }

      if (url.pathname === "/repos/zephyrproject-rtos/zephyr/pulls/501/reviews") {
        return jsonResponse([
          {
            id: 9501,
            state: "COMMENTED",
            submitted_at: "2026-03-11T08:00:00.000Z",
            user: { login: "alice" },
          },
        ]);
      }

      throw new Error(`Unhandled fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const data = await collectLiveDashboard(roster, range, "token");

    expect(data.summary.reviewsSubmitted).toBe(1);
    expect(data.reviewOutcomes.commented).toBe(1);
    expect(data.activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "review",
          contributor: "alice",
          statusLabel: "COMMENTED · Authored externally",
        }),
      ]),
    );
  });
});