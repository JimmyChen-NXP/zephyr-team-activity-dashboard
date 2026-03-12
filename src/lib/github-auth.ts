import { GitHubRequestError, probeGitHubConnection } from "@/lib/github";
import type { DashboardAuth } from "@/lib/types";

import fs from "node:fs";
import path from "node:path";

function sanitizeGitHubEnvToken(raw: string): string {
  let token = raw.trim();

  token = token.replace(/[\r\n]/g, "");

  if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) {
    token = token.slice(1, -1).trim();
  }

  token = token.replace(/^(bearer|token)\s+/i, "");

  return token;
}

let cachedEnvLocalToken: string | null | undefined;

function readGitHubTokenFromEnvLocal(): string | null {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    cachedEnvLocalToken = null;
    return cachedEnvLocalToken;
  }

  if (cachedEnvLocalToken !== undefined) {
    return cachedEnvLocalToken;
  }

  try {
    const envPath = path.join(process.cwd(), ".env.local");
    const content = fs.readFileSync(envPath, "utf8");
    const match = content.match(/^\s*GITHUB_TOKEN\s*=\s*(.+)\s*$/m);
    const token = match ? sanitizeGitHubEnvToken(match[1]) : "";
    cachedEnvLocalToken = token ? token : null;
    return cachedEnvLocalToken;
  } catch {
    cachedEnvLocalToken = null;
    return cachedEnvLocalToken;
  }
}

export function getGitHubEnvToken() {
  return readGitHubTokenFromEnvLocal() ?? sanitizeGitHubEnvToken(process.env.GITHUB_TOKEN ?? "");
}

export function buildMissingGitHubAuthState(): DashboardAuth {
  return {
    hasToken: false,
    connectionStatus: "missing",
    message: "Set GITHUB_TOKEN in .env.local and restart the dev server to enable live GitHub sync.",
    checkedAt: null,
  };
}

export function buildConfiguredGitHubAuthState(message = "Token loaded from environment. Run Test connection to verify GitHub access."): DashboardAuth {
  return {
    hasToken: true,
    connectionStatus: "configured",
    message,
    checkedAt: null,
  };
}

export function buildRateLimitedGitHubAuthState(message = "GitHub rate limit reached. Wait for reset or use cached data.", checkedAt = new Date().toISOString()): DashboardAuth {
  return {
    hasToken: true,
    connectionStatus: "rate-limited",
    message,
    checkedAt,
  };
}

type ValidAuthOptions = {
  checkedAt?: string | null;
  rateLimitRemaining?: number | null;
  message?: string;
};

export function buildValidGitHubAuthState(options: ValidAuthOptions = {}): DashboardAuth {
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const remainingText = typeof options.rateLimitRemaining === "number" ? ` ${options.rateLimitRemaining} requests remaining in the current window.` : "";

  return {
    hasToken: true,
    connectionStatus: "valid",
    message: options.message ?? `Connected to GitHub.${remainingText}`.trim(),
    checkedAt,
  };
}

export function buildGitHubAuthStateFromError(error: unknown, checkedAt = new Date().toISOString()): DashboardAuth {
  if (error instanceof GitHubRequestError) {
    if (error.status === 401) {
      return {
        hasToken: true,
        connectionStatus: "invalid",
        message: "GitHub rejected GITHUB_TOKEN. Ensure .env.local contains the raw token value (no 'Bearer ' prefix) and restart the dev server.",
        checkedAt,
      };
    }

    if (error.status === 403 && error.rateLimitRemaining === 0) {
      return buildRateLimitedGitHubAuthState("GitHub rate limit reached. Wait for reset or use cached data.", checkedAt);
    }
  }

  return {
    hasToken: true,
    connectionStatus: "error",
    message: error instanceof Error ? error.message : "GitHub connection test failed.",
    checkedAt,
  };
}

export async function testGitHubConnectionFromEnv(): Promise<DashboardAuth> {
  const token = getGitHubEnvToken();
  if (!token) {
    return buildMissingGitHubAuthState();
  }

  try {
    const probe = await probeGitHubConnection(token);
    return buildValidGitHubAuthState({
      checkedAt: probe.checkedAt,
      rateLimitRemaining: probe.rateLimitRemaining,
      message: probe.rateLimitRemaining === null ? "Connected to GitHub." : `Connected to GitHub. ${probe.rateLimitRemaining} requests remaining in the current window.`,
    });
  } catch (error) {
    return buildGitHubAuthStateFromError(error);
  }
}
