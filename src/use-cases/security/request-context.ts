import { anonymousUserContext, type UserContext, type UserRole } from "@/domain/user";
import { DEV_AUTH_COOKIE, getDevSessionUserByToken } from "@/lib/auth/dev-session";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function getRequestUserContext(_request: Request): UserContext {
  void _request;
  return anonymousUserContext;
}

export type AuthenticatedRequestContext = {
  userContext: UserContext & { userId: string; authenticated: true };
};

const unauthorized = (message = "로그인이 필요합니다.") =>
  Response.json({ error: message }, { status: 401 });

const toRoles = (claims: Record<string, unknown>): UserRole[] => {
  const appMetadata = claims.app_metadata;
  if (
    typeof appMetadata === "object" &&
    appMetadata !== null &&
    "roles" in appMetadata &&
    Array.isArray((appMetadata as { roles?: unknown }).roles)
  ) {
    const roles = (appMetadata as { roles: unknown[] }).roles
      .filter((role): role is UserRole => role === "admin" || role === "member");
    return roles.length ? roles : ["member"];
  }
  return ["member"];
};

export async function requireRequestUserContext(
  request: Request,
): Promise<AuthenticatedRequestContext | Response> {
  if (!isSupabaseConfigured()) {
    const token = request.headers
      .get("cookie")
      ?.split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${DEV_AUTH_COOKIE}=`))
      ?.slice(DEV_AUTH_COOKIE.length + 1);
    const user = await getDevSessionUserByToken(token ? decodeURIComponent(token) : null);
    if (!user) {
      return unauthorized();
    }
    return {
      userContext: {
        userId: user.id,
        authenticated: true,
        roles: ["member"],
        permissions: [],
      },
    };
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string" || !userId) {
    return unauthorized();
  }

  return {
    userContext: {
      userId,
      authenticated: true,
      roles: toRoles(data.claims),
      permissions: [],
    },
  };
}
