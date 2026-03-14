"use client";

import { formatDistanceToNowStrict } from "date-fns";

import type { ActivityItem, PrStatusSummary } from "@/lib/types";

type AuthoredPrsTableProps = {
  items: ActivityItem[];
};

function getPrHighlight(item: ActivityItem): "blocked" | "draft" | "stale" | undefined {
  if (item.prStatus) {
    const { requestedVerdicts, ciStatus } = item.prStatus;
    if (requestedVerdicts.some((v) => v.state === "CHANGES_REQUESTED") || ciStatus === "failure") {
      return "blocked";
    }
  }
  if (item.statusLabel === "Draft PR") return "draft";
  if (item.ageDays >= 30) return "stale";
  return undefined;
}

function daysAgo(dateStr: string): string {
  return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true });
}

function repoShortName(repo: string): string {
  return repo.split("/").at(-1) ?? repo;
}

const VERDICT_ICON: Record<string, string> = {
  APPROVED: "✓",
  CHANGES_REQUESTED: "✗",
  COMMENTED: "○",
};

const VERDICT_CLASS: Record<string, string> = {
  APPROVED: "pr-badge pr-badge-approved",
  CHANGES_REQUESTED: "pr-badge pr-badge-changes",
  COMMENTED: "pr-badge pr-badge-commented",
};

function AssigneesCell({ prStatus }: { prStatus: PrStatusSummary }) {
  const assignees = prStatus.assignees ?? [];
  if (assignees.length === 0) return <span className="pr-badge-empty">—</span>;
  return (
    <span className="pr-badges">
      {assignees.map((login) => (
        <span key={login} className="pr-badge pr-badge-commented">{login}</span>
      ))}
    </span>
  );
}

function RequestedCell({ prStatus }: { prStatus: PrStatusSummary }) {
  const { requestedVerdicts, pendingRequestedLogins = [] } = prStatus;
  const items: React.ReactNode[] = [];

  for (const login of pendingRequestedLogins) {
    items.push(
      <span key={`p-${login}`} className="pr-badge pr-badge-pending" title="Pending review">
        ⏳ {login}
      </span>,
    );
  }
  for (const v of requestedVerdicts) {
    items.push(
      <span key={`v-${v.login}`} className={VERDICT_CLASS[v.state] ?? "pr-badge"} title={v.state.replace(/_/g, " ")}>
        {VERDICT_ICON[v.state]} {v.login}
      </span>,
    );
  }

  if (items.length === 0) return <span className="pr-badge-empty">—</span>;
  return <span className="pr-badges">{items}</span>;
}

function ReviewersCell({ prStatus }: { prStatus: PrStatusSummary }) {
  const { otherVerdicts } = prStatus;
  const approved = otherVerdicts.filter((v) => v.state === "APPROVED").length;
  const changes = otherVerdicts.filter((v) => v.state === "CHANGES_REQUESTED").length;
  const commented = otherVerdicts.filter((v) => v.state === "COMMENTED").length;

  const parts: React.ReactNode[] = [];
  if (approved > 0) parts.push(<span key="a" className="pr-badge pr-badge-approved" title={`${approved} approval(s)`}>✓{approved}</span>);
  if (changes > 0) parts.push(<span key="c" className="pr-badge pr-badge-changes" title={`${changes} changes requested`}>✗{changes}</span>);
  if (commented > 0) parts.push(<span key="o" className="pr-badge pr-badge-commented" title={`${commented} comment review(s)`}>○{commented}</span>);

  if (parts.length === 0) return <span className="pr-badge-empty">—</span>;
  return <span className="pr-badges">{parts}</span>;
}

function CiCell({ ciStatus }: { ciStatus: PrStatusSummary["ciStatus"] }) {
  if (ciStatus === "success") return <span className="pr-badge pr-badge-ci-success" title="CI passing">✓</span>;
  if (ciStatus === "failure") return <span className="pr-badge pr-badge-ci-failure" title="CI failing">✗</span>;
  if (ciStatus === "pending") return <span className="pr-badge pr-badge-ci-pending" title="CI running">…</span>;
  return <span className="pr-badge-empty">—</span>;
}

export function AuthoredPrsTable({ items }: AuthoredPrsTableProps) {
  return (
    <section className="panel table-panel detail-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">Authored PRs</p>
          <h2>Pull request activity</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PR</th>
              <th>State</th>
              <th>Assignees</th>
              <th>Requested</th>
              <th>Reviewers</th>
              <th>CI</th>
              <th>Contributor</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Repo</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={10} className="empty-state-cell">
                  No authored PRs matched the current selection.
                </td>
              </tr>
            ) : (
              items.slice(0, 40).map((item) => (
                <tr key={item.id} data-pr-highlight={getPrHighlight(item)}>
                  <td>
                    <a href={item.url} target="_blank" rel="noreferrer" className="table-link">
                      {item.title}
                    </a>
                  </td>
                  <td>{item.statusLabel}</td>
                  <td>{item.prStatus ? <AssigneesCell prStatus={item.prStatus} /> : <span className="pr-badge-empty">—</span>}</td>
                  <td>{item.prStatus ? <RequestedCell prStatus={item.prStatus} /> : <span className="pr-badge-empty">—</span>}</td>
                  <td>{item.prStatus ? <ReviewersCell prStatus={item.prStatus} /> : <span className="pr-badge-empty">—</span>}</td>
                  <td>{item.prStatus ? <CiCell ciStatus={item.prStatus.ciStatus} /> : <span className="pr-badge-empty">—</span>}</td>
                  <td>@{item.contributor}</td>
                  <td>{daysAgo(item.createdAt)}</td>
                  <td>{daysAgo(item.updatedAt)}</td>
                  <td>{repoShortName(item.repo)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
