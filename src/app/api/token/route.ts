import { cookies } from "next/headers";
import { NextResponse } from "next/server";

async function validateToken(token: string) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "zephyr-team-activity-dashboard",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      ok: false,
      message: `GitHub rejected the token (${response.status} ${response.statusText}).`,
    };
  }

  const user = (await response.json()) as { login?: string };
  return {
    ok: true,
    message: `GitHub token saved for ${user.login ?? "authenticated user"}.`,
  };
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const token = String(formData.get("token") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "/");
  const action = String(formData.get("action") ?? "save");
  const cookieStore = await cookies();

  if (action === "clear" || !token) {
    cookieStore.delete("github_token");
    cookieStore.set("auth_notice", JSON.stringify({ level: "info", message: "GitHub token cleared. Dashboard will use env token or demo mode." }), {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 60,
    });
  } else {
    const validation = await validateToken(token);

    if (validation.ok) {
      cookieStore.set("github_token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      cookieStore.set("auth_notice", JSON.stringify({ level: "info", message: validation.message }), {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 60,
      });
    } else {
      cookieStore.delete("github_token");
      cookieStore.set("auth_notice", JSON.stringify({ level: "error", message: validation.message }), {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 60,
      });
    }
  }

  return NextResponse.redirect(new URL(returnTo, request.url), { status: 303 });
}
