import { describe, expect, it } from "vitest";

import { resolveRange } from "@/lib/range";

describe("resolveRange", () => {
  it("returns a 30 day range by default", () => {
    const range = resolveRange();

    expect(range.preset).toBe("30d");
    expect(range.label).toBe("Last 30 days");
    expect(new Date(range.from).getTime()).toBeLessThan(new Date(range.to).getTime());
  });

  it("supports 90 day presets", () => {
    const range = resolveRange("90d");

    expect(range.label).toBe("Last 90 days");
  });
});
