import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "csv-parse/sync";

import type { RosterMember } from "@/lib/types";

const ROSTER_FILE = "upstream_member.csv";

export function parseRosterCsv(csvText: string): RosterMember[] {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return records
    .map((record) => ({
      login: record.Login,
      name: record.Name && record.Name !== "null" ? record.Name : record.Login,
      email: record.Email ? record.Email : null,
      createdAt: record["Created At"] ? record["Created At"] : null,
      role: record.Role,
    }))
    .filter((member) => Boolean(member.login));
}

export async function loadRoster(): Promise<RosterMember[]> {
  const filePath = path.join(process.cwd(), ROSTER_FILE);
  const csvText = await readFile(filePath, "utf8");

  return parseRosterCsv(csvText);
}
