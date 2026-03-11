---
title: feat: Simplify env token management and live sync status
type: feat
status: active
date: 2026-03-11
---

# feat: Simplify env token management and live sync status

## Overview

Refine the dashboard's authentication and sync UX so local GitHub access is configured only through `.env.local`, not through an in-page token form. At the same time, shrink the high-visibility status footprint and make token health easier to understand by separating:

- token missing
- token configured
- token verified
- token invalid or expired
- current data source (`live`, `cache`, or `demo`)

The goal is a simpler local setup model and a clearer runtime status model for all three dashboard views.

## Problem Statement / Motivation

The current dashboard still exposes an in-page token entry flow even though the app already supports `GITHUB_TOKEN` in `.env.local`.

This causes three UX problems:

1. **Too many token paths**
   - Users can configure auth through `.env.local` or by posting a token into the page.
   - This duplicates setup and leaves dead-end state such as cookie precedence over environment configuration.

2. **Status ambiguity**
   - The current UI shows whether a token exists and what source it came from, but not whether the token is actually valid.
   - A token may be present while live sync is failing and the dashboard is silently showing cached or demo data.

3. **Visual density near the top of the page**
   - The current shared shell contains filters, refresh controls, sync pill, and a full token management panel near the top.
   - The user wants the Signals/status experience to be smaller and easier to scan.

## Proposed Solution

Adopt an **environment-only authentication model** and replace the current token panel with a **compact connection and sync status section**.

### Product decisions

#### 1. Remove in-page token management

- Remove the token input UI from the shared shell.
- Stop relying on the `github_token` cookie for dashboard auth.
- Use `process.env.GITHUB_TOKEN` as the only supported local token source.
- Update setup documentation so `.env.local` is the only documented way to configure local auth.

#### 2. Replace token-source display with connection-status display

Replace the current `hasToken` / `tokenSource` emphasis with a clearer model that answers:

- Is a token configured?
- Has GitHub connectivity been verified?
- What data source is currently rendering?
- When was the last successful sync or validation?

Recommended user-facing status states:

- `missing` — no env token configured
- `configured` — env token exists but has not been validated in the current runtime/session
- `valid` — lightweight GitHub validation succeeded
- `invalid` — unauthorized / expired / bad token
- `rate-limited` — token exists but GitHub refused further calls
- `error` — other GitHub/connectivity failure

#### 3. Add a token connection test

Introduce a lightweight connection test so the user can confirm whether the configured token is usable without needing to infer validity from a full live refresh.

Recommended behavior:

- Add a small “Test connection” action in the compact status area.
- The test should use a lightweight authenticated GitHub request, not the full dashboard collection pipeline.
- The result should show concise, actionable feedback such as:
  - `Connected to GitHub`
  - `Token missing`
  - `Token rejected (unauthorized or expired)`
  - `GitHub rate limit reached`
  - `GitHub request failed`

#### 4. Make the status area smaller and clearer

Replace the large token section and oversized top status treatment with a compact block or small cards that stays above the fold and shows only the essentials:

- connection status
- current data source
- generated/freshness timestamp
- optional one-click connection test

Detailed warnings should remain visible, but as secondary information rather than primary page chrome.

## Technical Considerations

### Existing patterns to preserve

- Shared shell across [src/app/issues/page.tsx](src/app/issues/page.tsx), [src/app/pull-requests/page.tsx](src/app/pull-requests/page.tsx), and [src/app/reviews/page.tsx](src/app/reviews/page.tsx)
- Centralized auth and live/cache/demo resolution in [src/lib/dashboard.ts](src/lib/dashboard.ts)
- Shared sync-health rendering in [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
- Snapshot fallback behavior and warning surfacing in [src/lib/dashboard.ts](src/lib/dashboard.ts)
- GitHub API access helpers in [src/lib/github.ts](src/lib/github.ts)

### Recommended implementation shape

1. Extract dashboard auth resolution into a dedicated helper so auth status can be reused by dashboard loading and connection-test logic.
2. Simplify auth precedence from `cookie -> env -> none` to `env -> none`.
3. Remove or retire the `/api/token` cookie-management route.
4. Add a lightweight GitHub connection-test path that performs a minimal authenticated probe.
5. Expand the auth/status data model so the UI can distinguish configured vs verified vs invalid.
6. Replace the token panel in the shared shell with a compact status surface.
7. Keep detailed warnings below as secondary content.
8. Update README and env instructions.

### Suggested file touchpoints

#### Auth and status model

- [src/lib/dashboard.ts](src/lib/dashboard.ts)
  - simplify `getGitHubAuth()`
  - attach richer connection state to returned dashboard data
- [src/lib/types.ts](src/lib/types.ts)
  - replace or expand the current auth shape
- [src/lib/github.ts](src/lib/github.ts)
  - add a lightweight GitHub probe helper for connection testing / validation

#### UI and layout

- [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
  - remove token form
  - add compact connection/sync status UI
  - reduce top-of-page visual footprint
- [src/app/globals.css](src/app/globals.css)
  - remove unused token-panel styling
  - tune compact status layout

#### Route surface

- [src/app/api/token/route.ts](src/app/api/token/route.ts)
  - remove or retire if no longer needed
- new lightweight status-test route or server action
  - preferred if an explicit “Test connection” control is added

#### Documentation

- [README.md](README.md)
- [.env.example](.env.example)

### Recommended connection-test strategy

Use a lightweight authenticated request against GitHub rather than a full live dashboard collection.

Preferred characteristics:

- low latency
- low rate-limit cost
- clearly maps failure responses to user-facing messages
- safe to run repeatedly from the UI

Recommended output contract:

- `status`
- `message`
- `checkedAt`
- optional `rateLimitRemaining`
- optional `requestId` for diagnostics

### Data semantics to clarify

The current model mixes three concepts that should be separate:

1. **Configuration state** — does an env token exist?
2. **Connection state** — does a lightweight GitHub-authenticated request succeed?
3. **Data source state** — is the page currently showing `live`, `cache`, or `demo` data?

The new UI should never imply that one of these automatically proves the others.

Examples:

- `valid token` + `cache source` is possible after a non-refresh page load
- `configured token` + `demo source` is possible if validation/live sync fails and no snapshot exists
- `cache source` does not necessarily mean the token is invalid; it may simply mean cached data was reused

## System-Wide Impact

### Interaction graph

- Page routes call `getDashboardData(filters)`.
- `getDashboardData()` resolves auth, chooses snapshot/live/demo behavior, and returns `DashboardData`.
- `DashboardShell` renders the shared status and warnings UI from that data.
- If a new connection test is added, it should reuse the same auth helper and GitHub header logic rather than duplicating token rules.

### Error propagation

- GitHub request errors currently flow through the live-sync fallback path in [src/lib/dashboard.ts](src/lib/dashboard.ts).
- The new connection-test path should map GitHub failures to stable UI states without leaking raw token details.
- Connection-test errors should remain distinct from full live-sync errors.

### State lifecycle risks

- Removing cookie auth changes runtime behavior for users who previously depended on in-page token storage.
- If `.env.local` changes require a dev-server restart, the UX and docs must say so explicitly.
- Snapshot fallback must remain intact even when token validation fails.

### API surface parity

The shared shell is used by all three activity pages, so the new status model must render consistently in:

- [src/app/issues/page.tsx](src/app/issues/page.tsx)
- [src/app/pull-requests/page.tsx](src/app/pull-requests/page.tsx)
- [src/app/reviews/page.tsx](src/app/reviews/page.tsx)

### Integration test scenarios

- Missing env token → dashboard renders without token form and clearly shows live sync unavailable
- Valid env token → connection test succeeds and dashboard still correctly distinguishes `live` vs `cache`
- Invalid env token + cached snapshot exists → user sees explicit auth failure plus cached data state
- Invalid env token + no snapshot exists → user sees explicit auth failure plus demo-data fallback
- `.env.local` updated but server not restarted → docs/help text explains why status has not changed yet

## Acceptance Criteria

### Functional requirements

- [ ] The dashboard no longer renders a token input, save token, or clear token UI.
- [ ] Dashboard auth no longer depends on the `github_token` cookie path.
- [ ] The UI clearly states when GitHub live sync is unavailable because `GITHUB_TOKEN` is missing.
- [ ] The UI distinguishes token configuration state from token validity and from active data source.
- [ ] A user can run a lightweight token connection test, or an equivalent explicit validation signal is surfaced.
- [ ] Connection-test feedback is human-readable and actionable.
- [ ] The compact top status area is visibly smaller than the current token + signals presentation.
- [ ] Detailed warnings remain available without dominating the page.

### Non-functional requirements

- [ ] Connection test uses a lightweight GitHub request rather than full live collection.
- [ ] No token value is ever rendered, logged, or returned to the browser.
- [ ] The new status model works consistently across all three dashboard routes.
- [ ] Snapshot fallback behavior remains unchanged except for clearer messaging.

### Quality gates

- [ ] Tests cover env-only auth resolution.
- [ ] Tests cover missing, valid, invalid, and rate-limited connection states.
- [ ] Tests cover fallback combinations for live, cache, and demo with the new status model.
- [ ] README and `.env` setup documentation are updated.

## Success Metrics

- Users can determine token state in one glance without opening DevTools.
- Local setup has one documented auth path instead of two.
- Status confusion between token presence and live sync success is eliminated.
- The top-of-page shared shell becomes visually lighter while preserving operational clarity.

## Dependencies & Risks

### Dependencies

- Existing shared shell contract in [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
- Current auth and fallback pipeline in [src/lib/dashboard.ts](src/lib/dashboard.ts)
- GitHub API helper behavior in [src/lib/github.ts](src/lib/github.ts)

### Risks

- Removing cookie auth is a breaking UX change for anyone relying on in-page token entry.
- Overshrinking the status area could hide important warnings about partial or cached coverage.
- A connection test that is too similar to full live sync could add unnecessary latency or rate-limit pressure.
- If `auth.tokenSource` remains partially in the type system, stale status semantics may survive in tests or fixtures.

### Mitigations

- Keep warnings visible as a secondary block even after compacting the top status UI.
- Prefer a minimal validation endpoint over full sync for connection testing.
- Update docs and inline copy to state that `.env.local` changes may require a restart.
- Remove obsolete cookie-specific code paths rather than leaving them partially active.

## Implementation slices

### Slice 1 — Auth model cleanup

- [ ] Update [src/lib/dashboard.ts](src/lib/dashboard.ts) to resolve env-only auth
- [ ] Update [src/lib/types.ts](src/lib/types.ts) to represent connection state clearly
- [ ] Remove or retire [src/app/api/token/route.ts](src/app/api/token/route.ts)

### Slice 2 — Lightweight validation

- [ ] Add lightweight GitHub connection validation in [src/lib/github.ts](src/lib/github.ts) or a new focused helper file
- [ ] Expose validation through a dedicated server route/action if the UI needs an explicit test button
- [ ] Map GitHub failures to stable user-facing states and messages

### Slice 3 — Shared shell simplification

- [ ] Remove token form UI from [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
- [ ] Add compact status surface for connection, source, and freshness
- [ ] Update [src/app/globals.css](src/app/globals.css) to reduce status-area footprint

### Slice 4 — Docs and tests

- [ ] Update [README.md](README.md)
- [ ] Update [.env.example](.env.example) if wording needs clarification
- [ ] Add tests for connection-state mapping and fallback rendering

## Sources & References

### Internal references

- Shared shell and current token UI: [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx)
- Current token route: [src/app/api/token/route.ts](src/app/api/token/route.ts)
- Auth and fallback pipeline: [src/lib/dashboard.ts](src/lib/dashboard.ts)
- GitHub API helpers: [src/lib/github.ts](src/lib/github.ts)
- Shared styles: [src/app/globals.css](src/app/globals.css)
- Current setup docs: [README.md](README.md)
- Env template: [.env.example](.env.example)
- Shared page split plan: [docs/plans/2026-03-10-feat-split-dashboard-activity-pages-plan.md](docs/plans/2026-03-10-feat-split-dashboard-activity-pages-plan.md)

### Institutional learnings

- Keep connection and data-source semantics separate, following the same principle used to separate author and reviewer logic in [docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md](docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md)

### External research decision

Proceed without external research. The codebase already contains the relevant auth, sync, and layout patterns, and this change is primarily an internal product and state-model refinement rather than a framework-unknown integration.

## SpecFlow notes

Key gaps to close during implementation:

- Avoid conflating `configured`, `verified`, and `live`
- Keep cache/demo fallback understandable when auth fails
- Ensure connection test is lightweight and does not become a second live-sync path
- Make restart requirements explicit if env changes are not hot-reloaded
