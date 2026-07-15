import {
  BEARISH_CRITICISM_TERMS,
  BEARISH_NEGATION_TERMS,
  BULLISH_HYPE_TERMS,
  BULLISH_NEGATION_TERMS,
  TARGET_CRITICISM_TERMS,
  TARGET_REFERENCE_TERMS,
  TOXICITY_TERMS,
} from "./lexicon.mts";
import { normalizeText } from "./normalize.mts";
import type {
  CommunitySentimentCategory,
  CommunitySentimentCounts,
  CommunitySentimentDistribution,
  CommunitySentimentDistributionOptions,
  CommunitySentimentEvidence,
  CommunitySentimentPostClassification,
  CommunitySentimentRatios,
  NormalizedCommunityItem,
} from "./types.mts";

const HOUR_MS = 3_600_000;
const CATEGORY_ORDER: CommunitySentimentCategory[] = [
  "bullish_hype",
  "bearish_criticism",
  "mixed",
  "neutral",
];

const hasAsciiBoundary = (text: string, term: string) => {
  let start = text.indexOf(term);
  while (start >= 0) {
    const before = text[start - 1] ?? "";
    const after = text[start + term.length] ?? "";
    const startsWithAsciiWord = /[a-z0-9]/.test(term[0] ?? "");
    const endsWithAsciiWord = /[a-z0-9]/.test(term.at(-1) ?? "");
    if (
      (!startsWithAsciiWord || !/[a-z0-9]/.test(before)) &&
      (!endsWithAsciiWord || !/[a-z0-9]/.test(after))
    ) {
      return true;
    }
    start = text.indexOf(term, start + 1);
  }
  return false;
};

const matchingTerms = (text: string, terms: string[]) =>
  terms.filter((rawTerm) => {
    const term = normalizeText(rawTerm);
    return term && hasAsciiBoundary(text, term);
  });

const unique = (values: string[]) => [...new Set(values)];

const hasNearbyTargetCriticism = (
  text: string,
  queryTerms: string[],
  criticismTerms: string[],
) => {
  const targets = unique([...queryTerms, ...TARGET_REFERENCE_TERMS])
    .map(normalizeText)
    .filter(Boolean);
  for (const target of targets) {
    let targetIndex = text.indexOf(target);
    while (targetIndex >= 0) {
      for (const criticism of criticismTerms) {
        let criticismIndex = text.indexOf(criticism);
        while (criticismIndex >= 0) {
          if (Math.abs(targetIndex - criticismIndex) <= 48) {
            return true;
          }
          criticismIndex = text.indexOf(criticism, criticismIndex + 1);
        }
      }
      targetIndex = text.indexOf(target, targetIndex + 1);
    }
  }
  return false;
};

export const classifyCommunityPost = (
  item: NormalizedCommunityItem,
  queryTerms: string[] = [],
): CommunitySentimentPostClassification => {
  const text = item.normalizedText || normalizeText(`${item.title} ${item.text ?? ""}`);
  const bullishNegations = matchingTerms(text, BULLISH_NEGATION_TERMS);
  const bearishNegations = matchingTerms(text, BEARISH_NEGATION_TERMS);
  const bullishTerms = bullishNegations.length ? [] : matchingTerms(text, BULLISH_HYPE_TERMS);
  const directionalBearishTerms = bearishNegations.length
    ? []
    : matchingTerms(text, BEARISH_CRITICISM_TERMS);
  const targetCriticismTerms = bearishNegations.length
    ? []
    : matchingTerms(text, TARGET_CRITICISM_TERMS);
  const targetCriticism = hasNearbyTargetCriticism(text, queryTerms, targetCriticismTerms)
    ? targetCriticismTerms
    : [];
  const bearishTerms = unique([
    ...directionalBearishTerms,
    ...targetCriticism,
    ...bullishNegations,
  ]);
  const toxicityTerms = matchingTerms(text, TOXICITY_TERMS);
  const hasBullish = bullishTerms.length > 0;
  const hasBearish = bearishTerms.length > 0;
  const category: CommunitySentimentCategory = hasBullish && hasBearish
    ? "mixed"
    : hasBullish
      ? "bullish_hype"
      : hasBearish
        ? "bearish_criticism"
        : "neutral";

  return {
    category,
    bullishTerms,
    bearishTerms,
    toxicityTerms,
    toxicity: toxicityTerms.length ? Math.min(100, 60 + (toxicityTerms.length - 1) * 20) : 0,
  };
};

const authorKey = (item: NormalizedCommunityItem) => {
  const author = item.authorHash ?? item.author;
  return author ? `${item.sourceId}:${normalizeText(author)}` : null;
};

const compareItems = (left: NormalizedCommunityItem, right: NormalizedCommunityItem) => {
  const timeDifference = Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "");
  if (timeDifference) return timeDifference;
  return `${left.sourceId}:${left.id}:${left.url}`.localeCompare(
    `${right.sourceId}:${right.id}:${right.url}`,
  );
};

const selectWindowItems = (
  items: NormalizedCommunityItem[],
  nowTimestamp: number,
  windowHours: 24 | 72,
) => {
  const seenText = new Set<string>();
  const authorCounts = new Map<string, number>();
  const selected: NormalizedCommunityItem[] = [];

  for (const item of items.toSorted(compareItems)) {
    if ((item.kind ?? "post") !== "post" || !item.normalizedText || !item.createdAt) continue;
    const createdAt = Date.parse(item.createdAt);
    const age = nowTimestamp - createdAt;
    if (!Number.isFinite(createdAt) || age < 0 || age > windowHours * HOUR_MS) continue;
    if (seenText.has(item.normalizedText)) continue;
    const key = authorKey(item);
    if (key && (authorCounts.get(key) ?? 0) >= 3) continue;

    seenText.add(item.normalizedText);
    if (key) authorCounts.set(key, (authorCounts.get(key) ?? 0) + 1);
    selected.push(item);
  }

  return selected;
};

const emptyCounts = (): CommunitySentimentCounts => ({
  bullish_hype: 0,
  bearish_criticism: 0,
  mixed: 0,
  neutral: 0,
});

const largestRemainderRatios = (
  counts: CommunitySentimentCounts,
  sampleCount: number,
): CommunitySentimentRatios => {
  const ratios = emptyCounts();
  const remainders = CATEGORY_ORDER.map((category, index) => {
    const exact = (counts[category] / sampleCount) * 100;
    ratios[category] = Math.floor(exact);
    return { category, index, remainder: exact - ratios[category] };
  });
  const remaining = 100 - CATEGORY_ORDER.reduce((sum, category) => sum + ratios[category], 0);
  remainders.sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) {
    ratios[remainders[index].category] += 1;
  }
  return ratios;
};

const evidenceFor = (
  item: NormalizedCommunityItem,
  classification: CommunitySentimentPostClassification,
): CommunitySentimentEvidence => ({
  category: classification.category,
  sourceId: item.sourceId,
  title: item.title,
  url: item.url,
  createdAt: item.createdAt!,
  engagement: item.engagement,
  matchedTerms: unique([
    ...classification.bullishTerms,
    ...classification.bearishTerms,
    ...classification.toxicityTerms,
  ]),
});

export const buildCommunitySentimentDistribution = (
  items: NormalizedCommunityItem[],
  options: CommunitySentimentDistributionOptions = {},
): CommunitySentimentDistribution => {
  const nowTimestamp = options.nowTimestamp ?? Date.now();
  let effectiveWindowHours: 24 | 72 = 24;
  let selected = selectWindowItems(items, nowTimestamp, 24);
  if (selected.length < 5) {
    effectiveWindowHours = 72;
    selected = selectWindowItems(items, nowTimestamp, 72);
  }

  const classified = selected.map((item) => ({
    item,
    classification: classifyCommunityPost(item, options.queryTerms),
  }));
  const counts = emptyCounts();
  for (const entry of classified) counts[entry.classification.category] += 1;
  const sampleCount = classified.length;
  const status = sampleCount >= 20
    ? "ready" as const
    : sampleCount >= 5
      ? "low_evidence" as const
      : "unavailable" as const;
  const identifiedAuthors = selected.map(authorKey);
  const uniqueAuthorCount = sampleCount >= 5 && identifiedAuthors.every(Boolean)
    ? new Set(identifiedAuthors).size
    : null;
  const ratios = status === "unavailable"
    ? null
    : largestRemainderRatios(counts, sampleCount);
  const evidenceCounts = emptyCounts();
  const evidence = classified
    .toSorted((left, right) =>
      right.item.engagement - left.item.engagement || compareItems(left.item, right.item))
    .filter(({ classification }) => {
      if (evidenceCounts[classification.category] >= 3) return false;
      evidenceCounts[classification.category] += 1;
      return true;
    })
    .map(({ item, classification }) => evidenceFor(item, classification));

  return {
    status,
    ratios,
    sampleCount,
    uniqueAuthorCount,
    effectiveWindowHours,
    pain: sampleCount
      ? Math.round(((counts.bearish_criticism + counts.mixed) / sampleCount) * 100)
      : 0,
    fomo: sampleCount
      ? Math.round(((counts.bullish_hype + counts.mixed) / sampleCount) * 100)
      : 0,
    toxicity: sampleCount
      ? Math.round(classified.reduce((sum, entry) => sum + entry.classification.toxicity, 0) / sampleCount)
      : 0,
    counts,
    evidence,
    reason: status === "unavailable"
      ? "날짜가 확인된 최근 최상위 글이 5건 미만입니다."
      : status === "low_evidence"
        ? "날짜가 확인된 최근 최상위 글이 20건 미만입니다."
        : undefined,
    generatedAt: new Date(nowTimestamp).toISOString(),
  };
};
