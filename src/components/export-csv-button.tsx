"use client";

import type { ActivityItem } from "@/lib/types";

type ExportCsvButtonProps = {
  filename: string;
  items: ActivityItem[];
};

function escapeCsvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function buildCsv(items: ActivityItem[]) {
  const header = ["Type", "Title", "Contributor", "Repository", "State", "Created At", "Updated At", "URL"];
  const rows = items.map((item) => [
    item.type,
    item.title,
    item.contributor,
    item.repo,
    item.state,
    item.createdAt,
    item.updatedAt,
    item.url,
  ]);

  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function ExportCsvButton({ filename, items }: ExportCsvButtonProps) {
  function handleClick() {
    const csv = buildCsv(items);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" className="ghost-button" onClick={handleClick}>
      Export CSV
    </button>
  );
}
