/**
 * Aggregation script: reads accumulated daily event files and produces
 * DashboardData snapshot JSON files for each preset (7d, 30d, 90d).
 *
 * Usage:
 *   npm run aggregate-daily
 *   DAILY_IN_DIR=_data/public SNAPSHOT_OUT_DIR=_data/public npm run aggregate-daily
 *
 * This is the read-only aggregation step — it does not call GitHub APIs.
 */

import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

import { resolveRange } from "@/lib/range";
import { loadRoster } from "@/lib/roster";
import type { DashboardData, DashboardPreset } from "@/lib/types";
import type { DailyFile, OpenItemsFile } from "@/lib/daily-types";
import { aggregateDailyRecords } from "@/lib/daily-aggregation";

const PRESETS: DashboardPreset[] = ["7d", "30d", "90d"];

function normalizeForStaticHosting(data: DashboardData): DashboardData {
  return {
    ...data,
    auth: {
      hasToken: false,
      connectionStatus: "configured",
      message: "Snapshot aggregated from daily files by GitHub Actions. No token is available in the browser.",
      checkedAt: data.generatedAt,
    },
    syncHealth: {
      ...data.syncHealth,
      source: "cache",
      liveEnabled: false,
    },
  };
}

async function loadDailyFile(filePath: string): Promise<DailyFile | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as DailyFile;
  } catch {
    return null;
  }
}

async function loadOpenItemsFile(filePath: string): Promise<OpenItemsFile | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as OpenItemsFile;
  } catch {
    return null;
  }
}

async function loadDailyFilesInWindow(dailyDir: string, fromDate: string, toDate: string): Promise<DailyFile[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dailyDir);
  } catch {
    // Daily dir may not exist yet (first run with no data)
    return [];
  }

  const dailyFiles: DailyFile[] = [];
  for (const entry of entries.sort()) {
    // Only consider files named YYYY-MM-DD.json
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(entry)) continue;
    const date = entry.slice(0, 10); // "YYYY-MM-DD"
    if (date < fromDate.slice(0, 10) || date > toDate.slice(0, 10)) continue;

    const filePath = path.join(dailyDir, entry);
    const daily = await loadDailyFile(filePath);
    if (daily) dailyFiles.push(daily);
  }

  return dailyFiles;
}

async function writeSnapshotFile(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  const dailyInBase = process.env.DAILY_IN_DIR ?? path.join(process.cwd(), "public");
  const dailyInDir = path.join(dailyInBase, "daily");
  const snapshotOutDir = path.join(process.env.SNAPSHOT_OUT_DIR ?? path.join(process.cwd(), "public"), "snapshots");

  const roster = await loadRoster();

  // Load a 90-day window of daily files (covers all presets)
  const ninetyDayRange = resolveRange("90d");
  const allDailyFiles = await loadDailyFilesInWindow(dailyInDir, ninetyDayRange.from, ninetyDayRange.to);

  if (allDailyFiles.length === 0) {
    console.warn("[aggregate-daily] No daily files found in window. Snapshots will be empty.");
  } else {
    console.log(`[aggregate-daily] Loaded ${allDailyFiles.length} daily file(s) (${allDailyFiles[0].date} .. ${allDailyFiles[allDailyFiles.length - 1].date})`);
  }

  // Merge open-items.json (current open state) into the record pool before aggregating.
  // deduplicateByUrl in aggregateDailyRecords keeps the record with the latest updatedAt,
  // so a fresher open-items.json always wins over stale open records in legacy daily files.
  const openItemsPath = path.join(dailyInBase, "open-items.json");
  const openItemsFile = await loadOpenItemsFile(openItemsPath);
  if (!openItemsFile) {
    console.warn("[aggregate-daily] open-items.json not found — open item counts sourced from legacy daily files (backward-compat mode).");
  } else {
    console.log(`[aggregate-daily] Loaded open-items.json (${openItemsFile.records.length} records, collected ${openItemsFile.collectedAt})`);
  }

  const allRecords = [...(openItemsFile?.records ?? []), ...allDailyFiles.flatMap((f) => f.records)];
  const generatedAt = new Date().toISOString();

  const meta: {
    generatedAt: string;
    presets: Array<{ preset: DashboardPreset; path: string; label: string }>;
  } = {
    generatedAt,
    presets: [],
  };

  for (const preset of PRESETS) {
    const range = resolveRange(preset);
    const data = aggregateDailyRecords(allRecords, roster, range);
    const snapshot = normalizeForStaticHosting(data);

    const fileName = `${preset}.json`;
    const outPath = path.join(snapshotOutDir, fileName);
    await writeSnapshotFile(outPath, snapshot);

    const issueCount = data.summary.closedIssues + data.summary.openAssignedIssues;
    const prCount = data.summary.mergedPrs + data.summary.openAuthoredPrs;
    const reviewCount = data.summary.reviewsSubmitted;
    console.log(`[aggregate-daily] ${preset}: ${issueCount} issues, ${prCount} PRs, ${reviewCount} reviews → ${outPath}`);

    meta.presets.push({ preset, path: `/snapshots/${fileName}`, label: range.label });
  }

  await writeSnapshotFile(path.join(snapshotOutDir, "meta.json"), meta);
  console.log("[aggregate-daily] Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
