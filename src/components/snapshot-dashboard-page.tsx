"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { filterDashboardData } from "@/lib/dashboard-filtering";
import { parseDashboardFilters } from "@/lib/dashboard-filters";
import { withBasePath } from "@/lib/base-path";
import type { DashboardView } from "@/lib/dashboard-views";
import type { DashboardData, DashboardFilters } from "@/lib/types";

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
  const [baseData, setBaseData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateDataUrl = process.env.NEXT_PUBLIC_UPDATE_WORKFLOW_URL ?? "";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      setBaseData(null);

      try {
        const response = await fetch(withBasePath(`/snapshots/${filters.preset}.json`), { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Snapshot fetch failed (${response.status})`);
        }

        const payload = (await response.json()) as DashboardData;
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
        <section className="hero panel">
          <div>
            <p className="eyebrow">Static snapshot</p>
            <h1>Zephyr team activity dashboard</h1>
            <p className="hero-copy">Could not load snapshot data: {error}</p>
          </div>
        </section>
      </div>
    );
  }

  if (!filtered) {
    return (
      <div className="dashboard-shell">
        <section className="hero panel">
          <div>
            <p className="eyebrow">Static snapshot</p>
            <h1>Zephyr team activity dashboard</h1>
            <p className="hero-copy">Loading snapshot…</p>
          </div>
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
      updateDataUrl={updateDataUrl}
    />
  );
}
