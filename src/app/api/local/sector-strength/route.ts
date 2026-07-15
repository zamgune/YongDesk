import { getSectorStrength } from "@/use-cases/market/get-sector-strength";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const market = url.searchParams.get("market")?.toUpperCase();
  if (market !== "US" && market !== "KR") {
    return Response.json({ error: "market은 US 또는 KR이어야 합니다." }, { status: 400 });
  }
  try {
    return Response.json(await getSectorStrength(market, url.searchParams.get("refresh") === "1"));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "섹터 강도를 불러오지 못했습니다." },
      { status: 502 },
    );
  }
}
