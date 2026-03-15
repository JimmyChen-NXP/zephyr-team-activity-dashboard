"use client";

import { useEffect, useState } from "react";

import { ActivityPageNav } from "@/components/activity-page-nav";
import { withBasePath } from "@/lib/base-path";
import type { MaintainerEntry, MaintainersData } from "@/lib/maintainers-types";

function MaintainersTable({ entries, emptyMessage }: { entries: MaintainerEntry[]; emptyMessage: string }) {
  if (entries.length === 0) {
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>GitHub</th>
              <th>Subsystems</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={3} className="empty-state-cell">{emptyMessage}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>GitHub</th>
            <th>Subsystems</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.login}>
              <td><strong>{entry.name}</strong></td>
              <td>
                <a
                  className="table-link"
                  href={`https://github.com/${entry.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {entry.login}
                </a>
              </td>
              <td className="maintainers-subsystems-cell">
                {entry.subsystems.join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MaintainersPage() {
  const [data, setData] = useState<MaintainersData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(withBasePath("/maintainers-map.json"));
        if (!response.ok) {
          throw new Error(`Failed to load maintainers data (${response.status})`);
        }
        const payload = (await response.json()) as MaintainersData;
        if (!cancelled) {
          setData(payload);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load maintainers data";
        if (!cancelled) {
          setError(message);
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

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

      <section className="panel table-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Maintainers · {data.maintainers.length} people</p>
            <h2>Subsystem maintainers</h2>
          </div>
        </div>
        <MaintainersTable
          entries={data.maintainers}
          emptyMessage="No roster members found in the maintainers list."
        />
      </section>

      <section className="panel table-panel">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Collaborators · {data.collaborators.length} people</p>
            <h2>Subsystem collaborators</h2>
          </div>
        </div>
        <MaintainersTable
          entries={data.collaborators}
          emptyMessage="No roster members found in the collaborators list."
        />
      </section>
    </div>
  );
}
