import { analyzeSymbol } from "@/use-cases/market/analyze-symbol";
import { getRequestUserContext } from "@/use-cases/security/request-context";

export async function GET(
  request: Request,
  context?: { params?: { symbol?: string } | Promise<{ symbol?: string }> },
) {
  return analyzeSymbol(request, context, {
    userContext: getRequestUserContext(request),
  });
}
