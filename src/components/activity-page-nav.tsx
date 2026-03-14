"use client";

import clsx from "clsx";

import { buildDashboardHref } from "@/lib/dashboard-links";
import { DASHBOARD_VIEWS, getActivityPageTitle, type DashboardView } from "@/lib/dashboard-views";
import type { DashboardFilters } from "@/lib/types";

type ActivityPageNavProps = {
  currentView: DashboardView;
  filters: DashboardFilters;
};

export function ActivityPageNav({ currentView, filters }: ActivityPageNavProps) {
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
    </nav>
  );
}
