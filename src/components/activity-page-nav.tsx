"use client";

import clsx from "clsx";

import { withBasePath } from "@/lib/base-path";
import { buildDashboardHref } from "@/lib/dashboard-links";
import { DASHBOARD_VIEWS, getActivityPageTitle, type DashboardView } from "@/lib/dashboard-views";
import type { DashboardFilters } from "@/lib/types";

const DEFAULT_FILTERS: DashboardFilters = {
  preset: "30d",
  contributors: [],
  repo: "all",
  refresh: false,
};

type ActivityPageNavProps = {
  currentView: DashboardView | "maintainers";
  filters?: DashboardFilters;
};

export function ActivityPageNav({ currentView, filters = DEFAULT_FILTERS }: ActivityPageNavProps) {
  return (
    <nav className="activity-page-nav-links" aria-label="Activity pages">
      {DASHBOARD_VIEWS.map((view) => {
        const href = buildDashboardHref(`/${view}`, filters);
        return (
          <a
            key={view}
            href={href}
            className={clsx("activity-page-link", currentView === view && "active")}
            aria-current={currentView === view ? "page" : undefined}
          >
            {getActivityPageTitle(view)}
          </a>
        );
      })}
      <a
        href={withBasePath("/maintainers")}
        className={clsx("activity-page-link", currentView === "maintainers" && "active")}
        aria-current={currentView === "maintainers" ? "page" : undefined}
      >
        Maintainers
      </a>
    </nav>
  );
}
