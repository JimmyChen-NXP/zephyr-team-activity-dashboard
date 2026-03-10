import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardData } from "@/lib/dashboard";
import { DEFAULT_PRESET } from "@/lib/range";
import type { DashboardFilters, DashboardPreset } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePreset(value: string | undefined): DashboardPreset {
  if (value === "7d" || value === "30d" || value === "90d") {
    return value;
  }

  return DEFAULT_PRESET;
}

export default async function Page({ searchParams }: PageProps) {
  const params = ((await searchParams) ?? {}) as SearchParams;
  const filters: DashboardFilters = {
    preset: parsePreset(firstValue(params.preset)),
    contributor: firstValue(params.contributor) ?? "all",
    repo: firstValue(params.repo) ?? "all",
    refresh: firstValue(params.refresh) === "1",
  };

  const data = await getDashboardData(filters);

  return <DashboardShell data={data} filters={filters} />;
}
