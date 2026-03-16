"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ActivityPageNav } from "@/components/activity-page-nav";
import { withBasePath } from "@/lib/base-path";
import type { MaintainersData, PersonEntry, SubsystemEntry } from "@/lib/maintainers-types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function isNxpSubsystem(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("nxp") || lower.includes("hal_nxp");
}

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

type ContributorChartProps = {
  data: ContributorChartEntry[];
  personFilter: string;
  onPersonClick: (name: string) => void;
};

function ContributorChart({ data, personFilter, onPersonClick }: ContributorChartProps) {
  if (data.length === 0) return null;
  const chartHeight = Math.max(240, data.length * 34);

  function isActive(name: string) {
    return !personFilter || name.toLowerCase().includes(personFilter.toLowerCase());
  }

  function handleClick(payload: unknown) {
    const d = payload as { activePayload?: Array<{ payload: ContributorChartEntry }> } | null;
    const name = d?.activePayload?.[0]?.payload?.name;
    if (name) onPersonClick(name);
  }

  return (
    <section className="panel chart-panel maintainers-chart-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Contributor engagement · {data.length} people</p>
          <h3>Subsystem ownership per roster member</h3>
          <p className="maintainers-chart-note">
            NXP components excluded · Click a name to filter the table
          </p>
        </div>
      </div>
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
            barSize={12}
            onClick={handleClick}
            style={{ cursor: "pointer" }}
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
            <Bar dataKey="maintainer" name="Maintainer" stackId="a" fill="#7c3aed" radius={[0, 0, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.name} fill="#7c3aed" opacity={isActive(entry.name) ? 1 : 0.2} />
              ))}
            </Bar>
            <Bar dataKey="collaborator" name="Collaborator" stackId="a" fill="#38bdf8" radius={[0, 6, 6, 0]}>
              {data.map((entry) => (
                <Cell key={entry.name} fill="#38bdf8" opacity={isActive(entry.name) ? 1 : 0.2} />
              ))}
            </Bar>
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
  const [personFilter, setPersonFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "component" | "file-group">("all");
  const [hideUnassigned, setHideUnassigned] = useState(true);
  const [dateFrom, setDateFrom] = useState("");

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

  function handlePersonClick(name: string) {
    // Toggle: clicking the same name again clears the filter
    setPersonFilter((prev) => (prev === name ? "" : name));
  }

  const visibleSubsystems = useMemo(() => {
    if (!data) return [];
    let list = data.subsystems;
    if (nameFilter.trim()) {
      const lower = nameFilter.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(lower));
    }
    if (personFilter.trim()) {
      const lower = personFilter.toLowerCase();
      list = list.filter((s) =>
        s.maintainers.some((p) => p.name.toLowerCase().includes(lower)) ||
        s.collaborators.some((p) => p.name.toLowerCase().includes(lower))
      );
    }
    if (typeFilter !== "all") list = list.filter((s) => s.type === typeFilter);
    if (hideUnassigned) list = list.filter((s) => s.maintainers.length > 0 || s.collaborators.length > 0);
    if (dateFrom) list = list.filter((s) => (s.detectedAt ?? "") >= dateFrom);
    return list;
  }, [data, nameFilter, personFilter, typeFilter, hideUnassigned, dateFrom]);

  // Per-contributor counts — NXP/hal_nxp subsystems excluded from chart statistics
  const chartData = useMemo((): ContributorChartEntry[] => {
    if (!data) return [];
    const map = new Map<string, ContributorChartEntry>();
    for (const s of data.subsystems) {
      if (isNxpSubsystem(s.name)) continue;
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
            <span>Person name</span>
            <input
              type="text"
              className="filter-text-input"
              placeholder="Search or click chart…"
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
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
          <label>
            <span>Detected from</span>
            <input
              type="date"
              className="filter-text-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <div className="filter-actions">
            <label className="filter-checkbox-label">
              <input
                type="checkbox"
                checked={hideUnassigned}
                onChange={(e) => setHideUnassigned(e.target.checked)}
              />
              <span>Hide no maintainer/collaborator</span>
            </label>
          </div>
        </div>
      </section>

      <div className="maintainers-main-layout">
        <ContributorChart
          data={chartData}
          personFilter={personFilter}
          onPersonClick={handlePersonClick}
        />

        <section className="panel table-panel maintainers-table-panel">
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
                  <th>Detected</th>
                </tr>
              </thead>
              <tbody>
                {visibleSubsystems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-state-cell">
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
                      <td className="maintainers-detected-date">{s.detectedAt ?? "—"}</td>
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
