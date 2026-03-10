# Team activity metric definitions

## Open assigned issues
Count of open GitHub issues inside `zephyrproject-rtos` with at least one assignee in the roster.

## Open authored PRs
Count of open pull requests authored by a roster member.

## Merged PRs
Count of pull requests authored by a roster member and merged during the selected range.

## Reviews submitted
Count of review submissions authored by roster members within the selected range.

## Pending review requests
Count of currently open review requests targeting roster members.

## Stale items
Open issues or pull requests whose `updated_at` timestamp is older than seven days from the active range end.

## Median first review
Median number of hours between PR creation and the first roster-member review captured during the active range.

## Median merge time
Median number of hours between PR creation and merge for merged PRs authored by roster members.

## Partial-data caveats
- Search-based org collection is capped by `SEARCH_PAGE_LIMIT`.
- GitHub Search may return incomplete results.
- The UI surfaces warnings whenever the dataset is sampled, capped, cached, or using demo data.
