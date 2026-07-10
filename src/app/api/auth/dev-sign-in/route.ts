import { NextResponse } from "next/server";

import {
  DEV_AUTH_COOKIE,
  getDevAuthCookieOptions,
  signInDevAuthSession,
} from "@/lib/auth/dev-session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AuthPayload = {
  email?: unknown;
  password?: unknown;
};

const readAuthPayload = async (request: Request) => {
  const payload = (await request.json().catch(() => ({}))) as AuthPayload;
  return {
    email: typeof payload.email === "string" ? payload.email.trim() : "",
    password: typeof payload.password === "string" ? payload.password : "",
  };
};

const supabaseRequired = () =>
  Response.json(
    {
      error: "배포 환경에 Supabase 인증 환경 변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)가 설정되지 않았습니다.",
    },
    { status: 503 },
  );

const devAuthUnavailable = () =>
  Response.json({ error: "개발용 인증 저장소를 사용할 수 없습니다." }, { status: 500 });

export async function POST(request: Request) {
  const { email, password } = await readAuthPayload(request);
  if (!email || !password) {
    return Response.json({ error: "이메일과 비밀번호가 필요합니다." }, { status: 400 });
  }

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        return Response.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
      }
      return Response.json({
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
        provider: "supabase",
      });
    } catch {
      return Response.json({ error: "로그인 처리 중 인증 서버에 연결하지 못했습니다." }, { status: 502 });
    }
  }

  if (process.env.NODE_ENV === "production") {
    return supabaseRequired();
  }

  const result = await signInDevAuthSession({ email, password }).catch(() => null);
  if (!result) {
    return devAuthUnavailable();
  }
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 401 });
  }

  const response = NextResponse.json({
    user: result.user,
    provider: "development",
  });
  response.cookies.set(DEV_AUTH_COOKIE, result.token, getDevAuthCookieOptions(result.expiresAt));
  return response;
}
