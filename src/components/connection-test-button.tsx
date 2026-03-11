"use client";

import { useState } from "react";

import type { DashboardAuth } from "@/lib/types";

type ConnectionTestState = Pick<DashboardAuth, "connectionStatus" | "message" | "checkedAt">;

function getStatusLabel(status: ConnectionTestState["connectionStatus"]) {
  switch (status) {
    case "missing":
      return "Missing";
    case "configured":
      return "Configured";
    case "valid":
      return "Connected";
    case "invalid":
      return "Invalid";
    case "rate-limited":
      return "Rate limited";
    case "error":
      return "Connection error";
  }
}

export function ConnectionTestButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ConnectionTestState | null>(null);

  async function handleClick() {
    setIsLoading(true);

    try {
      const response = await fetch("/api/github-auth/test", {
        cache: "no-store",
      });
      const payload = (await response.json()) as ConnectionTestState;
      setResult(payload);
    } catch {
      setResult({
        connectionStatus: "error",
        message: "Connection test failed in the browser. Try refreshing the page.",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="connection-test">
      <button type="button" className="ghost-button" onClick={handleClick} disabled={isLoading}>
        {isLoading ? "Testing..." : "Test connection"}
      </button>
      <p className="token-copy connection-test-copy">
        {result ? (
          <>
            <strong>{getStatusLabel(result.connectionStatus)}.</strong> {result.message}
          </>
        ) : (
          "Uses GITHUB_TOKEN from .env.local. Restart the dev server after changing the token."
        )}
      </p>
    </div>
  );
}
