"use client";

import { useEffect, useMemo, useState } from "react";

import { ActivityPageNav } from "@/components/activity-page-nav";
import { withBasePath } from "@/lib/base-path";
import type { MaintainersData, PersonEntry, SubsystemEntry } from "@/lib/maintainers-types";

// ── Person cell ───────────────────────────────────────────────────────────────

function PersonList({ people }: { people: PersonEntry[] }) {
  if (people.length === 0) return <span className="muted">—</span>;
  return (
    <span className="maintainers-person-list">
      {people.map((p, i) => (
        <span key={p.login}>
          <a
            className="table-link"
            href={`https://github.com/${p.login}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {p.name}
          </a>
          {i < people.length - 1 && ", "}
        </span>
      ))}
    </span>
  );
}

// ── Type badge ────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: SubsystemEntry["type"] }) {
  return (
    <span className={`maintainers-type-badge maintainers-type-badge--${type}`}>
      {type === "component" ? "Component" : "File group"}
    </span>
  );
}

// ── Multi-select dropdown ─────────────────────────────────────────────────────

type ComponentFilterProps = {
  allNames: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
};

function ComponentFilter({ allNames, selected, onChange }: ComponentFilterProps) {
  const label = selected.size === 0 ? "All components" : `${selected.size} selected`;

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    onChange(next);
  }

  return (
    <div className="filter-field">
      <span id="component-filter-label">Component</span>
      <details className="filter-dropdown" aria-labelledby="component-filter-label">
        <summary>{label}</summary>
        <div className="filter-dropdown-panel">
          <button
            type="button"
            className="filter-dropdown-clear"
            onClick={() => onChange(new Set())}
          >
            All components
          </button>
          <div className="filter-dropdown-options">
            {allNames.map((name) => (
              <div key={name} className="filter-dropdown-option">
                <input
                  id={`comp-${name}`}
                  type="checkbox"
                  checked={selected.has(name)}
                  onChange={() => toggle(name)}
                />
                <label htmlFor={`comp-${name}`}>{name}</label>
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function MaintainersPage() {
  const [data, setData] = useState<MaintainersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(new Set());
  const [hideUnassigned, setHideUnassigned] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(withBasePath("/maintainers-map.json"));
        if (!response.ok) {
          throw new Error(`Failed to load maintainers data (${response.status})`);
        }
        const payload = (await response.json()) as MaintainersData;
        if (!cancelled) setData(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load maintainers data";
        if (!cancelled) setError(message);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const allNames = useMemo(
    () => data?.subsystems.map((s) => s.name) ?? [],
    [data]
  );

  const visibleSubsystems = useMemo(() => {
    if (!data) return [];
    let list = data.subsystems;
    if (selectedComponents.size > 0) list = list.filter((s) => selectedComponents.has(s.name));
    if (hideUnassigned) list = list.filter((s) => s.maintainers.length > 0 || s.collaborators.length > 0);
    return list;
  }, [data, selectedComponents, hideUnassigned]);

  const titleBar = (
    <div className="title-bar">
      <span className="title-bar-name">Zephyr team activity</span>
      {data && (
        <span className="title-bar-timestamp">
          Generated {new Date(data.generatedAt).toLocaleString()}
        </span>
      )}
      <ActivityPageNav currentView="maintainers" />
    </div>
  );

  if (error) {
    return (
      <div className="dashboard-shell">
        {titleBar}
        <section className="panel">
          <p className="eyebrow">Roster</p>
          <p className="token-copy">Could not load maintainers data: {error}</p>
        </section>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dashboard-shell">
        {titleBar}
        <section className="panel">
          <p className="eyebrow">Roster</p>
          <p className="token-copy">Loading…</p>
        </section>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      {titleBar}

      <section className="panel filter-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Controls</p>
            <h2>Filter components</h2>
          </div>
        </div>
        <div className="filter-form">
          <ComponentFilter
            allNames={allNames}
            selected={selectedComponents}
            onChange={setSelectedComponents}
          />
          <label className="filter-checkbox-label">
            <input
              type="checkbox"
              checked={hideUnassigned}
              onChange={(e) => setHideUnassigned(e.target.checked)}
            />
            <span>Hide unassigned components</span>
          </label>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">
              {visibleSubsystems.length} of {data.subsystems.length} components
            </p>
            <h2>Component ownership</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Maintainers</th>
                <th>Collaborators</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {visibleSubsystems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state-cell">
                    No components match the current filter.
                  </td>
                </tr>
              ) : (
                visibleSubsystems.map((s) => (
                  <tr key={s.name}>
                    <td><strong>{s.name}</strong></td>
                    <td><PersonList people={s.maintainers} /></td>
                    <td><PersonList people={s.collaborators} /></td>
                    <td><TypeBadge type={s.type} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
