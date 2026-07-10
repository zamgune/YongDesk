import { countActiveFeatureUsers, grantAutomationFeature, hasAutomationFeature } from "@/lib/automation/store";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

type RedeemPayload = {
  code?: unknown;
};

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "beta-redeem", { limit: 10, windowMs: 60_000 });
  if (limited) {
    return limited;
  }

  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }

  const payload = (await request.json().catch(() => ({}))) as RedeemPayload;
  const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
  const inviteCode = process.env.AUTOMATION_BETA_INVITE_CODE?.trim().toUpperCase();
  if (!inviteCode) {
    return Response.json({ error: "베타 초대 코드가 서버에 설정되어 있지 않습니다." }, { status: 503 });
  }
  if (code !== inviteCode) {
    return Response.json({ error: "코드가 유효하지 않거나 만료되었습니다." }, { status: 400 });
  }

  const automationBeta = await hasAutomationFeature(auth.userContext.userId, "automation_beta").catch(() => null);
  if (automationBeta === null) {
    return Response.json({ error: "자동매매 권한 저장소를 확인할 수 없습니다." }, { status: 503 });
  }
  if (automationBeta) {
    return Response.json({ ok: true, features: ["automation_beta"] });
  }

  const maxUsers = Number(process.env.AUTOMATION_BETA_MAX_USERS ?? 5);
  const activeUsers = await countActiveFeatureUsers("automation_beta").catch(() => null);
  if (activeUsers === null) {
    return Response.json({ error: "자동매매 권한 저장소를 확인할 수 없습니다." }, { status: 503 });
  }
  if (Number.isFinite(maxUsers) && maxUsers > 0 && activeUsers >= maxUsers) {
    return Response.json({ error: "베타 코드 사용 가능 인원이 마감되었습니다." }, { status: 403 });
  }

  await grantAutomationFeature(auth.userContext.userId, "automation_beta").catch(() => null);
  if (!(await hasAutomationFeature(auth.userContext.userId, "automation_beta").catch(() => false))) {
    return Response.json({ error: "자동매매 권한 저장소에 베타 권한을 저장하지 못했습니다." }, { status: 503 });
  }
  return Response.json({
    ok: true,
    features: ["automation_beta"],
  });
}
