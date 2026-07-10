import {
  getPaperTradingStorageRootForUser,
  resetPaperTradingState,
} from "@/lib/paper-trading/state-store";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

export async function POST(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }

  const { state } = await resetPaperTradingState(
    getPaperTradingStorageRootForUser(auth.userContext.userId),
  );
  return Response.json({ state });
}
