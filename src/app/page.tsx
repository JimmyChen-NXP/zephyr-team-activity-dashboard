import { Suspense } from "react";
import { redirect } from "next/navigation";

import { SnapshotDashboardPage } from "@/components/snapshot-dashboard-page";
import { parseDashboardFilters, type DashboardSearchParams } from "@/lib/dashboard-filters";
import { buildDashboardHref } from "@/lib/dashboard-links";

type PageProps = {
  searchParams?: Promise<DashboardSearchParams>;
};

const isGitHubPagesBuild = process.env.DEPLOY_TARGET === "github-pages";

function SnapshotRootPage() {
  return (
    <Suspense fallback={null}>
      <SnapshotDashboardPage view="issues" pathname="/issues" />
    </Suspense>
  );
}

async function LiveRootPage({ searchParams }: PageProps) {
  const filters = parseDashboardFilters((await searchParams) ?? {});
  redirect(buildDashboardHref("/issues", { ...filters, refresh: false }) as never);
}

const Page = isGitHubPagesBuild ? SnapshotRootPage : LiveRootPage;

export default Page;
