# UI Specification

**Maintenance rule**: Any PR that adds, removes, or reorders a column, filter, or default MUST update this document.

---

## Pages

### /issues

**Component**: `src/components/issues-table.tsx`

#### Filter controls

| Filter | Type | Default | Values |
|--------|------|---------|--------|
| State | Column-header dropdown (ColumnFilterTh) | `["Assigned", "Stale issue"]` | Derived from `item.statusLabel` values present in dataset |

#### Issues table

Columns in order:

| # | Header | Source field | Format | Notes |
|---|--------|-------------|--------|-------|
| 1 | Issue | `item.title` + `item.url` | Linked text | Opens GitHub URL in new tab |
| 2 | State | `item.statusLabel` | Text | Filter column (ColumnFilterTh) |
| 3 | Assignee | `item.contributor` | `@login` | Roster member assigned to the issue |
| 4 | Reporter | `item.author` | `@login` (linked to `github.com/<login>`) | Issue author |
| 5 | Labels | `item.labels` | Label chips (`.label-chip`); `—` when empty/undefined | Optional; undefined for records collected before labels were captured |
| 6 | Created | `item.createdAt` | Relative (`formatDistanceToNowStrict`, e.g. "14 days ago") | |
| 7 | Updated | `item.updatedAt` | Relative (`formatDistanceToNowStrict`) | |
| 8 | Repository | `item.repo` | Full `org/name` string | |

Row limit: 40 (slice).
Empty-state colSpan: 8.

---

### /pull-requests

**Component**: `src/components/authored-prs-table.tsx`

#### Filter controls

| Filter | Type | Default | Values |
|--------|------|---------|--------|
| State | Column-header dropdown (ColumnFilterTh) | `["Open PR"]` | `Open PR`, `Draft PR`, `Merged`, `Closed` |

#### Authored PRs table

Columns in order:

| # | Header | Source field | Format | Notes |
|---|--------|-------------|--------|-------|
| 1 | PR | `item.title` + `item.url` | Linked text | |
| 2 | State | `item.statusLabel` | Text | Filter column |
| 3 | Assignees | `item.prStatus.assignees` | Badge chips with verdict icons | `—` when prStatus absent |
| 4 | Reviewers | `item.prStatus` | Badge chips for verdicts + pending count | `—` when prStatus absent |
| 5 | Labels | `item.labels` | Label chips; `—` when empty/undefined | |
| 6 | CI | `item.prStatus.ciStatus` | `✓` / `✗` / `…` / `—` | |
| 7 | Contributor | `item.contributor` | `@login` | PR author (roster member) |
| 8 | Created | `item.createdAt` | Relative (`formatDistanceToNowStrict`) | |
| 9 | Updated | `item.updatedAt` | Relative (`formatDistanceToNowStrict`) | |
| 10 | Repo | `item.repo` | Short name (`org/name`.split("/").at(-1)) | |

Row limit: 40 (slice).
Empty-state colSpan: 10.

Row highlight (`data-pr-highlight`): `blocked` when CI failing or CHANGES_REQUESTED verdict; `draft` for Draft PRs; `stale` when ageDays ≥ 30.

---

### /reviews

**Component**: `src/components/reviewed-prs-table.tsx`

#### Filter controls

| Filter | Type | Default | Values |
|--------|------|---------|--------|
| Outcome | Chip bar (multi-select toggle) | `["commented"]` | `approved`, `changes_requested`, `commented` |

#### Reviewed PRs table

Columns in order:

| # | Header | Source field | Format |
|---|--------|-------------|--------|
| 1 | Reviewed PR | `item.title` + `item.url` | Linked text |
| 2 | Outcome | `item.state` | Formatted outcome string |
| 3 | Author type | `item.reviewedPrKind` | "Self" / "Teammate" / "External" |
| 4 | Updated | `item.updatedAt` | Relative |
| 5 | Repository | `item.repo` | Full `org/name` |
| 6 | Reviewer | `item.contributor` | `@login` |
| 7 | Author | `item.author` | `@login` |
| 8 | Created | `item.createdAt` | Relative |

Empty-state colSpan: 8.

---

### /maintainers

**Component**: `src/components/maintainers-page.tsx`

#### Filter controls

| Filter | Type | Default |
|--------|------|---------|
| Component name | Text input | `""` |
| Person name | Text input (also updated by chart click) | `""` |
| Type | Select | `"all"` |
| Detected from | Date input | `""` |
| Hide no maintainer/collaborator | Checkbox | `true` (checked) |

#### Component ownership table

Columns in order:

| # | Header | Source field |
|---|--------|-------------|
| 1 | Component | `s.name` |
| 2 | Maintainers | `s.maintainers` (PersonList) |
| 3 | Collaborators | `s.collaborators` (PersonList) |
| 4 | Type | `s.type` (TypeBadge) |
| 5 | Detected | `s.detectedAt` |

Empty-state colSpan: 5.
