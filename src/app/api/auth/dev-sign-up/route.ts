import { NextResponse } from "next/server";

import {
  DEV_AUTH_COOKIE,
  createDevAuthSession,
  getDevAuthCookieOptions,
} from "@/lib/auth/dev-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminConfig, isSupabaseConfigured } from "@/lib/supabase/config";
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
  if (!email || password.length < 8) {
    return Response.json({ error: "이메일과 8자 이상 비밀번호가 필요합니다." }, { status: 400 });
  }

  if (isSupabaseConfigured()) {
    try {
      if (getSupabaseAdminConfig()) {
        const admin = createSupabaseAdminClient();
        const { error: createError } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (createError && !/already|registered|exists/i.test(createError.message)) {
          return Response.json({ error: createError.message }, { status: 400 });
        }
      }

      const supabase = await createSupabaseServerClient();
      const { data, error } = getSupabaseAdminConfig()
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (error) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      return Response.json({
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
        requiresEmailConfirmation: !data.session,
        provider: "supabase",
      });
    } catch {
      return Response.json({ error: "회원가입 처리 중 인증 서버에 연결하지 못했습니다." }, { status: 502 });
    }
  }

  if (process.env.NODE_ENV === "production") {
    return supabaseRequired();
  }

  const result = await createDevAuthSession({ email, password }).catch(() => null);
  if (!result) {
    return devAuthUnavailable();
  }
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  const response = NextResponse.json({
    user: result.user,
    requiresEmailConfirmation: false,
    provider: "development",
  });
  response.cookies.set(DEV_AUTH_COOKIE, result.token, getDevAuthCookieOptions(result.expiresAt));
  return response;
}
