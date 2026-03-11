import { Suspense } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { SnapshotDashboardPage } from "@/components/snapshot-dashboard-page";
import { getDashboardData } from "@/lib/dashboard";
import { parseDashboardFilters, type DashboardSearchParams } from "@/lib/dashboard-filters";

type PageProps = {
  searchParams?: Promise<DashboardSearchParams>;
};

const isGitHubPagesBuild = process.env.DEPLOY_TARGET === "github-pages";

function SnapshotPullRequestsPage() {
  return (
    <Suspense fallback={null}>
      <SnapshotDashboardPage view="pull-requests" pathname="/pull-requests" />
    </Suspense>
  );
}

async function LivePullRequestsPage({ searchParams }: PageProps) {
  const filters = parseDashboardFilters((await searchParams) ?? {});
  const data = await getDashboardData(filters);
  return <DashboardShell data={data} filters={filters} view="pull-requests" pathname="/pull-requests" />;
}

const PullRequestsPage = isGitHubPagesBuild ? SnapshotPullRequestsPage : LivePullRequestsPage;

export default PullRequestsPage;
