import { redirect } from "next/navigation";

import { parseDashboardFilters, type DashboardSearchParams } from "@/lib/dashboard-filters";
import { buildDashboardHref } from "@/lib/dashboard-links";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<DashboardSearchParams>;
};

export default async function Page({ searchParams }: PageProps) {
  const filters = parseDashboardFilters((await searchParams) ?? {});
  redirect(buildDashboardHref("/issues", { ...filters, refresh: false }) as never);
}
