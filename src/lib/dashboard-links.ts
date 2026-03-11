import type { DashboardFilters } from "@/lib/types";
import type { DashboardView } from "@/lib/dashboard-views";

const SAFE_RETURN_PATHS = new Set(["/issues", "/pull-requests", "/reviews"]);

type BuildHrefOptions = {
  includeRefresh?: boolean;
  extraParams?: Record<string, string | undefined>;
};

export function buildDashboardSearchParams(filters: DashboardFilters, options: BuildHrefOptions = {}) {
  const params = new URLSearchParams({
    preset: filters.preset,
    repo: filters.repo,
  });

  for (const contributor of filters.contributors) {
    params.append("contributor", contributor);
  }

  if (options.includeRefresh && filters.refresh) {
    params.set("refresh", "1");
  }

  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    if (value) {
      params.set(key, value);
    }
  }

  return params;
}

export function buildDashboardHref(pathname: string, filters: DashboardFilters, options: BuildHrefOptions = {}) {
  const params = buildDashboardSearchParams(filters, options);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function buildExportHref(view: DashboardView, filters: DashboardFilters) {
  return buildDashboardHref("/api/export", filters, {
    extraParams: {
      view,
    },
  });
}

export function sanitizeDashboardReturnTo(returnTo: string | null | undefined) {
  if (!returnTo) {
    return "/issues";
  }

  try {
    const url = new URL(returnTo, "http://localhost");
    if (!SAFE_RETURN_PATHS.has(url.pathname)) {
      return "/issues";
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return "/issues";
  }
}
