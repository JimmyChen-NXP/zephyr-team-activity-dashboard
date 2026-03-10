import { NextResponse } from "next/server";

import { getDashboardData } from "@/lib/dashboard";
import { buildViewDashboardData } from "@/lib/dashboard-aggregates";
import { parseDashboardFilters } from "@/lib/dashboard-filters";
import { isDashboardView } from "@/lib/dashboard-views";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filters = parseDashboardFilters({
    preset: searchParams.get("preset") ?? undefined,
    contributor: searchParams.get("contributor") ?? undefined,
    repo: searchParams.get("repo") ?? undefined,
  });
  const viewParam = searchParams.get("view") ?? "issues";
  const view = isDashboardView(viewParam) ? viewParam : "issues";

  const data = buildViewDashboardData(await getDashboardData(filters), view);
  const header = ["Type", "Title", "Contributor", "Repository", "State", "Created At", "Updated At", "URL"];
  const rows = data.activityItems.map((item) => [item.type, item.title, item.contributor, item.repo, item.state, item.createdAt, item.updatedAt, item.url]);

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll("\"", '""')}"`).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zephyr-team-activity-${view}-${filters.preset}.csv"`,
    },
  });
}
