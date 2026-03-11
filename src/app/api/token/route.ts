import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { sanitizeDashboardReturnTo } from "@/lib/dashboard-links";

export async function POST(request: Request) {
  const formData = await request.formData();
  const token = String(formData.get("token") ?? "").trim();
  const returnTo = sanitizeDashboardReturnTo(String(formData.get("returnTo") ?? "/issues"));
  const action = String(formData.get("action") ?? "save");
  const cookieStore = await cookies();

  if (action === "clear" || !token) {
    cookieStore.delete("github_token");
  } else {
    cookieStore.set("github_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return NextResponse.redirect(new URL(returnTo, request.url), { status: 303 });
}
