"use client";

import clsx from "clsx";
import { formatDistanceToNow, formatISO9075 } from "date-fns";
import { useState } from "react";

import { ActivityPageNav } from "@/components/activity-page-nav";
import { AuthoredPrsTable } from "@/components/authored-prs-table";
import { ExportCsvButton } from "@/components/export-csv-button";
import { IssuesTable } from "@/components/issues-table";
import { ReviewedPrsTable } from "@/components/reviewed-prs-table";
import {
  buildViewDashboardData,
  getContributorColumns,
  getSummaryCards,
} from "@/lib/dashboard-aggregates";
import { withBasePath } from "@/lib/base-path";
import { buildDashboardHref, buildExportHref } from "@/lib/dashboard-links";
import type { DashboardView } from "@/lib/dashboard-views";
import type { DashboardData, DashboardFilters } from "@/lib/types";

type DashboardShellProps = {
  data: DashboardData;
  filters: DashboardFilters;
  view: DashboardView;
  pathname: string;
  isHostedSnapshot?: boolean;
};

const PRESET_OPTIONS: Array<{ value: DashboardFilters["preset"]; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

function formatMetric(value: number | null, suffix = "") {
  if (value === null) {
    return "—";
  }

  return `${value}${suffix}`;
}


export function DashboardShell({ data, filters, view, pathname, isHostedSnapshot = false }: DashboardShellProps) {
  const actionPath = withBasePath(pathname);
  const viewData = buildViewDashboardData(data, view);
  const contributorOptions = viewData.filterOptions.contributors;
  const repoOptions = [{ name: "all" }, ...viewData.filterOptions.repos.map((repo) => ({ name: repo }))];
  const selectedContributor =
    filters.contributors.length === 0
      ? "All contributors"
      : contributorOptions
          .filter((option) => filters.contributors.includes(option.login))
          .map((option) => option.name)
          .join(", ");
  const summaryCards = getSummaryCards(viewData, view);
  const contributorColumns = getContributorColumns(view).filter(
    (col) => col.key !== "score" && !(view === "reviews" && col.key === "reviews"),
  );

  const [localContributor, setLocalContributor] = useState<string | null>(null);
  const detailItems = localContributor
    ? viewData.activityItems.filter((item) => item.contributor === localContributor)
    : viewData.activityItems;
  const localContributorName = localContributor
    ? (contributorOptions.find((c) => c.login === localContributor)?.name ?? localContributor)
    : null;

  return (
    <div className="dashboard-shell">
      <div className="title-bar">
        <span className="title-bar-name">Zephyr team activity</span>
        <span className="title-bar-timestamp">
          {formatDistanceToNow(new Date(viewData.generatedAt), { addSuffix: true })}
          {" · "}
          {formatISO9075(new Date(viewData.generatedAt))}
        </span>
        <ActivityPageNav currentView={view} filters={filters} />
      </div>

      <section className="panel filter-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Controls</p>
            <h2>Filter and sync</h2>
          </div>
        </div>

        <form className="filter-form" action={actionPath} method="get">
          <label>
            <span>Range</span>
            <select name="preset" defaultValue={filters.preset}>
              {PRESET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="filter-field">
            <span id="contributors-filter-label">Contributors</span>
            <details className="filter-dropdown" aria-labelledby="contributors-filter-label">
              <summary>{selectedContributor}</summary>
              <div className="filter-dropdown-panel">
                <a className="filter-dropdown-clear" href={buildDashboardHref(pathname, { ...filters, contributors: [], refresh: false })}>
                  All contributors
                </a>
                <div className="filter-dropdown-options">
                  {contributorOptions.map((option) => (
                    <div key={option.login} className="filter-dropdown-option">
                      <input
                        id={`contributor-${option.login}`}
                        type="checkbox"
                        name="contributor"
                        value={option.login}
                        defaultChecked={filters.contributors.includes(option.login)}
                      />
                      <label htmlFor={`contributor-${option.login}`}>{option.name}</label>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          </div>

          <label>
            <span>Repository</span>
            <select name="repo" defaultValue={filters.repo}>
              {repoOptions.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.name === "all" ? "All repositories" : option.name}
                </option>
              ))}
            </select>
          </label>

          <div className="filter-actions">
            <button type="submit" className="primary-button">
              Apply filters
            </button>
            {!isHostedSnapshot && (
              <button type="submit" className="secondary-button" name="refresh" value="1">
                Refresh now
              </button>
            )}
            {isHostedSnapshot ? (
              <ExportCsvButton filename={`zephyr-team-activity-${view}-${filters.preset}.csv`} items={viewData.activityItems} />
            ) : (
              <a className="ghost-button" href={buildExportHref(view, filters)}>
                Export CSV
              </a>
            )}
          </div>
        </form>
      </section>

      <section className="summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className={clsx("summary-card", card.accent)}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <div className="tables-grid">
        <section className="panel table-panel">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Contributor load</p>
              <h2>Who is carrying the queue</h2>
              {view === "reviews" && (
                <p className="contributor-table-note">Teammate / External columns: PRs / Review activities</p>
              )}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contributor</th>
                  {contributorColumns.map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {viewData.contributors.length === 0 ? (
                  <tr>
                    <td colSpan={1 + contributorColumns.length} className="empty-state-cell">
                      No contributors matched the current filters for this activity view.
                    </td>
                  </tr>
                ) : (
                  viewData.contributors.map((contributor) => (
                    <tr
                      key={contributor.login}
                      className={clsx("contributor-row", localContributor === contributor.login && "is-selected")}
                      onClick={() => setLocalContributor(localContributor === contributor.login ? null : contributor.login)}
                      title={localContributor === contributor.login ? "Click to clear focus" : `Click to focus ${contributor.name} in detail table`}
                    >
                      <td>
                        <a
                          className="table-link"
                          href={buildDashboardHref(pathname, { ...filters, contributors: [contributor.login], refresh: false })}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <strong>{contributor.name}</strong>
                        </a>
                      </td>
                      {contributorColumns.map((column) => (
                        <td key={column.key}>{column.value(contributor)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        <div className="detail-table-column">
          {localContributorName ? (
            <div className="local-filter-bar">
              <span>Focusing: <strong>{localContributorName}</strong></span>
              <button type="button" className="local-filter-clear" onClick={() => setLocalContributor(null)}>
                ×
              </button>
            </div>
          ) : null}
          {view === "issues" ? <IssuesTable items={detailItems} /> : null}
          {view === "pull-requests" ? <AuthoredPrsTable items={detailItems} /> : null}
          {view === "reviews" ? <ReviewedPrsTable items={detailItems} /> : null}
        </div>
      </div>

    </div>
  );
}
