import clsx from "clsx";
import { formatDistanceToNow, formatISO9075 } from "date-fns";

import { ActivityPageNav } from "@/components/activity-page-nav";
import { AuthoredPrsTable } from "@/components/authored-prs-table";
import { DashboardCharts } from "@/components/charts";
import { IssuesTable } from "@/components/issues-table";
import { ReviewedPrsTable } from "@/components/reviewed-prs-table";
import {
  buildViewDashboardData,
  getContributorColumns,
  getDetailCountLabel,
  getSummaryCards,
  getViewScoreFormula,
  getViewScoreLabel,
} from "@/lib/dashboard-aggregates";
import { buildDashboardHref, buildExportHref } from "@/lib/dashboard-links";
import { getActivityPageDescription, getActivityPageTitle, type DashboardView } from "@/lib/dashboard-views";
import type { DashboardData, DashboardFilters } from "@/lib/types";

type DashboardShellProps = {
  data: DashboardData;
  filters: DashboardFilters;
  view: DashboardView;
  pathname: string;
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

export function DashboardShell({ data, filters, view, pathname }: DashboardShellProps) {
  const viewData = buildViewDashboardData(data, view);
  const contributorOptions = viewData.filterOptions.contributors;
  const repoOptions = [{ name: "all" }, ...viewData.filterOptions.repos.map((repo) => ({ name: repo }))];
  const currentLocation = buildDashboardHref(pathname, filters);
  const selectedContributor =
    filters.contributors.length === 0
      ? "All contributors"
      : contributorOptions
          .filter((option) => filters.contributors.includes(option.login))
          .map((option) => option.name)
          .join(", ");
  const summaryCards = getSummaryCards(viewData, view);
  const contributorColumns = getContributorColumns(view);
  const scoreLabel = getViewScoreLabel(view);
  const scoreFormula = getViewScoreFormula(view);
  const detailCountLabel = getDetailCountLabel(viewData, view);
  const pageTitle = getActivityPageTitle(view);
  const pageDescription = getActivityPageDescription(view);
  const summaryHighlights = summaryCards.slice(0, 3).map((card) => ({ label: card.label, value: card.value }));

  return (
    <div className="dashboard-shell">
      <section className="hero panel">
        <div>
          <p className="eyebrow">Internal analytics cockpit</p>
          <h1>Zephyr team activity dashboard</h1>
          <p className="hero-copy">
            Track workload, review pressure, and repo concentration across the configured NXP upstream roster. Snapshot-first,
            with selective live refresh for the views that drift fastest.
          </p>
        </div>
        <div className="hero-meta">
          <div>
            <span className="meta-label">Roster size</span>
            <strong>{data.rosterSize}</strong>
          </div>
          <div>
            <span className="meta-label">Time window</span>
            <strong>{data.range.label}</strong>
          </div>
          <div>
            <span className="meta-label">Timezone</span>
            <strong>{data.range.timeZone}</strong>
          </div>
        </div>
      </section>

      <section className="panel filter-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Controls</p>
            <h2>Filter and refresh</h2>
          </div>
          <div className="sync-pill">
            <span className={clsx("sync-dot", viewData.syncHealth.source)} />
            <span>
              {viewData.syncHealth.source === "demo" ? "Demo snapshot" : viewData.syncHealth.source === "cache" ? "Cached snapshot" : "Live sync"}
            </span>
          </div>
        </div>

        <form className="filter-form" action={pathname} method="get">
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

          <label>
            <span>Contributors</span>
            <select name="contributor" defaultValue={filters.contributors} multiple size={Math.min(8, Math.max(4, contributorOptions.length))}>
              {contributorOptions.map((option) => (
                <option key={option.login} value={option.login}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>

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
            <button type="submit" className="secondary-button" name="refresh" value="1">
              Refresh now
            </button>
            <a className="ghost-button" href={buildExportHref(view, filters)}>
              Export CSV
            </a>
          </div>
        </form>

        <div className="token-panel">
          <div>
            <p className="eyebrow">GitHub authentication</p>
            <h3>Provide or replace the GitHub token</h3>
            <p className="token-copy">
              Current source: <strong>{viewData.auth.tokenSource}</strong>. A token entered here is stored in a secure cookie and is used for live refreshes.
            </p>
          </div>

          <form className="token-form" action="/api/token" method="post">
            <input type="hidden" name="returnTo" value={currentLocation} />
            <label>
              <span>GitHub token</span>
              <input name="token" type="password" placeholder="ghp_..." autoComplete="off" />
            </label>
            <div className="filter-actions">
              <button type="submit" className="primary-button" name="action" value="save">
                Save token
              </button>
              <button type="submit" className="ghost-button" name="action" value="clear">
                Clear token
              </button>
            </div>
          </form>
        </div>
      </section>

      <ActivityPageNav currentView={view} filters={filters} />

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

      <section className="summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className={clsx("summary-card", card.accent)}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <DashboardCharts
        view={view}
        repos={viewData.repoActivity}
        reviewOutcomes={viewData.reviewOutcomes}
        reviewSources={viewData.reviewSources}
        summaryHighlights={summaryHighlights}
      />

      <section className="panel detail-focus-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Contributor focus</p>
            <h2>{selectedContributor}</h2>
          </div>
          <div className="detail-focus-meta">
            <span>{detailCountLabel}</span>
            <span>{scoreLabel} ranking</span>
          </div>
        </div>
        <p className="token-copy">
          Click a contributor row or use the filter dropdown to narrow this page. All summary cards, charts, and contributor ranking are scoped to the active activity type.
        </p>
      </section>

      <div className="content-grid">
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
                    <th key={column.key}>
                      {column.label === scoreLabel ? (
                        <span className="help-label" title={scoreFormula}>
                          {column.label} ⓘ
                        </span>
                      ) : (
                        column.label
                      )}
                    </th>
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
                        <div className="person-cell">
                          <a
                            className="table-link"
                            href={buildDashboardHref(pathname, { ...filters, contributors: [contributor.login], refresh: false })}
                          >
                            <strong>{contributor.name}</strong>
                          </a>
                          <span>@{contributor.login}</span>
                        </div>
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

        <aside className="stack-column">
          <section className="panel warning-panel">
            <div className="panel-header compact">
              <div>
                <p className="eyebrow">Signals</p>
                <h2>Warnings and sync health</h2>
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
            <div className="sync-card">
              <div>
                <span className="meta-label">Generated</span>
                <strong>{formatISO9075(new Date(viewData.generatedAt))}</strong>
              </div>
              <div>
                <span className="meta-label">Freshness</span>
                <strong>{formatDistanceToNow(new Date(viewData.generatedAt), { addSuffix: true })}</strong>
              </div>
              <div>
                <span className="meta-label">Search samples</span>
                <strong>{viewData.syncHealth.searchSamples}</strong>
              </div>
              <div>
                <span className="meta-label">Detail samples</span>
                <strong>{viewData.syncHealth.detailSamples}</strong>
              </div>
            </div>
          </section>

          <section className="panel repo-panel">
            <div className="panel-header compact">
              <div>
                <p className="eyebrow">Repo coverage</p>
                <h2>Top touched repositories</h2>
              </div>
            </div>
            <ul className="repo-list">
              {viewData.repoActivity.length === 0 ? (
                <li className="empty-state-item">No repositories matched the current filters.</li>
              ) : (
                viewData.repoActivity.slice(0, 8).map((repo) => (
                  <li key={repo.name}>
                    <div>
                      <strong>{repo.name}</strong>
                      <span>{repo.contributors} contributors</span>
                    </div>
                    <div className="repo-metrics">
                      <span>{repo.issues} issues</span>
                      <span>{repo.prs} PRs</span>
                      <span>{repo.reviews} reviews</span>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>
        </aside>
      </div>

      {view === "issues" ? <IssuesTable items={viewData.activityItems} /> : null}
      {view === "pull-requests" ? <AuthoredPrsTable items={viewData.activityItems} /> : null}
      {view === "reviews" ? <ReviewedPrsTable items={viewData.activityItems} /> : null}
    </div>
  );
}
