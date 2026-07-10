import {
  getPaperTradingStorageRootForUser,
  readPaperTradingState,
} from "@/lib/paper-trading/state-store";
import { requireRequestUserContext } from "@/use-cases/security/request-context";

export async function GET(request: Request) {
  const auth = await requireRequestUserContext(request);
  if (auth instanceof Response) {
    return auth;
  }

  const { state, repaired } = await readPaperTradingState(
    getPaperTradingStorageRootForUser(auth.userContext.userId),
  );
  return Response.json({ state, repaired });
}
