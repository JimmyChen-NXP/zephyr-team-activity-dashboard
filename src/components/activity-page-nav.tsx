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
    <nav className="activity-page-nav panel" aria-label="Activity pages">
      <div>
        <p className="eyebrow">Activity pages</p>
        <h2>Switch activity context</h2>
      </div>
      <div className="activity-page-nav-links">
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
      </div>
    </nav>
  );
}
