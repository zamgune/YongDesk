import { scanLeaders } from "@/use-cases/market/scan-leaders";
import { getRequestUserContext } from "@/use-cases/security/request-context";

export async function GET(request: Request) {
  return scanLeaders(request, {
    userContext: getRequestUserContext(request),
  });
}
