import { NextResponse } from "next/server";

import { testGitHubConnectionFromEnv } from "@/lib/github-auth";

export async function GET() {
  const auth = await testGitHubConnectionFromEnv();

  return NextResponse.json(auth, {
    status: auth.connectionStatus === "valid" ? 200 : auth.connectionStatus === "missing" ? 400 : 502,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
