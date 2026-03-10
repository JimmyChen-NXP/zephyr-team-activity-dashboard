export type DashboardPreset = "7d" | "30d" | "90d";

export type RosterMember = {
  login: string;
  name: string;
  email: string | null;
  createdAt: string;
  role: string;
};

export type RangeOption = {
  preset: DashboardPreset;
  label: string;
  from: string;
  to: string;
  timeZone: string;
};

export type WarningLevel = "info" | "warn" | "error";

export type DashboardWarning = {
  level: WarningLevel;
  message: string;
};

export type ReviewOutcomeBreakdown = {
  approved: number;
  changesRequested: number;
  commented: number;
};

export type ContributorMetrics = {
  login: string;
  name: string;
  role: string;
  openAssignedIssues: number;
  openAuthoredPrs: number;
  draftPrs: number;
  mergedPrs: number;
  closedUnmergedPrs: number;
  reviewsSubmitted: number;
  pendingReviewRequests: number;
  staleItems: number;
  repositoriesTouched: number;
  activityScore: number;
};

export type RepoActivity = {
  name: string;
  issues: number;
  prs: number;
  reviews: number;
  contributors: number;
};

export type ActivityItemType = "issue" | "pull_request" | "review";

export type ActivityItem = {
  id: string;
  type: ActivityItemType;
  title: string;
  url: string;
  repo: string;
  contributor: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  ageDays: number;
  statusLabel: string;
};

export type SyncHealth = {
  source: "live" | "cache" | "demo";
  generatedAt: string;
  freshnessMinutes: number;
  searchSamples: number;
  detailSamples: number;
  liveEnabled: boolean;
};

export type DashboardSummary = {
  openAssignedIssues: number;
  openAuthoredPrs: number;
  mergedPrs: number;
  reviewsSubmitted: number;
  pendingReviewRequests: number;
  staleItems: number;
  repositoriesTouched: number;
  medianFirstReviewHours: number | null;
  medianMergeHours: number | null;
};

export type DashboardData = {
  range: RangeOption;
  generatedAt: string;
  rosterSize: number;
  warnings: DashboardWarning[];
  summary: DashboardSummary;
  reviewOutcomes: ReviewOutcomeBreakdown;
  contributors: ContributorMetrics[];
  repoActivity: RepoActivity[];
  activityItems: ActivityItem[];
  syncHealth: SyncHealth;
};

export type DashboardFilters = {
  preset: DashboardPreset;
  contributor: string;
  repo: string;
  refresh: boolean;
};
