"use client";

import { formatISO9075 } from "date-fns";

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

function ReviewsCell({ prStatus }: { prStatus: PrStatusSummary }) {
  const { requestedVerdicts, otherVerdicts, pendingRequestedCount, ciStatus, cooldownMet } = prStatus;

  const allVerdicts = [...requestedVerdicts, ...otherVerdicts];
  const approvedCount = allVerdicts.filter((v) => v.state === "APPROVED").length;
  const changesCount = allVerdicts.filter((v) => v.state === "CHANGES_REQUESTED").length;
  const commentedCount = allVerdicts.filter((v) => v.state === "COMMENTED").length;

  const parts: React.ReactNode[] = [];

  if (pendingRequestedCount > 0) {
    parts.push(
      <span key="pending" className="pr-badge pr-badge-pending" title={`${pendingRequestedCount} requested reviewer(s) pending`}>
        ⏳{pendingRequestedCount}
      </span>,
    );
  }
  if (approvedCount > 0) {
    parts.push(
      <span key="approved" className="pr-badge pr-badge-approved" title={`${approvedCount} approval(s)`}>
        ✓{approvedCount}
      </span>,
    );
  }
  if (changesCount > 0) {
    parts.push(
      <span key="changes" className="pr-badge pr-badge-changes" title={`${changesCount} changes requested`}>
        ✗{changesCount}
      </span>,
    );
  }
  if (commentedCount > 0) {
    parts.push(
      <span key="commented" className="pr-badge pr-badge-commented" title={`${commentedCount} comment review(s)`}>
        ○{commentedCount}
      </span>,
    );
  }

  if (ciStatus === "success") {
    parts.push(<span key="ci" className="pr-badge pr-badge-ci-success" title="CI passing">CI✓</span>);
  } else if (ciStatus === "failure") {
    parts.push(<span key="ci" className="pr-badge pr-badge-ci-failure" title="CI failing">CI✗</span>);
  } else if (ciStatus === "pending") {
    parts.push(<span key="ci" className="pr-badge pr-badge-ci-pending" title="CI running">CI…</span>);
  }

  if (cooldownMet) {
    parts.push(<span key="cool" className="pr-badge pr-badge-cooldown" title="No activity for 72h+">72h+</span>);
  }

  if (parts.length === 0) return <span className="pr-badge-empty">—</span>;
  return <span className="pr-badges">{parts}</span>;
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
              <th>Reviews</th>
              <th>Updated</th>
              <th>Repository</th>
              <th>Contributor</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-state-cell">
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
                  <td>{item.prStatus ? <ReviewsCell prStatus={item.prStatus} /> : <span className="pr-badge-empty">—</span>}</td>
                  <td>{formatISO9075(new Date(item.updatedAt))}</td>
                  <td>{item.repo}</td>
                  <td>@{item.contributor}</td>
                  <td>{formatISO9075(new Date(item.createdAt))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
