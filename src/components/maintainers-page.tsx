"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

// ── Contributor bar chart ─────────────────────────────────────────────────────

type ContributorChartEntry = { name: string; maintainer: number; collaborator: number };

function ContributorChart({ data }: { data: ContributorChartEntry[] }) {
  if (data.length === 0) return null;
  // Height scales with number of contributors so bars stay readable
  const chartHeight = Math.max(240, data.length * 34);
  return (
    <section className="panel chart-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Contributor engagement · {data.length} people</p>
          <h3>Subsystem ownership per roster member</h3>
        </div>
      </div>
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
            barSize={12}
          >
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#7f8aa3", fontSize: 12 }}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={140}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#b8c2d9", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(124, 58, 237, 0.08)" }}
              contentStyle={{ background: "#111827", border: "1px solid rgba(148, 163, 184, 0.15)", borderRadius: 16 }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "#b8c2d9" }} />
            <Bar dataKey="maintainer" name="Maintainer" stackId="a" fill="#7c3aed" radius={[0, 0, 0, 0]} />
            <Bar dataKey="collaborator" name="Collaborator" stackId="a" fill="#38bdf8" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function MaintainersPage() {
  const [data, setData] = useState<MaintainersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "component" | "file-group">("all");
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

  const visibleSubsystems = useMemo(() => {
    if (!data) return [];
    let list = data.subsystems;
    if (nameFilter.trim()) {
      const lower = nameFilter.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(lower));
    }
    if (typeFilter !== "all") list = list.filter((s) => s.type === typeFilter);
    if (hideUnassigned) list = list.filter((s) => s.maintainers.length > 0 || s.collaborators.length > 0);
    return list;
  }, [data, nameFilter, typeFilter, hideUnassigned]);

  // Per-contributor subsystem counts (across ALL subsystems, not just filtered)
  const chartData = useMemo((): ContributorChartEntry[] => {
    if (!data) return [];
    const map = new Map<string, ContributorChartEntry>();
    for (const s of data.subsystems) {
      for (const p of s.maintainers) {
        const e = map.get(p.login) ?? { name: p.name, maintainer: 0, collaborator: 0 };
        e.maintainer++;
        map.set(p.login, e);
      }
      for (const p of s.collaborators) {
        const e = map.get(p.login) ?? { name: p.name, maintainer: 0, collaborator: 0 };
        e.collaborator++;
        map.set(p.login, e);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => (b.maintainer + b.collaborator) - (a.maintainer + a.collaborator));
  }, [data]);

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
          <label>
            <span>Component name</span>
            <input
              type="text"
              className="filter-text-input"
              placeholder="Search…"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
            />
          </label>
          <label>
            <span>Type</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
              <option value="all">All types</option>
              <option value="component">Component</option>
              <option value="file-group">File group</option>
            </select>
          </label>
          <div className="filter-actions">
            <label className="filter-checkbox-label">
              <input
                type="checkbox"
                checked={hideUnassigned}
                onChange={(e) => setHideUnassigned(e.target.checked)}
              />
              <span>Hide unassigned</span>
            </label>
          </div>
        </div>
      </section>

      <ContributorChart data={chartData} />

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
                    No components match the current filters.
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
