import { getAutomationHealthSnapshot } from "@/lib/automation/readiness";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

export async function GET(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }
  if (!auth.userContext.roles.includes("admin")) {
    return Response.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const health = await getAutomationHealthSnapshot();
  return Response.json(health, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
