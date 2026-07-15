import { analyzeSymbol } from "@/use-cases/market/analyze-symbol";
import { getRequestUserContext } from "@/use-cases/security/request-context";

export async function GET(
  request: Request,
  context?: { params?: { symbol?: string } | Promise<{ symbol?: string }> },
) {
  try {
    return await analyzeSymbol(request, context, {
      userContext: getRequestUserContext(request),
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
      isBrokerStopEligible: false,
      orderSubmissionAttempted: false,
    }, { status: 500 });
  }
}
