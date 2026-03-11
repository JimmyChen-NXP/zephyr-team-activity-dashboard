---
status: pending
priority: p3
issue_id: "004"
tags: [code-review, ui, quality, reviews]
dependencies: []
---

# Reviewed PR table has minor presentation inconsistencies

The review table was expanded with new columns, but the empty-state span and some column semantics were not fully updated. This does not block the feature, but it leaves the table slightly inconsistent.

## Findings

- `src/components/reviewed-prs-table.tsx` now renders 9 columns, but the empty-state row still uses `colSpan={8}`.
- The `Status` column uses `item.statusLabel`, which already embeds both review outcome and author classification (for example, `APPROVED · Authored by teammate`).
- The table also renders separate `Author type` and `Outcome` columns, so `Status` duplicates information rather than representing a distinct field.

## Proposed Solutions

### Option 1: Fix the colspan and keep the current column wording

**Approach:** Update `colSpan` to 9 and accept the duplication for now.

**Pros:**
- Very small change
- Fixes the broken empty state immediately

**Cons:**
- Leaves ambiguous column semantics

**Effort:** <30 minutes

**Risk:** Low

---

### Option 2: Normalize review table fields

**Approach:** Update the table so `Status` shows only PR/open-close state or remove/rename the column, while `Outcome` and `Author type` remain distinct.

**Pros:**
- Clearer table semantics
- Avoids duplicated data

**Cons:**
- Requires deciding what `Status` should actually mean

**Effort:** 30-90 minutes

**Risk:** Low

## Recommended Action


## Technical Details

**Affected files:**
- `src/components/reviewed-prs-table.tsx`

**Related components:**
- Review activity page

**Database changes (if any):**
- Migration needed? No

## Resources

- **Branch:** `feat/zephyr-dashboard`

## Acceptance Criteria

- [ ] Empty review-table state spans the full table width
- [ ] Review table columns each represent a distinct concept
- [ ] Table content remains readable after the schema adjustment

## Work Log

### 2026-03-11 - Initial Discovery

**By:** GitHub Copilot

**Actions:**
- Reviewed the updated review table structure after the new columns were added
- Compared rendered columns with empty-state handling and value sources

**Learnings:**
- The visual schema changed faster than the supporting table details
- This is cosmetic, not a data integrity issue

## Notes

- Safe to address after the live collector correctness fix.
