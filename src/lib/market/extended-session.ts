import type { MarketExtendedQuote } from "@/lib/market-data";
import type { BreakoutRule } from "@/lib/market/breakout-rule";

export type UsExtendedSessionName = "pre-market" | "regular" | "after-hours" | "closed";
export type ExtendedSessionSignal = "strong" | "watch" | "thin-volume" | "risk-off" | "none";

export type ExtendedSessionMover = {
  symbol: string;
  name: string;
  price: number;
  referenceClose: number;
  changeFromRegularClosePct: number;
  signal: ExtendedSessionSignal;
  decision: "enter" | "hold" | "watch" | "avoid";
  breakoutStatus?: BreakoutRule["status"];
  reason: string;
};

export type ExtendedSessionReport = {
  available: boolean;
  session: UsExtendedSessionName;
  sessionLabel: string;
  asOf: string;
  referenceClose: number | null;
  summary: string;
  warnings: string[];
  topMovers: ExtendedSessionMover[];
};

type TimeZoneParts = {
  hour: number;
  minute: number;
  weekday: string;
};

type ExtendedCandidate = {
  symbol: string;
  name: string;
  decision: ExtendedSessionMover["decision"];
  breakoutRule?: BreakoutRule;
};

const getNewYorkParts = (date: Date): TimeZoneParts => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
};

const toMinuteOfDay = (parts: Pick<TimeZoneParts, "hour" | "minute">) =>
  parts.hour * 60 + parts.minute;

const isWeekday = (weekday: string) => weekday !== "Sat" && weekday !== "Sun";

export const getUsExtendedSession = (now = new Date()): UsExtendedSessionName => {
  const parts = getNewYorkParts(now);
  if (!isWeekday(parts.weekday)) {
    return "closed";
  }

  const minute = toMinuteOfDay(parts);
  if (minute >= 4 * 60 && minute < 9 * 60 + 30) {
    return "pre-market";
  }
  if (minute >= 9 * 60 + 30 && minute < 16 * 60) {
    return "regular";
  }
  if (minute >= 16 * 60 && minute < 20 * 60) {
    return "after-hours";
  }
  return "closed";
};

export const getExtendedSessionLabel = (session: UsExtendedSessionName) => {
  switch (session) {
    case "pre-market":
      return "프리마켓";
    case "regular":
      return "정규장";
    case "after-hours":
      return "애프터마켓";
    case "closed":
      return "장외 종료";
  }
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const getReferenceClose = (quote: MarketExtendedQuote) =>
  isNumber(quote.regularMarketPrice)
    ? quote.regularMarketPrice
    : isNumber(quote.regularMarketPreviousClose)
      ? quote.regularMarketPreviousClose
      : null;

const getSessionPrice = (quote: MarketExtendedQuote, session: UsExtendedSessionName) => {
  if (session === "pre-market") {
    return isNumber(quote.preMarketPrice) ? quote.preMarketPrice : null;
  }
  if (session === "after-hours") {
    return isNumber(quote.postMarketPrice) ? quote.postMarketPrice : null;
  }
  return null;
};

const getSessionChangePercent = (quote: MarketExtendedQuote, session: UsExtendedSessionName) => {
  if (session === "pre-market" && isNumber(quote.preMarketChangePercent)) {
    return quote.preMarketChangePercent / 100;
  }
  if (session === "after-hours" && isNumber(quote.postMarketChangePercent)) {
    return quote.postMarketChangePercent / 100;
  }
  return null;
};

const classifySignal = (changePct: number): { signal: ExtendedSessionSignal; reason: string } => {
  if (changePct >= 0.05) {
    return {
      signal: "thin-volume",
      reason: "장외 급등 구간입니다. 정규장 초반 거래대금과 전고점 지지 확인 전까지 추격 주의입니다.",
    };
  }
  if (changePct >= 0.02) {
    return {
      signal: "strong",
      reason: "장외 강세입니다. 정규장 시가 이후 5일선/전고점 지지 확인이 필요합니다.",
    };
  }
  if (changePct <= -0.05) {
    return {
      signal: "risk-off",
      reason: "장외 하락폭이 큽니다. 정규장 지지선 회복 전까지 리스크 관리가 우선입니다.",
    };
  }
  if (changePct <= -0.02) {
    return {
      signal: "watch",
      reason: "장외 약세입니다. 정규장 초반 20일선과 주요 지지선 반응을 확인해야 합니다.",
    };
  }
  return {
    signal: "none",
    reason: "장외 변동은 제한적입니다. 정규장 기준 브리핑을 우선합니다.",
  };
};

export const buildExtendedSessionReport = (
  candidates: ExtendedCandidate[],
  quotes: Array<MarketExtendedQuote | null>,
  now = new Date(),
): ExtendedSessionReport => {
  const session = getUsExtendedSession(now);
  const sessionLabel = getExtendedSessionLabel(session);

  if (session === "regular") {
    return {
      available: false,
      session,
      sessionLabel,
      asOf: now.toISOString(),
      referenceClose: null,
      summary: "정규장 진행 중입니다. 장외 보조 체크보다 실시간 정규장 가격과 거래대금을 우선합니다.",
      warnings: ["장외가는 정규장 신호 계산에 반영하지 않습니다."],
      topMovers: [],
    };
  }

  if (session === "closed") {
    return {
      available: false,
      session,
      sessionLabel,
      asOf: now.toISOString(),
      referenceClose: null,
      summary: "현재 미국장 장외 거래 시간이 아닙니다. 정규장 마감 기준 데일리 브리핑을 우선합니다.",
      warnings: ["프리마켓 또는 애프터마켓 시간에 다시 확인하십시오."],
      topMovers: [],
    };
  }

  const quoteBySymbol = new Map(
    quotes
      .filter((quote): quote is MarketExtendedQuote => quote !== null)
      .map((quote) => [quote.symbol, quote]),
  );
  const movers = candidates.flatMap((candidate) => {
    const quote = quoteBySymbol.get(candidate.symbol);
    if (!quote) {
      return [];
    }
    const price = getSessionPrice(quote, session);
    const referenceClose = getReferenceClose(quote);
    if (!isNumber(price) || !isNumber(referenceClose) || referenceClose <= 0) {
      return [];
    }
    const changePct =
      getSessionChangePercent(quote, session) ?? (price - referenceClose) / referenceClose;
    const classification = classifySignal(changePct);
    return [{
      symbol: candidate.symbol,
      name: candidate.name,
      price,
      referenceClose,
      changeFromRegularClosePct: changePct,
      signal: classification.signal,
      decision: candidate.decision,
      breakoutStatus: candidate.breakoutRule?.status,
      reason: classification.reason,
    }];
  }).toSorted((left, right) =>
    Math.abs(right.changeFromRegularClosePct) - Math.abs(left.changeFromRegularClosePct),
  ).slice(0, 5);

  const strongCount = movers.filter((mover) => mover.changeFromRegularClosePct >= 0.02).length;
  const weakCount = movers.filter((mover) => mover.changeFromRegularClosePct <= -0.02).length;

  return {
    available: movers.length > 0,
    session,
    sessionLabel,
    asOf: now.toISOString(),
    referenceClose: movers[0]?.referenceClose ?? null,
    summary: movers.length
      ? `${sessionLabel} 기준 강세 후보 ${strongCount}개, 약세/리스크 후보 ${weakCount}개입니다. 장외 움직임은 정규장 확인 전 참고만 합니다.`
      : `${sessionLabel} 데이터가 아직 충분하지 않습니다. 정규장 기준 데일리 브리핑을 우선합니다.`,
    warnings: [
      "장외가는 신고가 돌파 확정이나 진입 신호로 사용하지 않습니다.",
      "정규장 초반 거래대금과 5일선/20일선 지지 확인이 필요합니다.",
    ],
    topMovers: movers,
  };
};
