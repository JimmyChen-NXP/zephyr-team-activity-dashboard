"use client";

import clsx from "clsx";
import { formatDistanceToNow, formatISO9075 } from "date-fns";

import { ActivityPageNav } from "@/components/activity-page-nav";
import { AuthoredPrsTable } from "@/components/authored-prs-table";
import { ConnectionTestButton } from "@/components/connection-test-button";
import { ExportCsvButton } from "@/components/export-csv-button";
import { IssuesTable } from "@/components/issues-table";
import { ReviewedPrsTable } from "@/components/reviewed-prs-table";
import {
  buildViewDashboardData,
  getContributorColumns,
  getDetailCountLabel,
  getSummaryCards,
} from "@/lib/dashboard-aggregates";
import { withBasePath } from "@/lib/base-path";
import { buildDashboardHref, buildExportHref } from "@/lib/dashboard-links";
import { getActivityPageDescription, getActivityPageTitle, type DashboardView } from "@/lib/dashboard-views";
import type { DashboardData, DashboardFilters, DashboardAuth } from "@/lib/types";

type DashboardShellProps = {
  data: DashboardData;
  filters: DashboardFilters;
  view: DashboardView;
  pathname: string;
  isHostedSnapshot?: boolean;
  updateDataUrl?: string;
  updateOpenItemsUrl?: string;
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

function getAuthStatusLabel(auth: DashboardAuth) {
  switch (auth.connectionStatus) {
    case "missing":
      return "Missing";
    case "configured":
      return "Configured";
    case "valid":
      return "Connected";
    case "invalid":
      return "Invalid";
    case "rate-limited":
      return "Rate limited";
    case "error":
      return "Connection error";
  }
}

function getSyncSourceLabel(source: DashboardData["syncHealth"]["source"]) {
  switch (source) {
    case "demo":
      return "Demo snapshot";
    case "cache":
      return "Cached snapshot";
    case "live":
      return "Live sync";
  }
}

export function DashboardShell({ data, filters, view, pathname, isHostedSnapshot = false, updateDataUrl, updateOpenItemsUrl }: DashboardShellProps) {
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
  const contributorColumns = getContributorColumns(view).filter((col) => col.key !== "score");
  const detailCountLabel = getDetailCountLabel(viewData, view);
  const pageTitle = getActivityPageTitle(view);
  const pageDescription = getActivityPageDescription(view);

  return (
    <div className="dashboard-shell">
      <div className="title-bar">
        <span className="title-bar-name">Zephyr team activity</span>
        <ActivityPageNav currentView={view} filters={filters} />
      </div>

      <section className="panel filter-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Controls</p>
            <h2>Filter and sync</h2>
          </div>
          <div className="sync-pill">
            <span className={clsx("sync-dot", viewData.syncHealth.source)} />
            <span>{getSyncSourceLabel(viewData.syncHealth.source)}</span>
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
            {isHostedSnapshot ? (
              updateDataUrl ? (
                <a className="secondary-button" href={updateDataUrl} target="_blank" rel="noreferrer">
                  Update data
                </a>
              ) : null
            ) : (
              <button type="submit" className="secondary-button" name="refresh" value="1">
                Refresh now
              </button>
            )}
            {isHostedSnapshot && updateOpenItemsUrl ? (
              <a className="ghost-button" href={updateOpenItemsUrl} target="_blank" rel="noreferrer">
                Refresh open items
              </a>
            ) : null}
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
                    <tr key={contributor.login}>
                      <td>
                        <a
                          className="table-link"
                          href={buildDashboardHref(pathname, { ...filters, contributors: [contributor.login], refresh: false })}
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
        {view === "issues" ? <IssuesTable items={viewData.activityItems} /> : null}
        {view === "pull-requests" ? <AuthoredPrsTable items={viewData.activityItems} /> : null}
        {view === "reviews" ? <ReviewedPrsTable items={viewData.activityItems} /> : null}
      </div>

      <div className="status-strip">
        <article className="status-card">
          <div className="status-card-header">
            <div>
              <p className="eyebrow">GitHub connection</p>
              <h3>{getAuthStatusLabel(viewData.auth)}</h3>
            </div>
            <span className={clsx("status-pill", `status-pill-${viewData.auth.connectionStatus}`)}>{getAuthStatusLabel(viewData.auth)}</span>
          </div>
          <p className="token-copy">{viewData.auth.message}</p>
          {isHostedSnapshot ? (
            <p className="token-copy connection-test-copy">Snapshot mode. Use Update data to run the GitHub Action and refresh this page after it finishes.</p>
          ) : (
            <ConnectionTestButton />
          )}
        </article>

        <article className="status-card">
          <div className="status-card-header">
            <div>
              <p className="eyebrow">Active source</p>
              <h3>{getSyncSourceLabel(viewData.syncHealth.source)}</h3>
            </div>
          </div>
          <p className="token-copy">
            {viewData.syncHealth.source === "live"
              ? "This page was built from a live GitHub sync."
              : viewData.syncHealth.source === "cache"
                ? "This page is currently using the latest cached snapshot."
                : "This page is currently using demo data."}
          </p>
        </article>

        <article className="status-card">
          <div className="status-card-header">
            <div>
              <p className="eyebrow">Last update</p>
              <h3>{formatDistanceToNow(new Date(viewData.generatedAt), { addSuffix: true })}</h3>
            </div>
          </div>
          <p className="token-copy">
            Generated {formatISO9075(new Date(viewData.generatedAt))}
            {viewData.auth.checkedAt ? ` · Connection checked ${formatDistanceToNow(new Date(viewData.auth.checkedAt), { addSuffix: true })}` : ""}
          </p>
        </article>

        <article className="status-card">
          <div className="status-card-header">
            <div>
              <p className="eyebrow">Warnings</p>
              <h3>{viewData.warnings.length === 0 ? "No warnings" : `${viewData.warnings.length} warning${viewData.warnings.length === 1 ? "" : "s"}`}</h3>
            </div>
          </div>
          <div className="warning-list">
            {viewData.warnings.length === 0 ? (
              <div className="warning-item info">No warnings. Coverage looks healthy.</div>
            ) : (
              viewData.warnings.map((warning) => (
                <div key={warning.message} className={clsx("warning-item", warning.level)}>
                  {warning.message}
                </div>
              ))
            )}
          </div>
        </article>
      </div>

      <section className="panel detail-focus-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Activity context</p>
            <h2>{pageTitle}</h2>
          </div>
          <div className="detail-focus-meta">
            <span>{detailCountLabel}</span>
            <span>{viewData.contributors.length} active contributors</span>
          </div>
        </div>
        <p className="token-copy">{pageDescription}</p>
      </section>
    </div>
  );
}
