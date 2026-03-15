/**
 * collect-maintainers.mjs
 *
 * Fetches MAINTAINERS.yml from the Zephyr repository and produces a
 * per-subsystem map. Each subsystem entry lists its roster maintainers,
 * roster collaborators, and a type ("component" | "file-group").
 *
 * Type is determined by whether the MAINTAINERS.yml entry has a `labels:`
 * field (component) or not (file-group).
 *
 * Only subsystems where at least one roster member (from upstream_member.csv)
 * appears as maintainer or collaborator are included. Logins are matched
 * case-insensitively.
 *
 * Usage:
 *   node scripts/collect-maintainers.mjs
 *
 * Output:
 *   public/maintainers-map.json
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { load as parseYaml } from "js-yaml";

const MAINTAINERS_URL =
  "https://raw.githubusercontent.com/zephyrproject-rtos/zephyr/main/MAINTAINERS.yml";
const ROSTER_FILE = "upstream_member.csv";
const OUT_FILE = join("public", "maintainers-map.json");
const LEGACY_DETECTED_AT = "2026-03-01";

// ── Load roster ──────────────────────────────────────────────────────────────

function loadRosterMap() {
  const csvText = readFileSync(ROSTER_FILE, "utf8").replace(/^\uFEFF/, "");
  const records = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  /** @type {Map<string, string>} lowercase login → display name */
  const map = new Map();
  for (const record of records) {
    if (!record.Login) continue;
    const login = record.Login.toLowerCase();
    const name =
      record.Name && record.Name !== "null" ? record.Name : record.Login;
    map.set(login, name);
  }
  return map;
}

// ── Fetch + parse MAINTAINERS.yml ─────────────────────────────────────────────

async function fetchMaintainersYaml() {
  const response = await fetch(MAINTAINERS_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch MAINTAINERS.yml: ${response.status} ${response.statusText}`
    );
  }
  return response.text();
}

// ── Load existing detectedAt map ──────────────────────────────────────────────

/**
 * Returns a Map of subsystem name → detectedAt string from the existing output
 * file if it exists, so we can preserve first-seen dates across runs.
 * @returns {Map<string, string>}
 */
function loadExistingDetectedAt() {
  if (!existsSync(OUT_FILE)) return new Map();
  try {
    const existing = JSON.parse(readFileSync(OUT_FILE, "utf8"));
    const map = new Map();
    for (const s of (existing.subsystems ?? [])) {
      if (s.name && s.detectedAt) {
        map.set(s.name, s.detectedAt);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

// ── Build per-subsystem data ───────────────────────────────────────────────────

/**
 * @param {unknown} yaml - parsed YAML (object keyed by subsystem name)
 * @param {Map<string, string>} rosterMap - lowercase login → display name
 * @param {Map<string, string>} existingDetectedAt - name → previous detectedAt
 */
function buildMaintainersData(yaml, rosterMap, existingDetectedAt) {
  if (typeof yaml !== "object" || yaml === null) {
    throw new Error("Unexpected MAINTAINERS.yml structure (not an object)");
  }

  /** @type {Array<{name: string, type: string, maintainers: Array<{login:string,name:string}>, collaborators: Array<{login:string,name:string}>}>} */
  const subsystems = [];

  for (const [subsystemName, entry] of Object.entries(yaml)) {
    if (typeof entry !== "object" || entry === null) continue;

    const rawMaintainers = Array.isArray(entry.maintainers) ? entry.maintainers : [];
    const rawCollaborators = Array.isArray(entry.collaborators) ? entry.collaborators : [];

    // Resolve roster members only, sorted by display name
    function rosterPeople(logins) {
      return logins
        .filter((l) => typeof l === "string" && rosterMap.has(l.toLowerCase()))
        .map((l) => ({ login: l.toLowerCase(), name: rosterMap.get(l.toLowerCase()) ?? l }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    const maintainers = rosterPeople(rawMaintainers);
    const collaborators = rosterPeople(rawCollaborators);

    // "component" if the entry has GitHub labels; otherwise "file-group"
    const hasLabels = Array.isArray(entry.labels) && entry.labels.length > 0;
    const type = hasLabels ? "component" : "file-group";

    // Preserve detectedAt from previous run; default legacy records to LEGACY_DETECTED_AT;
    // new subsystems get today's date.
    const detectedAt =
      existingDetectedAt.get(subsystemName) ??
      (existingDetectedAt.size > 0 ? new Date().toISOString().slice(0, 10) : LEGACY_DETECTED_AT);

    subsystems.push({ name: subsystemName, type, maintainers, collaborators, detectedAt });
  }

  // Sort subsystems alphabetically by name
  subsystems.sort((a, b) => a.name.localeCompare(b.name));

  return {
    generatedAt: new Date().toISOString(),
    subsystems,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Loading roster from", ROSTER_FILE);
  const rosterMap = loadRosterMap();
  console.log(`  ${rosterMap.size} roster members loaded`);

  console.log("Fetching", MAINTAINERS_URL);
  const yamlText = await fetchMaintainersYaml();
  console.log(`  Downloaded ${(yamlText.length / 1024).toFixed(1)} KB`);

  console.log("Parsing MAINTAINERS.yml");
  const yaml = parseYaml(yamlText);

  console.log("Loading existing detectedAt values from", OUT_FILE);
  const existingDetectedAt = loadExistingDetectedAt();
  console.log(`  ${existingDetectedAt.size} existing subsystem dates loaded`);

  console.log("Building maintainers map");
  const data = buildMaintainersData(yaml, rosterMap, existingDetectedAt);

  console.log(`  ${data.subsystems.length} subsystems with at least one roster member`);

  mkdirSync("public", { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), "utf8");
  console.log(`Written: ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("collect-maintainers failed:", err);
  process.exit(1);
});
