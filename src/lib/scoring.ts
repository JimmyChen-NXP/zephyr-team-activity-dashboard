export const ACTIVITY_SCORE_FORMULA =
  "activity score = (open assigned issues × 3) + (closed issues × 2) + (open authored PRs × 3) + (merged PRs × 2) + reviews submitted + (pending review requests × 2) + stale items";

export type ActivityScoreInputs = {
  openAssignedIssues: number;
  closedIssues: number;
  openAuthoredPrs: number;
  mergedPrs: number;
  reviewsSubmitted: number;
  pendingReviewRequests: number;
  staleItems: number;
};

export function calculateActivityScore(inputs: ActivityScoreInputs) {
  return (
    inputs.openAssignedIssues * 3 +
    inputs.closedIssues * 2 +
    inputs.openAuthoredPrs * 3 +
    inputs.mergedPrs * 2 +
    inputs.reviewsSubmitted +
    inputs.pendingReviewRequests * 2 +
    inputs.staleItems
  );
}
