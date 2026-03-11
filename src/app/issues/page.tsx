import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardData } from "@/lib/dashboard";
import { parseDashboardFilters, type DashboardSearchParams } from "@/lib/dashboard-filters";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<DashboardSearchParams>;
};

export default async function IssuesPage({ searchParams }: PageProps) {
  const filters = parseDashboardFilters((await searchParams) ?? {});
  const data = await getDashboardData(filters);

  return <DashboardShell data={data} filters={filters} view="issues" pathname="/issues" />;
}
