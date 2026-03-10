import { DEFAULT_PRESET } from "@/lib/range";
import type { DashboardFilters, DashboardPreset } from "@/lib/types";

export type DashboardSearchParams = Record<string, string | string[] | undefined>;

export function firstSearchParamValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseDashboardPreset(value: string | undefined): DashboardPreset {
  if (value === "7d" || value === "30d" || value === "90d") {
    return value;
  }

  return DEFAULT_PRESET;
}

export function parseDashboardFilters(searchParams?: DashboardSearchParams): DashboardFilters {
  const params = searchParams ?? {};

  return {
    preset: parseDashboardPreset(firstSearchParamValue(params.preset)),
    contributor: firstSearchParamValue(params.contributor) ?? "all",
    repo: firstSearchParamValue(params.repo) ?? "all",
    refresh: firstSearchParamValue(params.refresh) === "1",
  };
}
