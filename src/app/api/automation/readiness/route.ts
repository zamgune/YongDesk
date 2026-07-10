import { getAutomationReadinessSnapshot } from "@/lib/automation/readiness";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

export async function GET(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }

  const readiness = await getAutomationReadinessSnapshot(auth.userContext.userId, {
    includeOperator: auth.userContext.roles.includes("admin"),
  });
  return Response.json(readiness);
}
