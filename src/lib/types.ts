export type DashboardPreset = "7d" | "30d" | "90d";

export type RosterMember = {
  login: string;
  name: string;
  email: string | null;
  createdAt: string | null;
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

export type ReviewSourceBreakdown = {
  selfAuthored: number;
  teamAuthored: number;
  externalAuthored: number;
};

export type ActivityMetricDelta = {
  openAssignedIssues: number;
  closedIssues: number;
  openAuthoredPrs: number;
  draftPrs: number;
  mergedPrs: number;
  closedUnmergedPrs: number;
  reviewsSubmitted: number;
  pendingReviewRequests: number;
  staleItems: number;
  reviewApproved: number;
  reviewChangesRequested: number;
  reviewCommented: number;
  reviewSelfAuthored: number;
  reviewTeamAuthored: number;
  reviewExternalAuthored: number;
};

export type ContributorMetrics = {
  login: string;
  name: string;
  role: string;
  openAssignedIssues: number;
  closedIssues: number;
  openAuthoredPrs: number;
  draftPrs: number;
  mergedPrs: number;
  closedUnmergedPrs: number;
  reviewsSubmitted: number;
  pendingReviewRequests: number;
  staleItems: number;
  uniqueReviewedPrs: number;
  uniqueReviewedPrsSelfAuthored?: number;
  uniqueReviewedPrsTeamAuthored?: number;
  uniqueReviewedPrsExternalAuthored?: number;
  reviewSelfAuthored: number;
  reviewTeamAuthored: number;
  reviewExternalAuthored: number;
  reviewCommented: number;
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

export type ActivityItemType = "issue" | "pull_request" | "review" | "review_request";

export type ReviewedPrKind = "authored-by-self" | "authored-by-them" | "authored-external";

export type ReviewerVerdict = {
  login: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  wasRequested: boolean;
};

export type PrStatusSummary = {
  /** GitHub assignees for this PR (distinct from requested reviewers) */
  assignees: string[];
  /** Reviewers who were in requestedReviewers AND have submitted a verdict */
  requestedVerdicts: ReviewerVerdict[];
  /** Reviewers who submitted a verdict but were NOT in requestedReviewers */
  otherVerdicts: ReviewerVerdict[];
  /** Logins of requestedReviewers who have not yet submitted any verdict */
  pendingRequestedLogins: string[];
  /** Count of requestedReviewers who have not yet submitted any verdict */
  pendingRequestedCount: number;
  ciStatus: "success" | "failure" | "pending" | null;
  cooldownHours: number;
  cooldownMet: boolean;
};

export type ActivityItem = {
  id: string;
  type: ActivityItemType;
  title: string;
  url: string;
  repo: string;
  contributor: string;
  author: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  ageDays: number;
  statusLabel: string;
  reviewedPrKind?: ReviewedPrKind;
  labels?: string[]; // GitHub label names; undefined for records collected before labels were captured
  /** Only set for type === "pull_request" and state === "open" */
  prStatus?: PrStatusSummary;
  metrics: ActivityMetricDelta;
};

export type SyncHealth = {
  source: "live" | "cache" | "demo";
  generatedAt: string;
  freshnessMinutes: number;
  searchSamples: number;
  detailSamples: number;
  liveEnabled: boolean;
};

export type GitHubConnectionStatus = "missing" | "configured" | "valid" | "invalid" | "rate-limited" | "error";

export type DashboardAuth = {
  hasToken: boolean;
  connectionStatus: GitHubConnectionStatus;
  message: string;
  checkedAt: string | null;
};

export type DashboardSummary = {
  openAssignedIssues: number;
  closedIssues: number;
  openAuthoredPrs: number;
  mergedPrs: number;
  reviewsSubmitted: number;
  pendingReviewRequests: number;
  uniqueReviewedPrs: number;
  staleItems: number;
  repositoriesTouched: number;
  medianFirstReviewHours: number | null;
  medianMergeHours: number | null;
};

export type DashboardData = {
  range: RangeOption;
  generatedAt: string;
  rosterSize: number;
  rosterMembers: RosterMember[];
  warnings: DashboardWarning[];
  summary: DashboardSummary;
  reviewOutcomes: ReviewOutcomeBreakdown;
  reviewSources: ReviewSourceBreakdown;
  contributors: ContributorMetrics[];
  repoActivity: RepoActivity[];
  activityItems: ActivityItem[];
  syncHealth: SyncHealth;
  filterOptions: {
    contributors: Array<{ login: string; name: string }>;
    repos: string[];
  };
  auth: DashboardAuth;
};

export type DashboardFilters = {
  preset: DashboardPreset;
  contributors: string[];
  repo: string;
  refresh: boolean;
};
