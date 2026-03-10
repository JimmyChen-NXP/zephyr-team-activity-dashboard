import { NextResponse } from "next/server";

import { getDashboardData } from "@/lib/dashboard";
import { DEFAULT_PRESET } from "@/lib/range";
import type { DashboardFilters, DashboardPreset } from "@/lib/types";

function parsePreset(value: string | null): DashboardPreset {
  return value === "7d" || value === "90d" || value === "30d" ? value : DEFAULT_PRESET;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filters: DashboardFilters = {
    preset: parsePreset(searchParams.get("preset")),
    contributor: searchParams.get("contributor") ?? "all",
    repo: searchParams.get("repo") ?? "all",
    refresh: false,
  };

  const data = await getDashboardData(filters);
  const header = ["Type", "Title", "Contributor", "Repository", "State", "Created At", "Updated At", "URL"];
  const rows = data.activityItems.map((item) => [item.type, item.title, item.contributor, item.repo, item.state, item.createdAt, item.updatedAt, item.url]);

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll("\"", '""')}"`).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zephyr-team-activity-${filters.preset}.csv"`,
    },
  });
}
