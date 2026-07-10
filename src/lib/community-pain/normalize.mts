import type { NormalizedCommunityItem, RawCommunityItem } from "./types.mts";

const KNOWN_KR_SYMBOLS: Record<string, string[]> = {
  "005930": ["삼성전자", "삼전", "Samsung Electronics"],
  "000660": ["SK하이닉스", "하이닉스", "SK Hynix"],
  "373220": ["LG에너지솔루션", "엘지에너지솔루션", "LG엔솔", "엔솔"],
  "207940": ["삼성바이오로직스", "삼바", "Samsung Biologics"],
  "005380": ["현대차", "현대자동차", "Hyundai Motor"],
  "000270": ["기아", "Kia"],
  "105560": ["KB금융", "KB Financial"],
  "068270": ["셀트리온", "Celltrion"],
  "035420": ["NAVER", "네이버"],
  "012450": ["한화에어로스페이스", "한화에어로", "Hanwha Aerospace"],
  "086520": ["에코프로", "EcoPro"],
  "247540": ["에코프로비엠", "에코프로BM", "EcoPro BM"],
  "028300": ["HLB", "에이치엘비"],
  "196170": ["알테오젠", "Alteogen"],
  "277810": ["레인보우로보틱스", "레인보우", "Rainbow Robotics"],
  "214150": ["클래시스", "Classys"],
  "141080": ["리가켐바이오", "LegoChem Biosciences", "LCB"],
  "087010": ["펩트론", "Peptron"],
  "000250": ["삼천당제약", "SCD"],
  "403870": ["HPSP"],
};

const htmlEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
};

export const decodeHtml = (value: string) =>
  value.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCharCode(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCharCode(Number.parseInt(entity.slice(1), 10));
    }
    return htmlEntities[entity.toLowerCase()] ?? match;
  });

export const stripTags = (value: string) =>
  decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

export const normalizeText = (value: string) =>
  stripTags(value)
    .toLowerCase()
    .replace(/([ㅋㅎㅠㅜ])\1{2,}/g, "$1$1")
    .replace(/[^\p{L}\p{N}%+\-. ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeCommunitySymbol = (rawSymbol: string, market = "US") => {
  const cleaned = rawSymbol.trim().toUpperCase();
  if (!cleaned) {
    return "";
  }
  if (market === "KOSPI" || market === "KOSDAQ") {
    return cleaned.replace(/\.(KS|KQ)$/i, "").replace(/[^0-9]/g, "").slice(0, 6);
  }
  if (market === "CRYPTO") {
    return cleaned
      .replace(/^KRW-/i, "")
      .replace(/-USD$/i, "")
      .replace(/USDT?$/i, "");
  }
  return cleaned.replace(/\.(KS|KQ)$/i, "").replace(/-USD$/i, "");
};

export const buildQueryTerms = (rawSymbol: string, market = "US") => {
  const canonicalSymbol = normalizeCommunitySymbol(rawSymbol, market);
  const terms = new Set<string>();
  if (canonicalSymbol) {
    terms.add(canonicalSymbol);
  }
  for (const term of KNOWN_KR_SYMBOLS[canonicalSymbol] ?? []) {
    terms.add(term);
  }
  if (market === "CRYPTO") {
    terms.add(canonicalSymbol.replace(/USDT?$/i, ""));
  }
  return [...terms].filter(Boolean);
};

export const normalizeItems = (
  items: RawCommunityItem[],
  queryTerms: string[],
): NormalizedCommunityItem[] =>
  items.map((item) => {
    const normalizedText = normalizeText(`${item.title} ${item.text ?? ""}`);
    const matchedTerms = queryTerms.filter((term) =>
      normalizedText.includes(term.toLowerCase()),
    );
    const engagement = Math.max(0, item.commentCount ?? 0) + Math.max(0, item.reactionCount ?? 0);
    return {
      ...item,
      kind: item.kind ?? "post",
      normalizedText,
      matchedTerms,
      engagement,
    };
  });

export const summarizeText = (value: string, maxLength = 120) => {
  const text = stripTags(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
};
