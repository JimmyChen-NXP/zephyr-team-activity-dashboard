import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardData, DashboardFilters, RangeOption, RosterMember } from "@/lib/types";

const readFileMock = vi.fn();
const writeFileMock = vi.fn();
const mkdirMock = vi.fn();
const collectLiveDashboardMock = vi.fn();
const loadRosterMock = vi.fn();
const resolveRangeMock = vi.fn();
const buildDemoDashboardMock = vi.fn();
const getGitHubEnvTokenMock = vi.fn();
const filterDashboardDataMock = vi.fn((data: DashboardData) => data);

class MockGitHubRequestError extends Error {
  status: number;
  statusText: string;
  rateLimitRemaining: number | null;
  requestPath: string | null;
  responseBody: string | null;

  constructor(status: number, statusText: string, rateLimitRemaining: number | null = null, requestPath: string | null = null, responseBody: string | null = null) {
    const pathText = requestPath ? ` (${requestPath})` : "";
    const bodyText = responseBody ? `: ${responseBody}` : "";
    super(`GitHub request failed: ${status} ${statusText}${pathText}${bodyText}`);
    this.status = status;
    this.statusText = statusText;
    this.rateLimitRemaining = rateLimitRemaining;
    this.requestPath = requestPath;
    this.responseBody = responseBody;
  }
}

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  mkdir: mkdirMock,
}));

vi.mock("@/lib/github", () => ({
  collectLiveDashboard: collectLiveDashboardMock,
  GitHubRequestError: MockGitHubRequestError,
}));

vi.mock("@/lib/roster", () => ({
  loadRoster: loadRosterMock,
}));

vi.mock("@/lib/range", () => ({
  resolveRange: resolveRangeMock,
}));

vi.mock("@/lib/demo-data", () => ({
  buildDemoDashboard: buildDemoDashboardMock,
}));

vi.mock("@/lib/dashboard-filtering", () => ({
  filterDashboardData: filterDashboardDataMock,
}));

vi.mock("@/lib/github-auth", () => ({
  getGitHubEnvToken: getGitHubEnvTokenMock,
  buildMissingGitHubAuthState: () => ({ hasToken: false, connectionStatus: "missing", message: "missing", checkedAt: null }),
  buildConfiguredGitHubAuthState: (message = "configured") => ({ hasToken: true, connectionStatus: "configured", message, checkedAt: null }),
  buildValidGitHubAuthState: ({ checkedAt = null, message = "valid" } = {}) => ({ hasToken: true, connectionStatus: "valid", message, checkedAt }),
  buildRateLimitedGitHubAuthState: (message = "rate-limited", checkedAt = null) => ({ hasToken: true, connectionStatus: "rate-limited", message, checkedAt }),
  buildGitHubAuthStateFromError: () => ({ hasToken: true, connectionStatus: "rate-limited", message: "GitHub rate limit reached. Wait for reset or use cached data.", checkedAt: "2026-03-12T00:00:00.000Z" }),
}));

const range: RangeOption = {
  preset: "30d",
  label: "Last 30 days",
  from: "2026-02-10T00:00:00.000Z",
  to: "2026-03-11T23:59:59.000Z",
  timeZone: "UTC",
};

const roster: RosterMember[] = [
  { login: "alice", name: "Alice", email: null, createdAt: "2026-01-01T00:00:00.000Z", role: "Engineer" },
];

function createSnapshot(): DashboardData {
  return {
    range,
    generatedAt: "2026-03-10T00:00:00.000Z",
    rosterSize: 1,
    rosterMembers: roster,
    warnings: [{ level: "warn", message: "Old snapshot warning" }],
    summary: {
      openAssignedIssues: 1,
      closedIssues: 0,
      openAuthoredPrs: 1,
      mergedPrs: 2,
      reviewsSubmitted: 1,
      pendingReviewRequests: 0,
      uniqueReviewedPrs: 1,
      staleItems: 0,
      repositoriesTouched: 1,
      medianFirstReviewHours: 4,
      medianMergeHours: 8,
    },
    reviewOutcomes: { approved: 1, changesRequested: 0, commented: 0 },
    reviewSources: { selfAuthored: 0, teamAuthored: 1, externalAuthored: 0 },
    contributors: [],
    repoActivity: [],
    activityItems: [],
    syncHealth: {
      source: "live",
      generatedAt: "2026-03-10T00:00:00.000Z",
      freshnessMinutes: 999,
      searchSamples: 10,
      detailSamples: 5,
      liveEnabled: true,
    },
    filterOptions: {
      contributors: [{ login: "alice", name: "Alice" }],
      repos: ["zephyrproject-rtos/zephyr"],
    },
    auth: {
      hasToken: true,
      connectionStatus: "valid",
      message: "Connected",
      checkedAt: "2026-03-10T00:00:00.000Z",
    },
  };
}

function createDemoData(): DashboardData {
  return {
    ...createSnapshot(),
    generatedAt: "2026-03-12T00:00:00.000Z",
    warnings: [],
    auth: {
      hasToken: true,
      connectionStatus: "configured",
      message: "configured",
      checkedAt: null,
    },
    syncHealth: {
      source: "demo",
      generatedAt: "2026-03-12T00:00:00.000Z",
      freshnessMinutes: 0,
      searchSamples: 0,
      detailSamples: 0,
      liveEnabled: false,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  getGitHubEnvTokenMock.mockReturnValue("token");
  loadRosterMock.mockResolvedValue(roster);
  resolveRangeMock.mockReturnValue(range);
  buildDemoDashboardMock.mockReturnValue(createDemoData());
  mkdirMock.mockResolvedValue(undefined);
  writeFileMock.mockResolvedValue(undefined);
  filterDashboardDataMock.mockImplementation((data: DashboardData) => data);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getDashboardData", () => {
  it("uses cached snapshot by default without calling live sync", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(createSnapshot()));

    const { getDashboardData } = await import("@/lib/dashboard");
    const filters: DashboardFilters = { preset: "30d", contributors: [], repo: "all", refresh: false };

    const result = await getDashboardData(filters);

    expect(collectLiveDashboardMock).not.toHaveBeenCalled();
    expect(result.syncHealth.source).toBe("cache");
    expect(result.warnings.some((warning) => warning.message.includes("Showing cached snapshot"))).toBe(true);
    expect(result.summary.mergedPrs).toBe(2);
  });

  it("uses demo data by default when no snapshot exists", async () => {
    readFileMock.mockRejectedValue(new Error("missing snapshot"));

    const { getDashboardData } = await import("@/lib/dashboard");
    const filters: DashboardFilters = { preset: "30d", contributors: [], repo: "all", refresh: false };

    const result = await getDashboardData(filters);

    expect(collectLiveDashboardMock).not.toHaveBeenCalled();
    expect(result.syncHealth.source).toBe("demo");
    expect(result.warnings[0]?.message).toContain("No cached snapshot is available yet");
  });

  it("runs live sync only on explicit refresh", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(createSnapshot()));
    collectLiveDashboardMock.mockResolvedValue({
      ...createSnapshot(),
      generatedAt: "2026-03-12T00:00:00.000Z",
      auth: {
        hasToken: true,
        connectionStatus: "valid",
        message: "Connected to GitHub. Live sync completed successfully.",
        checkedAt: "2026-03-12T00:00:00.000Z",
      },
      syncHealth: {
        source: "live",
        generatedAt: "2026-03-12T00:00:00.000Z",
        freshnessMinutes: 0,
        searchSamples: 12,
        detailSamples: 6,
        liveEnabled: true,
      },
    });

    const { getDashboardData } = await import("@/lib/dashboard");
    const filters: DashboardFilters = { preset: "30d", contributors: [], repo: "all", refresh: true };

    const result = await getDashboardData(filters);

    expect(collectLiveDashboardMock).toHaveBeenCalledTimes(1);
    expect(result.syncHealth.source).toBe("live");
    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });

  it("uses cached snapshot during the cooldown after a rate-limited explicit refresh", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(createSnapshot()));
    collectLiveDashboardMock.mockRejectedValue(
      new MockGitHubRequestError(403, "Forbidden", 0, "/search/issues", '{"message":"API rate limit exceeded"}'),
    );

    const { getDashboardData } = await import("@/lib/dashboard");
    const refreshFilters: DashboardFilters = { preset: "30d", contributors: [], repo: "all", refresh: true };
    const normalFilters: DashboardFilters = { preset: "30d", contributors: [], repo: "all", refresh: false };

    const first = await getDashboardData(refreshFilters);
    const second = await getDashboardData(normalFilters);

    expect(collectLiveDashboardMock).toHaveBeenCalledTimes(1);
    expect(first.warnings[0]?.message).toContain("GitHub Search rate limit exceeded");
    expect(second.syncHealth.source).toBe("cache");
    expect(second.warnings.some((warning) => warning.message.includes("Showing cached snapshot"))).toBe(true);
  });
});
