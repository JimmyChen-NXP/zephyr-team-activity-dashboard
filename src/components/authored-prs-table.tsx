"use client";

import { useState } from "react";
import clsx from "clsx";
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
  const { assignees = [], requestedVerdicts, pendingRequestedLogins = [] } = prStatus;
  if (assignees.length === 0) return <span className="pr-badge-empty">—</span>;

  const verdictMap = new Map(requestedVerdicts.map((v) => [v.login.toLowerCase(), v.state]));
  const pendingSet = new Set(pendingRequestedLogins.map((l) => l.toLowerCase()));

  return (
    <span className="pr-badges">
      {assignees.map((login) => {
        const key = login.toLowerCase();
        const state = verdictMap.get(key);
        const isPending = !state && pendingSet.has(key);
        const badgeClass = state ? (VERDICT_CLASS[state] ?? "pr-badge") : "pr-badge pr-badge-pending";
        const icon = state ? VERDICT_ICON[state] : isPending ? "⏳" : "·";
        return (
          <span key={login} className={badgeClass} title={state ?? (isPending ? "Pending" : "Assigned")}>
            {icon} {login}
          </span>
        );
      })}
    </span>
  );
}

function ReviewersCell({ prStatus }: { prStatus: PrStatusSummary }) {
  const { assignees = [], requestedVerdicts, otherVerdicts, pendingRequestedLogins = [] } = prStatus;
  const assigneeSet = new Set(assignees.map((l) => l.toLowerCase()));

  const pendingCount = pendingRequestedLogins.filter((l) => !assigneeSet.has(l.toLowerCase())).length;
  const allVerdicts = [...requestedVerdicts, ...otherVerdicts].filter(
    (v) => !assigneeSet.has(v.login.toLowerCase()),
  );
  // deduplicate by login
  const verdictMap = new Map(allVerdicts.map((v) => [v.login.toLowerCase(), v]));

  // Named badges only for APPROVED / CHANGES_REQUESTED; pending and commented are always counts
  const namedVerdicts = [...verdictMap.values()].filter(
    (v) => v.state === "APPROVED" || v.state === "CHANGES_REQUESTED",
  );
  const commentedCount = [...verdictMap.values()].filter((v) => v.state === "COMMENTED").length;

  if (namedVerdicts.length === 0 && pendingCount === 0 && commentedCount === 0) {
    return <span className="pr-badge-empty">—</span>;
  }

  const nodes: React.ReactNode[] = [];
  for (const v of namedVerdicts) {
    nodes.push(
      <span key={`v-${v.login}`} className={VERDICT_CLASS[v.state] ?? "pr-badge"} title={v.state.replace(/_/g, " ")}>
        {VERDICT_ICON[v.state]} {v.login}
      </span>,
    );
  }
  if (pendingCount > 0) {
    nodes.push(
      <span key="p" className="pr-badge pr-badge-pending" title={`${pendingCount} pending`}>
        ⏳{pendingCount}
      </span>,
    );
  }
  if (commentedCount > 0) {
    nodes.push(
      <span key="o" className="pr-badge pr-badge-commented" title={`${commentedCount} comment review(s)`}>
        ○{commentedCount}
      </span>,
    );
  }
  return <span className="pr-badges">{nodes}</span>;
}

function CiCell({ ciStatus }: { ciStatus: PrStatusSummary["ciStatus"] }) {
  if (ciStatus === "success") return <span className="pr-badge pr-badge-ci-success" title="CI passing">✓</span>;
  if (ciStatus === "failure") return <span className="pr-badge pr-badge-ci-failure" title="CI failing">✗</span>;
  if (ciStatus === "pending") return <span className="pr-badge pr-badge-ci-pending" title="CI running">…</span>;
  return <span className="pr-badge-empty">—</span>;
}

const PR_STATE_CHIPS = ["Open PR", "Draft PR", "Merged", "Closed"] as const;

export function AuthoredPrsTable({ items }: AuthoredPrsTableProps) {
  const [activeStates, setActiveStates] = useState<Set<string>>(new Set());

  const countByState = Object.fromEntries(PR_STATE_CHIPS.map((label) => [label, items.filter((i) => i.statusLabel === label).length]));
  const filtered = activeStates.size === 0 ? items : items.filter((item) => activeStates.has(item.statusLabel));

  function toggleState(label: string) {
    if (countByState[label] === 0) return;
    setActiveStates((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  return (
    <section className="panel table-panel detail-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">Authored PRs</p>
          <h2>Pull request activity</h2>
        </div>
      </div>
      {items.length > 0 && (
        <div className="table-filter-bar">
          {PR_STATE_CHIPS.map((label) => {
            const count = countByState[label];
            return (
              <button
                key={label}
                type="button"
                className={clsx("table-filter-chip", activeStates.has(label) && "is-active", count === 0 && "is-empty")}
                onClick={() => toggleState(label)}
                disabled={count === 0}
              >
                {label}
                {count > 0 && <span className="table-filter-chip-count">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PR</th>
              <th>State</th>
              <th>Assignees</th>
              <th>Reviewers</th>
              <th>CI</th>
              <th>Contributor</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Repo</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-state-cell">
                  No authored PRs matched the current selection.
                </td>
              </tr>
            ) : (
              filtered.slice(0, 40).map((item) => (
                <tr key={item.id} data-pr-highlight={getPrHighlight(item)}>
                  <td>
                    <a href={item.url} target="_blank" rel="noreferrer" className="table-link">
                      {item.title}
                    </a>
                  </td>
                  <td>{item.statusLabel}</td>
                  <td>{item.prStatus ? <AssigneesCell prStatus={item.prStatus} /> : <span className="pr-badge-empty">—</span>}</td>
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
