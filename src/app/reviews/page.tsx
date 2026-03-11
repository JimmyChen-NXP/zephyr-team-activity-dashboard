import { Suspense } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { SnapshotDashboardPage } from "@/components/snapshot-dashboard-page";
import { getDashboardData } from "@/lib/dashboard";
import { parseDashboardFilters, type DashboardSearchParams } from "@/lib/dashboard-filters";

type PageProps = {
  searchParams?: Promise<DashboardSearchParams>;
};

const isGitHubPagesBuild = process.env.DEPLOY_TARGET === "github-pages";

function SnapshotReviewsPage() {
  return (
    <Suspense fallback={null}>
      <SnapshotDashboardPage view="reviews" pathname="/reviews" />
    </Suspense>
  );
}

async function LiveReviewsPage({ searchParams }: PageProps) {
  const filters = parseDashboardFilters((await searchParams) ?? {});
  const data = await getDashboardData(filters);
  return <DashboardShell data={data} filters={filters} view="reviews" pathname="/reviews" />;
}

const ReviewsPage = isGitHubPagesBuild ? SnapshotReviewsPage : LiveReviewsPage;

export default ReviewsPage;
