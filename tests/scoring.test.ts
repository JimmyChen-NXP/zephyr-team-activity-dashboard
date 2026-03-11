import { describe, expect, it } from "vitest";

import { calculateActivityScore } from "@/lib/scoring";

describe("calculateActivityScore", () => {
  it("applies the documented weighted formula", () => {
    expect(
      calculateActivityScore({
        openAssignedIssues: 2,
        openAuthoredPrs: 1,
        mergedPrs: 3,
        reviewsSubmitted: 4,
        pendingReviewRequests: 2,
        staleItems: 1,
      }),
    ).toBe(24);
  });
});
