"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { formatDistanceToNowStrict } from "date-fns";

import type { ActivityItem, PrStatusSummary } from "@/lib/types";

// ── Column-header filter cell ─────────────────────────────────────────────────

type ColumnFilterThProps = {
  label: string;
  options: string[];
  formatOption?: (v: string) => string;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
};

function ColumnFilterTh({ label, options, formatOption, selected, onChange }: ColumnFilterThProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  const fmt = formatOption ?? ((v: string) => v);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function toggle(val: string) {
    const next = new Set(selected);
    next.has(val) ? next.delete(val) : next.add(val);
    onChange(next);
  }

  return (
    <th ref={ref} className="col-filter-th">
      <button
        type="button"
        className={clsx("col-filter-btn", selected.size > 0 && "is-active")}
        onClick={() => setOpen((p) => !p)}
      >
        <span>{label}</span>
        {selected.size > 0 && <span className="col-filter-count">{selected.size}</span>}
        <span className="col-filter-caret">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="col-filter-dropdown">
          {options.map((opt) => (
            <label key={opt} className="col-filter-option">
              <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} />
              <span>{fmt(opt)}</span>
            </label>
          ))}
          {selected.size > 0 && (
            <button type="button" className="col-filter-clear" onClick={() => onChange(new Set())}>
              Clear filter
            </button>
          )}
        </div>
      )}
    </th>
  );
}

// ── PR status helpers ─────────────────────────────────────────────────────────

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
  const verdictMap = new Map(allVerdicts.map((v) => [v.login.toLowerCase(), v]));

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

const PR_STATE_OPTIONS = ["Open PR", "Draft PR", "Merged", "Closed"] as const;

// ── Authored PRs table ────────────────────────────────────────────────────────

type AuthoredPrsTableProps = {
  items: ActivityItem[];
};

function LabelsCell({ labels }: { labels?: string[] }) {
  if (!labels?.length) return <span className="muted">—</span>;
  return (
    <span className="label-chips">
      {labels.map((l) => <span key={l} className="label-chip">{l}</span>)}
    </span>
  );
}

export function AuthoredPrsTable({ items }: AuthoredPrsTableProps) {
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set(["Open PR"]));
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());

  const allLabels = useMemo(() => {
    const s = new Set<string>();
    for (const item of items) {
      for (const l of item.labels ?? []) s.add(l);
    }
    return [...s].sort();
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (stateFilter.size > 0 && !stateFilter.has(item.statusLabel)) return false;
      if (labelFilter.size > 0 && !( item.labels ?? []).some((l) => labelFilter.has(l))) return false;
      return true;
    });
  }, [items, stateFilter, labelFilter]);

  return (
    <section className="panel table-panel detail-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">Authored PRs · {filtered.length} of {items.length}</p>
          <h2>Pull request activity</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PR</th>
              <ColumnFilterTh
                label="State"
                options={[...PR_STATE_OPTIONS]}
                selected={stateFilter}
                onChange={setStateFilter}
              />
              <th>Assignees</th>
              <th>Reviewers</th>
              <ColumnFilterTh
                label="Labels"
                options={allLabels}
                selected={labelFilter}
                onChange={setLabelFilter}
              />
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
                <td colSpan={10} className="empty-state-cell">
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
                  <td><LabelsCell labels={item.labels} /></td>
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
