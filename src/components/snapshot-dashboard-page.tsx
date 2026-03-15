"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { filterDashboardData } from "@/lib/dashboard-filtering";
import { parseDashboardFilters } from "@/lib/dashboard-filters";
import { withBasePath } from "@/lib/base-path";
import type { DashboardView } from "@/lib/dashboard-views";
import type { DashboardData, DashboardFilters } from "@/lib/types";

// Module-level cache: snapshots are static and only change once per day.
// Keyed by preset so switching views (issues/PRs/reviews) on the same preset
// is instant — no re-fetch, no re-parse.
const snapshotCache = new Map<string, DashboardData>();

type SnapshotDashboardPageProps = {
  view: DashboardView;
  pathname: string;
};

function buildFiltersFromSearchParams(searchParams: URLSearchParams): DashboardFilters {
  return parseDashboardFilters({
    preset: searchParams.get("preset") ?? undefined,
    contributor: searchParams.getAll("contributor"),
    repo: searchParams.get("repo") ?? undefined,
    refresh: searchParams.get("refresh") ?? undefined,
  });
}

export function SnapshotDashboardPage({ view, pathname }: SnapshotDashboardPageProps) {
  const searchParams = useSearchParams();
  const filters = useMemo(() => buildFiltersFromSearchParams(searchParams), [searchParams]);
  const [baseData, setBaseData] = useState<DashboardData | null>(() => snapshotCache.get(filters.preset) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Already in memory — no network needed.
    if (snapshotCache.has(filters.preset)) {
      setError(null);
      setBaseData(snapshotCache.get(filters.preset)!);
      return;
    }

    let cancelled = false;

    async function load() {
      setError(null);
      setBaseData(null);

      try {
        // No cache:"no-store" — let the browser cache the response.
        // GitHub Pages serves static files with ETags so subsequent loads
        // use a conditional request (304 Not Modified) instead of re-downloading.
        const response = await fetch(withBasePath(`/snapshots/${filters.preset}.json`));
        if (!response.ok) {
          throw new Error(`Snapshot fetch failed (${response.status})`);
        }

        const payload = (await response.json()) as DashboardData;
        snapshotCache.set(filters.preset, payload);
        if (!cancelled) {
          setBaseData(payload);
        }
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Snapshot fetch failed";
        if (!cancelled) {
          setError(message);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [filters.preset]);

  const filtered = useMemo(() => {
    if (!baseData) {
      return null;
    }

    return filterDashboardData(baseData, filters);
  }, [baseData, filters]);

  if (error) {
    return (
      <div className="dashboard-shell">
        <div className="title-bar">
          <span className="title-bar-name">Zephyr team activity</span>
        </div>
        <section className="panel">
          <p className="eyebrow">Static snapshot</p>
          <p className="token-copy">Could not load snapshot data: {error}</p>
        </section>
      </div>
    );
  }

  if (!filtered) {
    return (
      <div className="dashboard-shell">
        <div className="title-bar">
          <span className="title-bar-name">Zephyr team activity</span>
        </div>
        <section className="panel">
          <p className="eyebrow">Static snapshot</p>
          <p className="token-copy">Loading snapshot…</p>
        </section>
      </div>
    );
  }

  return (
    <DashboardShell
      data={filtered}
      filters={filters}
      view={view}
      pathname={pathname}
      isHostedSnapshot
    />
  );
}
