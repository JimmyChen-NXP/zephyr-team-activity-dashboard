import { endOfDay, formatISO, startOfDay, subDays } from "date-fns";

import type { DashboardPreset, RangeOption } from "@/lib/types";

export const DEFAULT_PRESET: DashboardPreset = "30d";

export function resolveRange(preset: DashboardPreset = DEFAULT_PRESET): RangeOption {
  const now = new Date();
  const to = endOfDay(now);

  const days = preset === "7d" ? 6 : preset === "90d" ? 89 : 29;
  const from = startOfDay(subDays(to, days));

  return {
    preset,
    label: preset === "7d" ? "Last 7 days" : preset === "90d" ? "Last 90 days" : "Last 30 days",
    from: formatISO(from),
    to: formatISO(to),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
