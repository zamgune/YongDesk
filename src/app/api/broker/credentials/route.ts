import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireRequestUserContext } from "@/use-cases/security/request-context";
import { grantAutomationFeature, revokeAutomationFeature } from "@/lib/automation/store";
import { isCredentialEncryptionConfigured } from "@/lib/security/crypto";
import {
  deleteBrokerCredentials,
  getBrokerCredentialView,
  saveBrokerCredentials,
} from "@/lib/broker/credential-store";
import { createTossClient, formatTossApiError, TossApiError } from "@/lib/toss/client";

type RegisterPayload = {
  clientId?: unknown;
  clientSecret?: unknown;
};

export async function GET(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  const view = await getBrokerCredentialView(auth.userContext.userId, "toss");
  return Response.json({ credential: view });
}

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "broker-credentials-register", {
    limit: 5,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  if (!isCredentialEncryptionConfigured()) {
    return Response.json(
      { error: "서버 암호화 키(BROKER_CREDENTIAL_ENC_KEY)가 설정되지 않았습니다." },
      { status: 503 },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as RegisterPayload;
  const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";
  const clientSecret = typeof payload.clientSecret === "string" ? payload.clientSecret.trim() : "";
  if (!clientId || !clientSecret) {
    return Response.json({ error: "clientId, clientSecret가 필요합니다." }, { status: 400 });
  }

  const userId = auth.userContext.userId;
  try {
    const client = createTossClient({ clientId, clientSecret });
    await client.verifyToken();
    const accounts = await client.listAccounts();
    const view = await saveBrokerCredentials({ userId, clientId, clientSecret, status: "verified" });
    await grantAutomationFeature(userId, "broker_credentials");
    return Response.json({
      credential: view,
      accounts: accounts.map((a) => ({
        accountNo: a.accountNo,
        accountSeq: a.accountSeq,
        accountType: a.accountType,
      })),
    });
  } catch (error) {
    if (error instanceof TossApiError) {
      return Response.json(
        formatTossApiError(error, "토스 검증 실패"),
        { status: error.status === 401 ? 401 : 400 },
      );
    }
    return Response.json({ error: "토스 자격증명 검증 중 오류가 발생했습니다." }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  await deleteBrokerCredentials(auth.userContext.userId, "toss");
  await Promise.all([
    revokeAutomationFeature(auth.userContext.userId, "broker_credentials"),
    revokeAutomationFeature(auth.userContext.userId, "live_trading"),
  ]);
  return Response.json({ ok: true });
}
