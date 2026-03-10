import clsx from "clsx";
import { formatDistanceToNow, formatISO9075 } from "date-fns";

import { DashboardCharts } from "@/components/charts";
import { ACTIVITY_SCORE_FORMULA } from "@/lib/scoring";
import type { DashboardData, DashboardFilters } from "@/lib/types";

type DashboardShellProps = {
  data: DashboardData;
  filters: DashboardFilters;
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

function formatTypeLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatReviewKind(value?: "team-pr" | "ext-pr") {
  if (value === "team-pr") {
    return "Team PR";
  }

  if (value === "ext-pr") {
    return "External PR";
  }

  return "—";
}

export function DashboardShell({ data, filters }: DashboardShellProps) {
  const contributorOptions = [{ login: "all", name: "All contributors" }, ...data.filterOptions.contributors];
  const repoOptions = [{ name: "all" }, ...data.filterOptions.repos.map((repo) => ({ name: repo }))];
  const currentLocation = `/?preset=${filters.preset}&contributor=${filters.contributor}&repo=${encodeURIComponent(filters.repo)}`;
  const selectedContributor = contributorOptions.find((option) => option.login === filters.contributor)?.name ?? "All contributors";
  const authoredPrs = data.activityItems.filter((item) => item.type === "pull_request");
  const reviewedPrs = data.activityItems.filter((item) => item.type === "review");
  const issues = data.activityItems.filter((item) => item.type === "issue");

  const summaryCards = [
    { label: "Open assigned issues", value: data.summary.openAssignedIssues, accent: "violet" },
    { label: "Open authored PRs", value: data.summary.openAuthoredPrs, accent: "blue" },
    { label: "Reviews submitted", value: data.summary.reviewsSubmitted, accent: "emerald" },
    { label: "Pending review requests", value: data.summary.pendingReviewRequests, accent: "amber" },
    { label: "Stale items", value: data.summary.staleItems, accent: "rose" },
    { label: "Merged PRs", value: data.summary.mergedPrs, accent: "violet" },
    { label: "Median first review", value: formatMetric(data.summary.medianFirstReviewHours, "h"), accent: "blue" },
    { label: "Median merge time", value: formatMetric(data.summary.medianMergeHours, "h"), accent: "emerald" },
  ];

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
            <span className={clsx("sync-dot", data.syncHealth.source)} />
            <span>
              {data.syncHealth.source === "demo" ? "Demo snapshot" : data.syncHealth.source === "cache" ? "Cached snapshot" : "Live sync"}
            </span>
          </div>
        </div>

        <form className="filter-form" action="/" method="get">
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
            <span>Contributor</span>
            <select name="contributor" defaultValue={filters.contributor}>
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
            <a
              className="ghost-button"
              href={`/api/export?preset=${filters.preset}&contributor=${filters.contributor}&repo=${filters.repo}`}
            >
              Export CSV
            </a>
          </div>
        </form>

        <div className="token-panel">
          <div>
            <p className="eyebrow">GitHub authentication</p>
            <h3>Provide or replace the GitHub token</h3>
            <p className="token-copy">
              Current source: <strong>{data.auth.tokenSource}</strong>. A token entered here is stored in a secure cookie and is used for live refreshes.
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

      <section className="summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className={clsx("summary-card", card.accent)}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <DashboardCharts repos={data.repoActivity} reviewOutcomes={data.reviewOutcomes} reviewSources={data.reviewSources} />

      <section className="panel detail-focus-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Contributor focus</p>
            <h2>{selectedContributor}</h2>
          </div>
          <div className="detail-focus-meta">
            <span>{authoredPrs.length} PR rows</span>
            <span>{reviewedPrs.length} reviewed rows</span>
            <span>{issues.length} issue rows</span>
          </div>
        </div>
        <p className="token-copy">
          Click a contributor row or use the filter dropdown to narrow these tables. Reviewed rows mark whether the PR author is in the team roster.
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
                  <th>Issues</th>
                  <th>Open PRs</th>
                  <th>Merged</th>
                  <th>Reviews</th>
                  <th>Pending requests</th>
                  <th>Repos</th>
                  <th>
                    <span className="help-label" title={ACTIVITY_SCORE_FORMULA}>
                      Activity score ⓘ
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.contributors.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state-cell">
                      No contributors matched the current filters for this range.
                    </td>
                  </tr>
                ) : (
                  data.contributors.map((contributor) => (
                    <tr key={contributor.login}>
                      <td>
                        <div className="person-cell">
                          <a
                            className="table-link"
                            href={`/?preset=${filters.preset}&contributor=${contributor.login}&repo=${encodeURIComponent(filters.repo)}`}
                          >
                            <strong>{contributor.name}</strong>
                          </a>
                          <span>@{contributor.login}</span>
                        </div>
                      </td>
                      <td>{contributor.openAssignedIssues}</td>
                      <td>{contributor.openAuthoredPrs}</td>
                      <td>{contributor.mergedPrs}</td>
                      <td>{contributor.reviewsSubmitted}</td>
                      <td>{contributor.pendingReviewRequests}</td>
                      <td>{contributor.repositoriesTouched}</td>
                      <td>{contributor.activityScore}</td>
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
              {data.warnings.length === 0 ? (
                <div className="warning-item info">No warnings. Coverage looks healthy.</div>
              ) : (
                data.warnings.map((warning) => (
                  <div key={warning.message} className={clsx("warning-item", warning.level)}>
                    {warning.message}
                  </div>
                ))
              )}
            </div>
            <div className="sync-card">
              <div>
                <span className="meta-label">Generated</span>
                <strong>{formatISO9075(new Date(data.generatedAt))}</strong>
              </div>
              <div>
                <span className="meta-label">Freshness</span>
                <strong>{formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })}</strong>
              </div>
              <div>
                <span className="meta-label">Search samples</span>
                <strong>{data.syncHealth.searchSamples}</strong>
              </div>
              <div>
                <span className="meta-label">Detail samples</span>
                <strong>{data.syncHealth.detailSamples}</strong>
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
              {data.repoActivity.length === 0 ? (
                <li className="empty-state-item">No repositories matched the current filters.</li>
              ) : (
                data.repoActivity.slice(0, 8).map((repo) => (
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

      <div className="detail-table-grid">
        <section className="panel table-panel">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Authored PRs</p>
              <h2>Pull requests</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PR</th>
                  <th>Repository</th>
                  <th>Contributor</th>
                  <th>State</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {authoredPrs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-state-cell">
                      No authored PRs matched the current selection.
                    </td>
                  </tr>
                ) : (
                  authoredPrs.slice(0, 40).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <a href={item.url} target="_blank" rel="noreferrer" className="table-link">
                          {item.title}
                        </a>
                      </td>
                      <td>{item.repo}</td>
                      <td>@{item.contributor}</td>
                      <td>{item.statusLabel}</td>
                      <td>{formatISO9075(new Date(item.updatedAt))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel table-panel">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Reviewed PRs</p>
              <h2>Reviews with team/external split</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reviewed PR</th>
                  <th>Repository</th>
                  <th>Reviewer</th>
                  <th>PR type</th>
                  <th>Outcome</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {reviewedPrs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-state-cell">
                      No reviewed PRs matched the current selection.
                    </td>
                  </tr>
                ) : (
                  reviewedPrs.slice(0, 40).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <a href={item.url} target="_blank" rel="noreferrer" className="table-link">
                          {item.title}
                        </a>
                      </td>
                      <td>{item.repo}</td>
                      <td>@{item.contributor}</td>
                      <td>{formatReviewKind(item.reviewedPrKind)}</td>
                      <td>{formatTypeLabel(item.state)}</td>
                      <td>{formatISO9075(new Date(item.updatedAt))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel table-panel detail-span-full">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Assigned issues</p>
              <h2>Issue list</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Repository</th>
                  <th>Contributor</th>
                  <th>State</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {issues.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-state-cell">
                      No issues matched the current selection.
                    </td>
                  </tr>
                ) : (
                  issues.slice(0, 40).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <a href={item.url} target="_blank" rel="noreferrer" className="table-link">
                          {item.title}
                        </a>
                      </td>
                      <td>{item.repo}</td>
                      <td>@{item.contributor}</td>
                      <td>{item.statusLabel}</td>
                      <td>{formatISO9075(new Date(item.updatedAt))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
