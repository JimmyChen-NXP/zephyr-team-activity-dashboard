/**
 * collect-maintainers.mjs
 *
 * Fetches MAINTAINERS.yml from the Zephyr repository, inverts it into a
 * per-person map, cross-references with the team roster CSV, and writes
 * public/maintainers-map.json.
 *
 * Only roster members (logins present in upstream_member.csv) are included.
 * Logins are matched case-insensitively.
 *
 * Usage:
 *   node scripts/collect-maintainers.mjs
 *
 * Output:
 *   public/maintainers-map.json
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { load as parseYaml } from "js-yaml";

const MAINTAINERS_URL =
  "https://raw.githubusercontent.com/zephyrproject-rtos/zephyr/main/MAINTAINERS.yml";
const ROSTER_FILE = "upstream_member.csv";
const OUT_FILE = join("public", "maintainers-map.json");

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

// ── Invert subsystem map into per-person buckets ──────────────────────────────

/**
 * @param {unknown} yaml - parsed YAML (object keyed by subsystem name)
 * @param {Map<string, string>} rosterMap - lowercase login → display name
 */
function buildMaintainersData(yaml, rosterMap) {
  /** @type {Map<string, Set<string>>} */
  const maintainerSubsystems = new Map();
  /** @type {Map<string, Set<string>>} */
  const collaboratorSubsystems = new Map();

  if (typeof yaml !== "object" || yaml === null) {
    throw new Error("Unexpected MAINTAINERS.yml structure (not an object)");
  }

  for (const [subsystemName, entry] of Object.entries(yaml)) {
    if (typeof entry !== "object" || entry === null) continue;

    const maintainers = Array.isArray(entry.maintainers)
      ? entry.maintainers
      : [];
    const collaborators = Array.isArray(entry.collaborators)
      ? entry.collaborators
      : [];

    for (const login of maintainers) {
      if (typeof login !== "string") continue;
      const key = login.toLowerCase();
      if (!rosterMap.has(key)) continue; // skip non-roster members
      if (!maintainerSubsystems.has(key)) maintainerSubsystems.set(key, new Set());
      maintainerSubsystems.get(key).add(subsystemName);
    }

    for (const login of collaborators) {
      if (typeof login !== "string") continue;
      const key = login.toLowerCase();
      if (!rosterMap.has(key)) continue; // skip non-roster members
      if (!collaboratorSubsystems.has(key)) collaboratorSubsystems.set(key, new Set());
      collaboratorSubsystems.get(key).add(subsystemName);
    }
  }

  // Convert to sorted arrays
  function toEntries(map) {
    return Array.from(map.entries())
      .map(([loginLower, subsystemSet]) => ({
        login: loginLower,
        name: rosterMap.get(loginLower) ?? loginLower,
        subsystems: Array.from(subsystemSet).sort((a, b) =>
          a.localeCompare(b)
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    generatedAt: new Date().toISOString(),
    maintainers: toEntries(maintainerSubsystems),
    collaborators: toEntries(collaboratorSubsystems),
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

  console.log("Building maintainers map");
  const data = buildMaintainersData(yaml, rosterMap);

  console.log(
    `  ${data.maintainers.length} maintainers, ${data.collaborators.length} collaborators (roster members only)`
  );

  mkdirSync("public", { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), "utf8");
  console.log(`Written: ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("collect-maintainers failed:", err);
  process.exit(1);
});
