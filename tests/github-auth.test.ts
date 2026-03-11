import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildConfiguredGitHubAuthState,
  buildGitHubAuthStateFromError,
  buildMissingGitHubAuthState,
  testGitHubConnectionFromEnv,
} from "@/lib/github-auth";
import { GitHubRequestError } from "@/lib/github";

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(headers),
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
});

describe("github auth state helpers", () => {
  it("builds missing and configured auth states", () => {
    expect(buildMissingGitHubAuthState().connectionStatus).toBe("missing");
    expect(buildConfiguredGitHubAuthState().connectionStatus).toBe("configured");
  });

  it("classifies unauthorized and rate-limited errors", () => {
    expect(buildGitHubAuthStateFromError(new GitHubRequestError(401, "Unauthorized"))).toMatchObject({
      connectionStatus: "invalid",
      hasToken: true,
    });

    expect(buildGitHubAuthStateFromError(new GitHubRequestError(403, "Forbidden", 0))).toMatchObject({
      connectionStatus: "rate-limited",
      hasToken: true,
    });
  });
});

describe("testGitHubConnectionFromEnv", () => {
  it("returns missing when GITHUB_TOKEN is not configured", async () => {
    await expect(testGitHubConnectionFromEnv()).resolves.toMatchObject({
      connectionStatus: "missing",
      hasToken: false,
    });
  });

  it("returns valid when the GitHub probe succeeds", async () => {
    process.env.GITHUB_TOKEN = "ghp_valid";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            resources: {
              core: {
                remaining: 4999,
              },
            },
          },
          { "x-ratelimit-remaining": "4999" },
        ),
      ),
    );

    await expect(testGitHubConnectionFromEnv()).resolves.toMatchObject({
      connectionStatus: "valid",
      hasToken: true,
    });
  });

  it("returns invalid when the GitHub probe is unauthorized", async () => {
    process.env.GITHUB_TOKEN = "ghp_invalid";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers({ "x-ratelimit-remaining": "10" }),
      } as Response),
    );

    await expect(testGitHubConnectionFromEnv()).resolves.toMatchObject({
      connectionStatus: "invalid",
      hasToken: true,
    });
  });
});
