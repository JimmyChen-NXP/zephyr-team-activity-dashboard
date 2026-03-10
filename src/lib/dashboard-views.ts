import type { ActivityItem } from "@/lib/types";

export const DASHBOARD_VIEWS = ["issues", "pull-requests", "reviews"] as const;

export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

export function isDashboardView(value: string): value is DashboardView {
  return DASHBOARD_VIEWS.includes(value as DashboardView);
}

export function getActivityPageTitle(view: DashboardView) {
  switch (view) {
    case "issues":
      return "Issues";
    case "pull-requests":
      return "Pull Requests";
    case "reviews":
      return "Reviews";
  }
}

export function getActivityPageDescription(view: DashboardView) {
  switch (view) {
    case "issues":
      return "Focus on assigned issues only, with issue-scoped totals, repository activity, and contributor ranking.";
    case "pull-requests":
      return "Focus on authored pull requests only, with PR-scoped totals, repository activity, and contributor ranking.";
    case "reviews":
      return "Focus on submitted reviews only, with review-scoped totals, team/external split, and reviewer ranking.";
  }
}

export function isItemInDashboardView(item: ActivityItem, view: DashboardView) {
  switch (view) {
    case "issues":
      return item.type === "issue";
    case "pull-requests":
      return item.type === "pull_request";
    case "reviews":
      return item.type === "review";
  }
}
