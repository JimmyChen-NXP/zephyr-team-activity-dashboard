---
title: Dashboard reported GitHub token invalid because OS/session env overrode .env.local
date: 2026-03-11
category: integration-issues
tags:
  - github
  - auth
  - env
  - nextjs
  - dashboard
  - windows
  - troubleshooting
status: completed
---

# Dashboard reported GitHub token invalid because OS/session env overrode .env.local

## Summary

The dashboard showed **Invalid** GitHub connection even though a valid PAT had been placed in `.env.local`. The root cause was an unexpected token source: a stale `GITHUB_TOKEN` already set in the OS/session environment was being used by the running dev server instead of the value the user expected.

The fix makes token resolution deterministic in development by preferring `.env.local` (read directly) over `process.env.GITHUB_TOKEN`, and adds token sanitization to avoid common copy/paste formatting pitfalls.

## Problem type

Runtime configuration / integration issue between environment loading, local developer shell state, and GitHub authentication.

## Symptoms observed

- The top status strip reported **Invalid** GitHub connection.
- The connection test endpoint returned an auth state with `connectionStatus: "invalid"` after a GitHub `401 Unauthorized`.
- The user could confirm their PAT was valid via a direct GitHub API probe, yet the app still reported invalid credentials.

## Components involved

- Token resolution and sanitization: [src/lib/github-auth.ts](src/lib/github-auth.ts)
- Connection test API endpoint: [src/app/api/github-auth/test/route.ts](src/app/api/github-auth/test/route.ts)
- Probe request logic (`GET /rate_limit`): [src/lib/github.ts](src/lib/github.ts)
- UI status + connection test button: [src/components/dashboard-shell.tsx](src/components/dashboard-shell.tsx), [src/components/connection-test-button.tsx](src/components/connection-test-button.tsx)
- Setup guidance: [README.md](README.md), [.env.example](.env.example)

## Root cause

Two issues contributed to the same user-facing symptom ("token invalid"):

1) **Token source precedence confusion**

A `GITHUB_TOKEN` value already existed in the OS/session environment for the running dev server process. Depending on how the server was started and what environment variables were present, this could override the developer’s expectation that `.env.local` would be the sole source of truth.

2) **Token formatting pitfalls (copy/paste artifacts)**

Even when the correct token is chosen, environment values often include formatting that GitHub will reject (e.g., newline characters or prefix strings like `Bearer `). This can lead to `401 Unauthorized` and the same **Invalid** status.

## Investigation steps

1. Use the built-in connection test (UI button) which calls [src/app/api/github-auth/test/route.ts](src/app/api/github-auth/test/route.ts).
2. Confirm the failure is a real GitHub `401` from the probe endpoint (`/rate_limit`) rather than a UI-only issue.
3. Compare the token values (without pasting them into logs): verify whether the running process is using `.env.local` or the OS/session env.
4. Confirm whether the token contains copy/paste artifacts (quotes, newlines, or a `Bearer` / `token` prefix).

## Working solution

### 1) Sanitize the token before use

In [src/lib/github-auth.ts](src/lib/github-auth.ts), `sanitizeGitHubEnvToken()` normalizes token strings by:

- trimming whitespace
- removing `\r`/`\n`
- removing wrapping single/double quotes
- stripping leading `Bearer ` or `token ` prefixes (case-insensitive)

This prevents false negatives due to common formatting mistakes.

### 2) Prefer `.env.local` in development to avoid OS/session overrides

In [src/lib/github-auth.ts](src/lib/github-auth.ts), `getGitHubEnvToken()` resolves the token as:

- `readGitHubTokenFromEnvLocal()` (direct read of `.env.local`) if available
- otherwise fall back to `process.env.GITHUB_TOKEN`

This makes local behavior deterministic even when a shell profile, CI helper, or prior session set a stale `GITHUB_TOKEN` in the environment.

### 3) Keep tests deterministic

`readGitHubTokenFromEnvLocal()` is disabled under test (`NODE_ENV === "test"` or `VITEST`), so unit tests don’t depend on filesystem state and only use environment values set by the test harness.

## Regression coverage

- Token sanitization + probe behavior is covered in [tests/github-auth.test.ts](tests/github-auth.test.ts).
- The suite verifies that a token like `Bearer ghp_valid` is accepted and used correctly for the probe request.

## Validation

The following checks were used after implementing the fix:

- `npm.cmd test`
- `npm.cmd run lint`
- `npm.cmd run build`

## Prevention strategies

- Make token precedence explicit in user-facing copy (e.g., “Using `.env.local`” vs “Using process env”).
- Avoid caching token values in ways that make it unclear when a restart is required; if caching is necessary, show a non-secret “loaded at” timestamp.
- Improve error messaging for `401` to emphasize source/precedence and restart behavior (not just token formatting).

## Recommended test cases going forward

- `.env.local` present + OS env present → `.env.local` is chosen (dev)
- `Bearer <token>` / `token <token>` prefixes → sanitized and accepted
- trailing newline `\r\n` → sanitized and accepted
- missing token → `connectionStatus: "missing"`
- unauthorized token → `connectionStatus: "invalid"`

## Related references

- Setup template + restart note: [.env.example](.env.example)
- Dashboard setup + restart note: [README.md](README.md)
- Prior dashboard correctness writeup (unrelated bug, same doc format): [docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md](docs/solutions/logic-errors/external-authored-pr-reviews-skipped-in-live-collection.md)

## Key takeaway

When debugging “token invalid” reports, first confirm **which token source** the running process is using (OS/session vs `.env.local`) and normalize the token value before probing GitHub. This eliminates the most common causes of confusing 401s without reintroducing token entry UI.
