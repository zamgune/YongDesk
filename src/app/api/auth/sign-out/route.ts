import { NextResponse } from "next/server";

import { DEV_AUTH_COOKIE, deleteDevSession } from "@/lib/auth/dev-session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    return Response.json({ ok: true });
  }

  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${DEV_AUTH_COOKIE}=`))
    ?.slice(DEV_AUTH_COOKIE.length + 1);
  await deleteDevSession(token ? decodeURIComponent(token) : null);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DEV_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
  return response;
}
