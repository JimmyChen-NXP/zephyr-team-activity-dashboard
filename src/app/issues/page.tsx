import { Suspense } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { SnapshotDashboardPage } from "@/components/snapshot-dashboard-page";
import { getDashboardData } from "@/lib/dashboard";
import { parseDashboardFilters, type DashboardSearchParams } from "@/lib/dashboard-filters";

type PageProps = {
  searchParams?: Promise<DashboardSearchParams>;
};

const isGitHubPagesBuild = process.env.DEPLOY_TARGET === "github-pages";

function SnapshotIssuesPage() {
  return (
    <Suspense fallback={null}>
      <SnapshotDashboardPage view="issues" pathname="/issues" />
    </Suspense>
  );
}

async function LiveIssuesPage({ searchParams }: PageProps) {
  const filters = parseDashboardFilters((await searchParams) ?? {});
  const data = await getDashboardData(filters);
  return <DashboardShell data={data} filters={filters} view="issues" pathname="/issues" />;
}

const IssuesPage = isGitHubPagesBuild ? SnapshotIssuesPage : LiveIssuesPage;

export default IssuesPage;
