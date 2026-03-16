"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { formatISO9075 } from "date-fns";

import type { ActivityItem } from "@/lib/types";

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

// ── Issues table ──────────────────────────────────────────────────────────────

type IssuesTableProps = {
  items: ActivityItem[];
};

export function IssuesTable({ items }: IssuesTableProps) {
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set(["Assigned"]));

  const stateOptions = useMemo(
    () => [...new Set(items.map((i) => i.statusLabel))].sort(),
    [items],
  );

  const filtered = useMemo(() => {
    if (stateFilter.size === 0) return items;
    return items.filter((i) => stateFilter.has(i.statusLabel));
  }, [items, stateFilter]);

  return (
    <section className="panel table-panel detail-panel">
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">Assigned issues · {filtered.length} of {items.length}</p>
          <h2>Issue activity</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Issue</th>
              <ColumnFilterTh
                label="State"
                options={stateOptions}
                selected={stateFilter}
                onChange={setStateFilter}
              />
              <th>Updated</th>
              <th>Repository</th>
              <th>Contributor</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state-cell">
                  No issues matched the current selection.
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
                  <td>{item.statusLabel}</td>
                  <td>{formatISO9075(new Date(item.updatedAt))}</td>
                  <td>{item.repo}</td>
                  <td>@{item.contributor}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
