import { DEV_AUTH_COOKIE, getDevSessionUserByToken } from "@/lib/auth/dev-session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return Response.json({ user: null, provider: "supabase" });
    }
    return Response.json({
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      provider: "supabase",
    });
  }

  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${DEV_AUTH_COOKIE}=`))
    ?.slice(DEV_AUTH_COOKIE.length + 1);
  const user = await getDevSessionUserByToken(token ? decodeURIComponent(token) : null);
  return Response.json({
    user,
    provider: "development",
  });
}
