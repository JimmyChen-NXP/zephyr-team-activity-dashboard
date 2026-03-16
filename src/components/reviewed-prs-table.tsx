"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { formatISO9075 } from "date-fns";

import type { ActivityItem } from "@/lib/types";

// ── Formatters ────────────────────────────────────────────────────────────────

function formatReviewKind(value?: string) {
  if (value === "authored-by-self") return "Authored by self";
  if (value === "authored-by-them") return "Authored by teammate";
  if (value === "authored-external") return "Authored externally";
  return "—";
}

// item.state is stored lowercase: "approved" | "changes_requested" | "commented"
function formatOutcome(value: string) {
  if (value === "approved") return "Approved";
  if (value === "changes_requested") return "Changes Requested";
  if (value === "commented") return "Commented";
  return value.replaceAll("_", " ");
}

// ── Outcome chip bar ──────────────────────────────────────────────────────────

const OUTCOME_OPTIONS = [
  { value: "approved", label: "Approved" },
  { value: "changes_requested", label: "Changes Requested" },
  { value: "commented", label: "Commented" },
] as const;

type OutcomeChipBarProps = {
  items: ActivityItem[];
  selected: Set<string>;
  onToggle: (value: string) => void;
};

function OutcomeChipBar({ items, selected, onToggle }: OutcomeChipBarProps) {
  const countByOutcome = Object.fromEntries(
    OUTCOME_OPTIONS.map(({ value }) => [value, items.filter((i) => i.state === value).length]),
  );
  return (
    <div className="table-filter-bar">
      {OUTCOME_OPTIONS.map(({ value, label }) => {
        const count = countByOutcome[value];
        return (
          <button
            key={value}
            type="button"
            className={clsx("table-filter-chip", selected.has(value) && "is-active", count === 0 && "is-empty")}
            onClick={() => onToggle(value)}
            disabled={count === 0}
          >
            {label}
            {count > 0 && <span className="table-filter-chip-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Reviewed PRs table ────────────────────────────────────────────────────────

type ReviewedPrsTableProps = {
  items: ActivityItem[];
};

export function ReviewedPrsTable({ items }: ReviewedPrsTableProps) {
  const [outcomeFilter, setOutcomeFilter] = useState<Set<string>>(new Set(["commented"]));

  function toggleOutcome(value: string) {
    setOutcomeFilter((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  const filtered = useMemo(() => {
    if (outcomeFilter.size === 0) return items;
    return items.filter((i) => outcomeFilter.has(i.state));
  }, [items, outcomeFilter]);

  return (
    <section className="panel table-panel detail-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">Reviewed PRs · {filtered.length} of {items.length}</p>
          <h2>Review activity</h2>
        </div>
      </div>
      {items.length > 0 && (
        <OutcomeChipBar items={items} selected={outcomeFilter} onToggle={toggleOutcome} />
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reviewed PR</th>
              <th>Outcome</th>
              <th>Author type</th>
              <th>Updated</th>
              <th>Repository</th>
              <th>Reviewer</th>
              <th>Author</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-state-cell">
                  No reviewed PRs matched the current selection.
                </td>
              </tr>
            ) : (
              filtered.slice(0, 40).map((item) => (
                <tr key={item.id}>
                  <td>
                    <a href={item.url} target="_blank" rel="noreferrer" className="table-link">
                      {item.title}
                    </a>
                  </td>
                  <td>{formatOutcome(item.state)}</td>
                  <td>{formatReviewKind(item.reviewedPrKind)}</td>
                  <td>{formatISO9075(new Date(item.updatedAt))}</td>
                  <td>{item.repo}</td>
                  <td>@{item.contributor}</td>
                  <td>@{item.author}</td>
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
