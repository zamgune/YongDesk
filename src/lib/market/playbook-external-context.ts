import { getMarketDataProvider, type MarketAssetProfile } from "@/lib/market-data";
import type { LeaderMarket } from "@/lib/market/leader-universes";
import {
  type SectorStrengthItem,
  type SectorStrengthResponse,
} from "@/lib/market/sector-strength";
import type {
  BuildTradeSignalSetInput,
  TradePlaybookExternalGate,
} from "@/lib/market/trade-playbook";
import { getSectorStrength } from "@/use-cases/market/get-sector-strength";
import { scanLeaders } from "@/use-cases/market/scan-leaders";

type JsonObject = Record<string, unknown>;

type LeadershipCandidate = {
  symbol: string;
  sector: string | null;
  rank: number;
  return50: number;
  dataProvenance: string;
  latestCandleAt: string;
  dataAgeSeconds: number;
};

type LeadershipSnapshot = {
  market: LeaderMarket;
  generatedAt: string;
  strategy: {
    leaderCount: number;
    minLeaderReturn50: number | null;
  };
  marketHealth: {
    breadth: number;
    averageReturn50: number;
    pass: boolean;
    loadedSymbols: number;
    totalSymbols: number;
    timestampedSymbols: number;
    coverageType: string;
    source: string;
    latestCandleAt: string;
    oldestLatestCandleAt: string;
    maxDataAgeSeconds: number;
  };
  candidates: LeadershipCandidate[];
};

export type PlaybookExternalContextInput = {
  symbol: string;
  market: string;
  generatedAt: string;
};

export type PlaybookExternalContext = NonNullable<BuildTradeSignalSetInput["externalContext"]>;

export type ResolvePlaybookExternalContextInput = PlaybookExternalContextInput & {
  leadership: LeadershipSnapshot | null;
  sectorStrength: SectorStrengthResponse | null;
  assetProfile: MarketAssetProfile | null;
  leadershipError?: string | null;
  sectorStrengthError?: string | null;
  profileError?: string | null;
};

const LEADERSHIP_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_DAILY_SNAPSHOT_AGE_MS = 96 * 60 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const leadershipCache = new Map<LeaderMarket, {
  storedAt: number;
  snapshot: LeadershipSnapshot;
}>();
const leadershipInFlight = new Map<LeaderMarket, Promise<LeadershipSnapshot>>();

const asObject = (value: unknown): JsonObject | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;

const asText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : null;

const unavailableGate = (
  label: string,
  reason: string,
  source: string,
  asOf: string | null,
  dataAgeSeconds: number | null = null,
): TradePlaybookExternalGate => ({
  status: "unavailable",
  label,
  reason,
  source,
  asOf,
  dataAgeSeconds,
});

export const unavailablePlaybookExternalContext = (
  _generatedAt: string,
  reason: string,
): PlaybookExternalContext => ({
  market: unavailableGate(
    "시장 breadth 확인 불가",
    reason,
    "market-breadth.unavailable",
    null,
  ),
  sector: unavailableGate(
    "섹터 상대강도 확인 불가",
    reason,
    "sector-strength",
    null,
  ),
  leader50: unavailableGate(
    "50일 leader 확인 불가",
    reason,
    "market-leaders.curated-return50-rank",
    null,
  ),
});

type SnapshotFreshness = {
  usable: boolean;
  asOf: string | null;
  ageSeconds: number | null;
  reason: string;
};

const resolveSnapshotFreshness = (
  asOf: string | null,
  referenceAt: string,
): SnapshotFreshness => {
  const asOfMs = asOf ? Date.parse(asOf) : Number.NaN;
  const referenceMs = Date.parse(referenceAt);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(referenceMs)) {
    return {
      usable: false,
      asOf,
      ageSeconds: null,
      reason: "기초 시세의 기준 시각을 검증할 수 없습니다.",
    };
  }
  const ageMs = referenceMs - asOfMs;
  const ageSeconds = Math.max(0, Math.floor(ageMs / 1_000));
  if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) {
    return {
      usable: false,
      asOf,
      ageSeconds,
      reason: "기초 시세의 기준 시각이 현재 분석 시각보다 미래입니다.",
    };
  }
  if (ageMs > MAX_DAILY_SNAPSHOT_AGE_MS) {
    return {
      usable: false,
      asOf,
      ageSeconds,
      reason: `기초 일봉이 ${Math.floor(ageSeconds / 3_600)}시간 경과해 stale입니다.`,
    };
  }
  return {
    usable: true,
    asOf,
    ageSeconds,
    reason: `기초 일봉 age ${ageSeconds}초`,
  };
};

const oldestTimestamp = (values: Array<string | null | undefined>) => {
  const valid = values
    .flatMap((value) => {
      if (!value || !Number.isFinite(Date.parse(value))) return [];
      return [value];
    })
    .toSorted((left, right) => Date.parse(left) - Date.parse(right));
  return valid.at(0) ?? null;
};

const parseLeadershipSnapshot = (payload: unknown): LeadershipSnapshot | null => {
  const root = asObject(payload);
  const market = asText(root?.market);
  const generatedAt = asText(root?.generatedAt);
  const strategy = asObject(root?.strategy);
  const marketHealth = asObject(root?.marketHealth);
  const leaderCount = asNumber(strategy?.leaderCount);
  const breadth = asNumber(marketHealth?.breadth);
  const averageReturn50 = asNumber(marketHealth?.averageReturn50);
  const pass = asBoolean(marketHealth?.pass);
  const loadedSymbols = asNumber(marketHealth?.loadedSymbols);
  const totalSymbols = asNumber(marketHealth?.totalSymbols);
  const timestampedSymbols = asNumber(marketHealth?.timestampedSymbols);
  const coverageType = asText(marketHealth?.coverageType);
  const source = asText(marketHealth?.source);
  const latestCandleAt = asText(marketHealth?.latestCandleAt);
  const oldestLatestCandleAt = asText(marketHealth?.oldestLatestCandleAt);
  const maxDataAgeSeconds = asNumber(marketHealth?.maxDataAgeSeconds);
  if (
    (market !== "US" && market !== "KOSPI" && market !== "KOSDAQ") ||
    !generatedAt ||
    leaderCount === null ||
    breadth === null ||
    averageReturn50 === null ||
    pass === null ||
    loadedSymbols === null ||
    totalSymbols === null ||
    timestampedSymbols === null ||
    !coverageType ||
    !source ||
    !latestCandleAt ||
    !oldestLatestCandleAt ||
    maxDataAgeSeconds === null
  ) {
    return null;
  }
  const candidates = Array.isArray(root?.candidates)
    ? root.candidates.flatMap((value): LeadershipCandidate[] => {
        const candidate = asObject(value);
        const symbol = asText(candidate?.symbol);
        const rank = asNumber(candidate?.rank);
        const return50 = asNumber(candidate?.return50);
        const dataProvenance = asText(candidate?.dataProvenance);
        const candidateLatestCandleAt = asText(candidate?.latestCandleAt);
        const dataAgeSeconds = asNumber(candidate?.dataAgeSeconds);
        if (
          !symbol ||
          rank === null ||
          return50 === null ||
          !dataProvenance ||
          !candidateLatestCandleAt ||
          dataAgeSeconds === null
        ) return [];
        return [{
          symbol: symbol.toUpperCase(),
          sector: asText(candidate?.sector),
          rank,
          return50,
          dataProvenance,
          latestCandleAt: candidateLatestCandleAt,
          dataAgeSeconds,
        }];
      })
    : [];
  return {
    market,
    generatedAt,
    strategy: {
      leaderCount,
      minLeaderReturn50: asNumber(strategy?.minLeaderReturn50),
    },
    marketHealth: {
      breadth,
      averageReturn50,
      pass,
      loadedSymbols,
      totalSymbols,
      timestampedSymbols,
      coverageType,
      source,
      latestCandleAt,
      oldestLatestCandleAt,
      maxDataAgeSeconds,
    },
    candidates,
  };
};

const loadLeadershipSnapshot = async (market: LeaderMarket) => {
  const current = Date.now();
  const cached = leadershipCache.get(market);
  if (cached && current - cached.storedAt < LEADERSHIP_CACHE_TTL_MS) {
    return cached.snapshot;
  }
  const pending = leadershipInFlight.get(market);
  if (pending) return pending;

  const request = new Request(
    `http://stockanalysis.internal/api/market/leaders?market=${market}&days=430`,
  );
  const promise = scanLeaders(request)
    .then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(asText(asObject(payload)?.error) ?? `leader scan HTTP ${response.status}`);
      }
      const snapshot = parseLeadershipSnapshot(payload);
      if (!snapshot) throw new Error("leader scan 응답 계약이 유효하지 않습니다.");
      leadershipCache.set(market, { storedAt: current, snapshot });
      return snapshot;
    })
    .finally(() => {
      leadershipInFlight.delete(market);
    });
  leadershipInFlight.set(market, promise);
  return promise;
};

const normalizeSymbol = (symbol: string, market: LeaderMarket) => {
  const normalized = symbol.trim().toUpperCase();
  if (market === "US") return normalized.replace(/\.(KS|KQ)$/i, "");
  if (/\.(KS|KQ)$/i.test(normalized)) return normalized;
  return `${normalized}.${market === "KOSPI" ? "KS" : "KQ"}`;
};

const US_PROFILE_TO_SECTOR_ID: Record<string, string> = {
  "communication services": "communication-services",
  "consumer cyclical": "consumer-discretionary",
  "consumer defensive": "consumer-staples",
  energy: "energy",
  "financial services": "financials",
  healthcare: "health-care",
  industrials: "industrials",
  "basic materials": "materials",
  "real estate": "real-estate",
  technology: "technology",
  utilities: "utilities",
};

const KR_CURATED_SECTOR_RULES: Array<[RegExp, string]> = [
  [/반도체/, "semiconductor"],
  [/자동차/, "auto"],
  [/은행|금융/, "bank"],
  [/증권/, "securities"],
  [/바이오|헬스케어/, "health-care"],
  [/보험/, "insurance"],
  [/건설/, "construction"],
  [/철강/, "steel"],
  [/기계/, "machinery"],
  [/운송/, "transportation"],
  [/필수소비재/, "consumer-staples"],
  [/경기소비재/, "consumer-discretionary"],
  [/부동산|리츠/, "real-estate"],
];

const KR_PROFILE_RULES: Array<[RegExp, string]> = [
  [/semiconductor/i, "semiconductor"],
  [/auto manufacturers?|auto parts/i, "auto"],
  [/banks?/i, "bank"],
  [/capital markets?/i, "securities"],
  [/biotechnology|drug manufacturers?|healthcare/i, "health-care"],
  [/insurance/i, "insurance"],
  [/steel/i, "steel"],
  [/real estate/i, "real-estate"],
];

const resolveSectorId = ({
  market,
  curatedSector,
  assetProfile,
}: {
  market: LeaderMarket;
  curatedSector: string | null;
  assetProfile: MarketAssetProfile | null;
}) => {
  if (market === "US") {
    const profileSector = assetProfile?.sector?.trim().toLowerCase();
    return profileSector ? US_PROFILE_TO_SECTOR_ID[profileSector] ?? null : null;
  }
  const curatedMatch = curatedSector
    ? KR_CURATED_SECTOR_RULES.find(([pattern]) => pattern.test(curatedSector))
    : null;
  if (curatedMatch) return curatedMatch[1];
  const profileText = [assetProfile?.sector, assetProfile?.industry].filter(Boolean).join(" ");
  return KR_PROFILE_RULES.find(([pattern]) => pattern.test(profileText))?.[1] ?? null;
};

const relativeStrengthValue = (sector: SectorStrengthItem) => {
  const periods = [
    ["1개월", sector.excessReturns.oneMonth],
    ["1주", sector.excessReturns.oneWeek],
    ["1일", sector.excessReturns.oneDay],
  ] as const;
  return periods.find(([, value]) => typeof value === "number" && Number.isFinite(value)) ?? null;
};

export const resolvePlaybookExternalContext = ({
  symbol,
  market,
  generatedAt,
  leadership,
  sectorStrength,
  assetProfile,
  leadershipError,
  sectorStrengthError,
  profileError,
}: ResolvePlaybookExternalContextInput): PlaybookExternalContext => {
  const leaderMarket = market === "US" || market === "KOSPI" || market === "KOSDAQ"
    ? market
    : null;
  if (!leaderMarket) {
    return unavailablePlaybookExternalContext(
      generatedAt,
      "한국·미국 주식 시장으로 식별되지 않아 외부 게이트를 계산할 수 없습니다.",
    );
  }
  const normalizedSymbol = normalizeSymbol(symbol, leaderMarket);
  const candidate = leadership?.candidates.find((item) => item.symbol === normalizedSymbol) ?? null;
  const coverage = leadership && leadership.marketHealth.totalSymbols > 0
    ? leadership.marketHealth.loadedSymbols / leadership.marketHealth.totalSymbols
    : 0;
  const leadershipFreshness = resolveSnapshotFreshness(
    leadership?.marketHealth.oldestLatestCandleAt ?? null,
    generatedAt,
  );
  const leadershipUsable = leadership !== null &&
    leadership.market === leaderMarket &&
    leadership.marketHealth.coverageType === "curated-leader-universe" &&
    leadership.marketHealth.source === "leader-universes.static-curated" &&
    leadership.marketHealth.loadedSymbols >= 10 &&
    coverage >= 0.7 &&
    leadership.marketHealth.timestampedSymbols === leadership.marketHealth.loadedSymbols &&
    leadershipFreshness.usable;
  const marketGate = unavailableGate(
    "실제 시장 breadth 확인 불가",
    leadershipError ?? (leadership
      ? `선별된 leader 후보 ${leadership.marketHealth.loadedSymbols}/${leadership.marketHealth.totalSymbols}개의 50일선 상회 비율 ${(leadership.marketHealth.breadth * 100).toFixed(1)}%는 선택편향 때문에 실제 시장 breadth로 사용할 수 없습니다. 대표성 있는 point-in-time 전체 종목 coverage/provenance 소스가 연결되지 않았습니다.${leadershipFreshness.usable ? "" : ` ${leadershipFreshness.reason}`}`
      : "대표성 있는 point-in-time 전체 종목 breadth snapshot이 연결되지 않았습니다."),
    "market-breadth.unavailable",
    leadershipFreshness.asOf,
    leadershipFreshness.ageSeconds,
  );

  const candidateFreshness = resolveSnapshotFreshness(
    candidate?.latestCandleAt ?? null,
    generatedAt,
  );
  const leader50 = leadershipUsable &&
    candidate &&
    candidate.dataProvenance === "market-data.confirmed-daily-candles" &&
    candidateFreshness.usable
    ? {
        status: candidate.rank <= leadership.strategy.leaderCount &&
          (leadership.strategy.minLeaderReturn50 === null ||
            candidate.return50 >= leadership.strategy.minLeaderReturn50)
          ? "pass" as const
          : "weak" as const,
        label: `curated 50일 leader ${candidate.rank}위`,
        reason: `${normalizedSymbol}의 50일 수익률은 ${(candidate.return50 * 100).toFixed(1)}%이며 선별된 ${leadership.marketHealth.loadedSymbols}개 후보 안에서 ${candidate.rank}위입니다. 전체 시장 순위가 아닙니다.`,
        source: "market-leaders.curated-return50-rank",
        asOf: leadershipFreshness.asOf ?? candidate.latestCandleAt,
        dataAgeSeconds: leadershipFreshness.ageSeconds,
      }
    : unavailableGate(
        "50일 leader 확인 불가",
        leadershipError ?? (!leadership
          ? "curated leader snapshot이 연결되지 않았습니다."
          : !leadershipUsable
            ? `curated leader snapshot의 provenance, coverage 또는 freshness가 유효하지 않습니다. ${leadershipFreshness.reason}`
            : !candidate
              ? `${normalizedSymbol}은 선별된 leader 후보 목록에 없어 상대 순위를 확인할 수 없습니다.`
              : candidate.dataProvenance !== "market-data.confirmed-daily-candles"
                ? "leader 후보의 기초 시세 provenance를 확인할 수 없습니다."
                : candidateFreshness.reason),
        "market-leaders.curated-return50-rank",
        leadershipFreshness.asOf ?? candidateFreshness.asOf,
        leadershipFreshness.ageSeconds ?? candidateFreshness.ageSeconds,
      );

  const strengthMarket = leaderMarket === "US" ? "US" : "KR";
  const sectorId = resolveSectorId({
    market: leaderMarket,
    curatedSector: candidate?.sector ?? null,
    assetProfile,
  });
  const sector = sectorId
    ? sectorStrength?.sectors.find((item) => item.id === sectorId) ?? null
    : null;
  const relativeStrength = sector ? relativeStrengthValue(sector) : null;
  const relativePeriod = relativeStrength?.[0] ?? null;
  const relativeReturn = relativeStrength?.[1] ?? null;
  const sectorCandleAsOf = oldestTimestamp([
    sectorStrength?.benchmark.candleAsOf,
    sector?.candleAsOf,
  ]);
  const sectorFreshness = resolveSnapshotFreshness(sectorCandleAsOf, generatedAt);
  const sectorSnapshotUsable = sectorStrength !== null &&
    sectorStrength.market === strengthMarket &&
    sectorStrength.dataProvenance === "confirmed-daily-candles" &&
    !sectorStrength.stale &&
    sectorStrength.benchmark.candleAsOf !== null &&
    sector !== null &&
    sector.candleAsOf !== null &&
    sectorFreshness.usable;
  const sectorUnavailableReason = sectorStrengthError ?? profileError ?? (() => {
    if (!sectorId) {
      return `${normalizedSymbol}의 종목-섹터 ETF 매핑을 확인할 수 없습니다.`;
    }
    if (!sectorStrength || sectorStrength.market !== strengthMarket) {
      return "섹터 상대강도 snapshot이 없거나 시장이 일치하지 않습니다.";
    }
    if (sectorStrength.dataProvenance !== "confirmed-daily-candles") {
      return "섹터 상대강도의 기초 시세 provenance를 확인할 수 없습니다.";
    }
    if (sectorStrength.stale) {
      return "섹터 상대강도 snapshot refresh가 실패해 stale입니다.";
    }
    if (!sectorSnapshotUsable) return sectorFreshness.reason;
    return `${sectorId} ETF의 벤치마크 대비 확정 수익률이 없습니다.`;
  })();
  const sectorGate = sectorSnapshotUsable && sector && relativePeriod && relativeReturn !== null
    ? {
        status: relativeReturn > 0 ? "pass" as const : "weak" as const,
        label: `${sector.name} 상대강도 ${relativePeriod}`,
        reason: `${sector.symbol}의 벤치마크 대비 ${relativePeriod} 초과수익률은 ${(relativeReturn * 100).toFixed(2)}%p입니다. 확정 일봉 기준 시각과 age를 검증했습니다.`,
        source: `sector-strength.${strengthMarket}.${sector.symbol}`,
        asOf: sectorFreshness.asOf ?? generatedAt,
        dataAgeSeconds: sectorFreshness.ageSeconds,
      }
    : unavailableGate(
        "섹터 상대강도 확인 불가",
        sectorUnavailableReason,
        sectorId ? `sector-strength.${strengthMarket}.${sectorId}` : "sector-strength.mapping",
        sectorFreshness.asOf ?? sectorStrength?.candleAsOf ?? null,
        sectorFreshness.ageSeconds,
      );

  return { market: marketGate, sector: sectorGate, leader50 };
};

export const loadPlaybookExternalContext = async (
  input: PlaybookExternalContextInput,
): Promise<PlaybookExternalContext> => {
  const leaderMarket = input.market === "US" || input.market === "KOSPI" || input.market === "KOSDAQ"
    ? input.market
    : null;
  if (!leaderMarket) {
    return unavailablePlaybookExternalContext(
      input.generatedAt,
      "지원되는 주식 시장으로 식별되지 않았습니다.",
    );
  }
  const strengthMarket = leaderMarket === "US" ? "US" : "KR";
  const marketData = getMarketDataProvider();
  const [leadershipResult, sectorResult, profileResult] = await Promise.allSettled([
    loadLeadershipSnapshot(leaderMarket),
    getSectorStrength(strengthMarket),
    marketData.getAssetProfile(input.symbol),
  ]);
  return resolvePlaybookExternalContext({
    ...input,
    leadership: leadershipResult.status === "fulfilled" ? leadershipResult.value : null,
    sectorStrength: sectorResult.status === "fulfilled" ? sectorResult.value : null,
    assetProfile: profileResult.status === "fulfilled" ? profileResult.value : null,
    leadershipError: leadershipResult.status === "rejected"
      ? `leader scan 실패: ${leadershipResult.reason instanceof Error ? leadershipResult.reason.message : String(leadershipResult.reason)}`
      : null,
    sectorStrengthError: sectorResult.status === "rejected"
      ? `섹터 상대강도 조회 실패: ${sectorResult.reason instanceof Error ? sectorResult.reason.message : String(sectorResult.reason)}`
      : null,
    profileError: profileResult.status === "rejected"
      ? `종목 섹터 조회 실패: ${profileResult.reason instanceof Error ? profileResult.reason.message : String(profileResult.reason)}`
      : null,
  });
};
