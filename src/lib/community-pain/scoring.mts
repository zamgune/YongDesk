import {
  BREAKOUT_HYPE_TERMS,
  FOMO_CONVICTION_TERMS,
  GAJUA_TERMS,
  LEVERAGE_STRESS_TERMS,
  LOSS_CONFESSION_TERMS,
  NEGATIVE_TERMS,
  PAIN_TERMS,
  POSITIVE_TERMS,
} from "./lexicon.mts";
import type {
  CommunityGajuaFactor,
  CommunityPainFactor,
  CommunityPainLevel,
  CommunitySentimentRegime,
  CommunityPainSourceResult,
  NormalizedCommunityItem,
} from "./types.mts";

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const countMatches = (text: string, terms: string[]) =>
  terms.reduce((count, term) => count + (text.includes(term.toLowerCase()) ? 1 : 0), 0);

const itemHasAny = (item: NormalizedCommunityItem, terms: string[]) =>
  terms.some((term) => item.normalizedText.includes(term.toLowerCase()));

const itemKindWeight = (item: NormalizedCommunityItem) => {
  if (item.kind === "reply") return 0.35;
  if (item.kind === "comment") return 0.45;
  return 1;
};

const getRecencyWeight = (item: NormalizedCommunityItem, nowTimestamp: number) => {
  if (typeof item.recencyWeight === "number") {
    return item.recencyWeight;
  }
  if (!item.createdAt) {
    return 0.75;
  }
  const timestamp = Date.parse(item.createdAt);
  if (!Number.isFinite(timestamp)) {
    return 0.75;
  }
  const ageHours = Math.max(0, (nowTimestamp - timestamp) / 3_600_000);
  if (ageHours <= 24) return 1;
  if (ageHours <= 48) return 0.55;
  if (ageHours <= 72) return 0.3;
  return 0.12;
};

const buildDuplicateWeights = (items: NormalizedCommunityItem[]) => {
  const textCounts = new Map<string, number>();
  const authorCounts = new Map<string, number>();
  for (const item of items) {
    const textKey = item.normalizedText.slice(0, 120);
    textCounts.set(textKey, (textCounts.get(textKey) ?? 0) + 1);
    const authorKey = item.authorHash ?? item.author;
    if (authorKey) {
      authorCounts.set(authorKey, (authorCounts.get(authorKey) ?? 0) + 1);
    }
  }
  return (item: NormalizedCommunityItem) => {
    const textKey = item.normalizedText.slice(0, 120);
    const textCount = textCounts.get(textKey) ?? 1;
    const authorKey = item.authorHash ?? item.author;
    const authorCount = authorKey ? authorCounts.get(authorKey) ?? 1 : 1;
    return Math.max(0.25, 1 / Math.sqrt(textCount)) * Math.max(0.45, 1 / Math.sqrt(authorCount));
  };
};

const averageTop = (values: number[], limit: number) => {
  const topValues = values
    .filter((value) => value > 0)
    .sort((left, right) => right - left)
    .slice(0, limit);
  if (!topValues.length) {
    return 0;
  }
  return topValues.reduce((sum, value) => sum + value, 0) / topValues.length;
};

export const getCommunityPainLevel = (score: number): CommunityPainLevel => {
  if (score >= 82) return "대합창";
  if (score >= 65) return "곡소리";
  if (score >= 45) return "비명 전조";
  if (score >= 25) return "한숨";
  return "평온";
};

export const getCommunityPainVerdict = (
  score: number,
  lowEvidence: boolean,
  evidenceCount: number,
  sentimentRegime: CommunitySentimentRegime = "calm",
) => {
  if (lowEvidence) {
    return `근거 글 ${evidenceCount}개로는 커뮤니티 곡소리를 단정하기 어렵습니다.`;
  }
  if (sentimentRegime === "divided") {
    return "공포와 가즈아 반응이 동시에 강해 커뮤니티 의견이 크게 갈립니다.";
  }
  if (sentimentRegime === "hype") {
    return "곡소리보다 가즈아·몰빵·급등 기대가 더 강해 과열 가능성이 보입니다.";
  }
  if (score >= 82) {
    return "손실 고백, 레버리지 스트레스, 부정 반응이 동시에 강합니다.";
  }
  if (score >= 65) {
    return "커뮤니티 체감 손실과 불안 표현이 뚜렷하게 잡힙니다.";
  }
  if (score >= 45) {
    return "불편한 반응은 있으나 극단적 투매 정서까지는 아닙니다.";
  }
  if (score >= 25) {
    return "일부 불안 표현이 보이지만 아직 넓게 번진 곡소리는 아닙니다.";
  }
  return "현재 수집된 커뮤니티 반응은 비교적 차분합니다.";
};

export const getCommunitySentimentRegime = (
  painScore: number,
  gajuaScore: number,
  lowEvidence: boolean,
): CommunitySentimentRegime => {
  if (lowEvidence) return "low_evidence";
  if (painScore >= 35 && gajuaScore >= 35 && Math.max(painScore, gajuaScore) >= 45) {
    return "divided";
  }
  if (painScore >= 45) return "panic";
  if (gajuaScore >= 45) return "hype";
  return "calm";
};

export const scoreCommunityPain = (sources: CommunityPainSourceResult[]) => {
  const okSources = sources.filter((source) => source.status === "ok" && source.items.length);
  const items = okSources.flatMap((source) => source.items);
  const evidenceCount = items.length;
  const sourceWeight = okSources.reduce((sum, source) => sum + source.confidenceWeight, 0);
  const sourceCount = okSources.length;
  const sourceWeightById = new Map(okSources.map((source) => [source.id, source.confidenceWeight]));
  const dateParseCoverage =
    okSources.reduce((sum, source) => sum + source.dateParseCoverage, 0) /
    Math.max(1, okSources.length);
  const lowEvidence = evidenceCount < 5 || sourceWeight < 0.8;

  if (!items.length) {
    return {
      score: 0,
      painScore: 0,
      gajuaScore: 0,
      divisionScore: 0,
      sentimentRegime: "low_evidence" as const,
      level: getCommunityPainLevel(0),
      confidence: 0,
      lowEvidence: true,
      factors: buildEmptyFactors(),
      gajuaFactors: buildEmptyGajuaFactors(),
      signalItemCount: 0,
      verdict: getCommunityPainVerdict(0, true, 0, "low_evidence"),
    };
  }

  const nowTimestamp = Date.now();
  const duplicateWeightFor = buildDuplicateWeights(items);
  const scoredItems = items.map((item) => {
    const evidenceWeight =
      itemKindWeight(item) *
      getRecencyWeight(item, nowTimestamp) *
      (sourceWeightById.get(item.sourceId) ?? 0.5) *
      duplicateWeightFor(item);
    const lossHits = countMatches(item.normalizedText, LOSS_CONFESSION_TERMS);
    const leverageHits = countMatches(item.normalizedText, LEVERAGE_STRESS_TERMS);
    const localPainHits = countMatches(item.normalizedText, PAIN_TERMS);
    const localNegativeHits = countMatches(item.normalizedText, NEGATIVE_TERMS);
    const localPositiveHits = countMatches(item.normalizedText, POSITIVE_TERMS);
    const fomoHits = countMatches(item.normalizedText, FOMO_CONVICTION_TERMS);
    const breakoutHits = countMatches(item.normalizedText, BREAKOUT_HYPE_TERMS);
    const localGajuaHits = countMatches(item.normalizedText, GAJUA_TERMS);
    const painSignal = clamp(
      localPainHits * 16 +
        lossHits * 20 +
        leverageHits * 24 +
        localNegativeHits * 8 -
        localPositiveHits * 3,
    );
    const gajuaSignal = clamp(localGajuaHits * 18 + fomoHits * 24 + breakoutHits * 22);
    return {
      item,
      painSignal,
      gajuaSignal,
      weightedPainSignal: painSignal * evidenceWeight,
      weightedGajuaSignal: gajuaSignal * evidenceWeight,
    };
  });

  const painHits = items.reduce((sum, item) => sum + countMatches(item.normalizedText, PAIN_TERMS), 0);
  const negativeHits = items.reduce((sum, item) => sum + countMatches(item.normalizedText, NEGATIVE_TERMS), 0);
  const positiveHits = items.reduce((sum, item) => sum + countMatches(item.normalizedText, POSITIVE_TERMS), 0);
  const gajuaHits = items.reduce((sum, item) => sum + countMatches(item.normalizedText, GAJUA_TERMS), 0);
  const lossCount = items.filter((item) => itemHasAny(item, LOSS_CONFESSION_TERMS)).length;
  const leverageCount = items.filter((item) => itemHasAny(item, LEVERAGE_STRESS_TERMS)).length;
  const fomoCount = items.filter((item) => itemHasAny(item, FOMO_CONVICTION_TERMS)).length;
  const breakoutCount = items.filter((item) => itemHasAny(item, BREAKOUT_HYPE_TERMS)).length;
  const painSignalItemCount = scoredItems.filter((item) => item.painSignal > 0).length;
  const gajuaSignalItemCount = scoredItems.filter((item) => item.gajuaSignal > 0).length;
  const signalItemCount = scoredItems.filter((item) => item.painSignal > 0 || item.gajuaSignal > 0).length;
  const engagementTotal = items.reduce((sum, item) => sum + item.engagement, 0);
  const datedItemAges = items
    .map((item) => (item.createdAt ? nowTimestamp - Date.parse(item.createdAt) : Number.NaN))
    .filter((age) => Number.isFinite(age) && age >= 0);
  const averageAgeHours = datedItemAges.length
    ? datedItemAges.reduce((sum, age) => sum + age, 0) / datedItemAges.length / 3_600_000
    : 12;
  const timeFreshness = clamp(100 - (averageAgeHours / 72) * 45);
  const gajuaEngagementTotal = items
    .filter((item) => itemHasAny(item, GAJUA_TERMS))
    .reduce((sum, item) => sum + item.engagement, 0);
  const sourceAgreementCount = okSources.filter((source) =>
    source.items.some((item) => itemHasAny(item, PAIN_TERMS) || itemHasAny(item, NEGATIVE_TERMS)),
  ).length;
  const gajuaSourceAgreementCount = okSources.filter((source) =>
    source.items.some((item) => itemHasAny(item, GAJUA_TERMS)),
  ).length;

  const effectiveSignalBase = Math.max(6, Math.min(30, Math.ceil(evidenceCount * 0.18)));
  const painPeak = averageTop(scoredItems.map((item) => item.weightedPainSignal), 10);
  const gajuaPeak = averageTop(scoredItems.map((item) => item.weightedGajuaSignal), 10);
  const painKeywordDensity = clamp(Math.max((painHits / Math.max(1, signalItemCount || evidenceCount)) * 28, painPeak));
  const lossConfession = clamp((lossCount / effectiveSignalBase) * 100);
  const leverageStress = clamp((leverageCount / Math.max(3, effectiveSignalBase)) * 100);
  const negativePositiveRatio = clamp(((negativeHits + 1) / (positiveHits + 1) - 1) * 34);
  const engagement = clamp(Math.log10(engagementTotal + 1) * 34);
  const sourceConfidence = clamp(sourceWeight * 44);
  const sourceAgreement = clamp((sourceAgreementCount / Math.max(1, sourceCount)) * 100);
  const gajuaKeywordDensity = clamp(Math.max((gajuaHits / Math.max(1, signalItemCount || evidenceCount)) * 32, gajuaPeak));
  const fomoConviction = clamp((fomoCount / effectiveSignalBase) * 100);
  const breakoutHype = clamp((breakoutCount / effectiveSignalBase) * 100);
  const gajuaEngagement = clamp(Math.log10(gajuaEngagementTotal + 1) * 40);
  const gajuaSourceAgreement = clamp((gajuaSourceAgreementCount / Math.max(1, sourceCount)) * 100);
  const painBreadth = clamp((painSignalItemCount / effectiveSignalBase) * 100);
  const gajuaBreadth = clamp((gajuaSignalItemCount / effectiveSignalBase) * 100);

  const rawScore =
    painKeywordDensity * 0.28 +
    lossConfession * 0.17 +
    leverageStress * 0.16 +
    painBreadth * 0.12 +
    negativePositiveRatio * 0.09 +
    engagement * 0.06 +
    sourceConfidence * 0.04 +
    sourceAgreement * 0.08;
  const score = Math.round(clamp(lowEvidence ? rawScore * 0.68 : rawScore));
  const rawGajuaScore =
    gajuaKeywordDensity * 0.3 +
    fomoConviction * 0.2 +
    breakoutHype * 0.18 +
    gajuaBreadth * 0.12 +
    gajuaEngagement * 0.08 +
    sourceConfidence * 0.04 +
    gajuaSourceAgreement * 0.08;
  const gajuaScore = Math.round(clamp(lowEvidence ? rawGajuaScore * 0.68 : rawGajuaScore));
  const divisionScore = Math.round(
    clamp(Math.min(score, gajuaScore) * 0.7 + (100 - Math.abs(score - gajuaScore)) * 0.3),
  );
  const sentimentRegime = getCommunitySentimentRegime(score, gajuaScore, lowEvidence);
  const confidence = Math.round(
    clamp(
      (Math.min(evidenceCount, 90) / 90) * 32 +
        Math.min(sourceWeight, 2.6) * 15 +
        Math.max(sourceAgreement, gajuaSourceAgreement) * 0.1 +
        Math.min(signalItemCount, 40) * 0.28 +
        Math.min(engagement, 100) * 0.05 +
        timeFreshness * 0.1 +
        dateParseCoverage * 8,
    ),
  );
  const factors: CommunityPainFactor[] = [
    {
      key: "painKeywordDensity",
      label: "비명 키워드 밀도",
      score: Math.round(painKeywordDensity),
      value: `${painHits}회`,
      detail: "곡소리, 손절, 물림, 폭락 같은 직접 표현입니다.",
    },
    {
      key: "lossConfession",
      label: "손실 고백",
      score: Math.round(lossConfession),
      value: `${lossCount}/${evidenceCount}`,
      detail: "손실, 물림, 평단, 본전 복구 표현입니다.",
    },
    {
      key: "leverageStress",
      label: "레버리지 압박",
      score: Math.round(leverageStress),
      value: `${leverageCount}/${evidenceCount}`,
      detail: "빚투, 미수, 신용, 반대매매 계열 표현입니다.",
    },
    {
      key: "negativePositiveRatio",
      label: "부정/긍정 비율",
      score: Math.round(negativePositiveRatio),
      value: `${negativeHits}/${positiveHits}`,
      detail: "하락·투매 표현과 반등·회복 표현의 균형입니다.",
    },
    {
      key: "engagement",
      label: "반응 강도",
      score: Math.round(engagement),
      value: `${engagementTotal}`,
      detail: "댓글과 추천 등 공개 반응 수를 보조 신호로 씁니다.",
    },
    {
      key: "sourceConfidence",
      label: "소스 신뢰도",
      score: Math.round(sourceConfidence),
      value: sourceWeight.toFixed(2),
      detail: "종목 전용 소스와 보조 소스 가중치 합입니다.",
    },
    {
      key: "sourceAgreement",
      label: "소스 합의",
      score: Math.round(sourceAgreement),
      value: `${sourceAgreementCount}/${sourceCount}`,
      detail: "여러 소스에서 동시에 부정 반응이 잡히는지 봅니다.",
    },
  ];
  const gajuaFactors: CommunityGajuaFactor[] = [
    {
      key: "gajuaKeywordDensity",
      label: "가즈아 키워드 밀도",
      score: Math.round(gajuaKeywordDensity),
      value: `${gajuaHits}회`,
      detail: "가즈아, 몰빵, 10배, 숏스퀴즈 같은 과열 표현입니다.",
    },
    {
      key: "fomoConviction",
      label: "FOMO 확신",
      score: Math.round(fomoConviction),
      value: `${fomoCount}/${evidenceCount}`,
      detail: "풀매수, 몰빵, 무조건 같은 강한 확신 표현입니다.",
    },
    {
      key: "breakoutHype",
      label: "돌파 기대",
      score: Math.round(breakoutHype),
      value: `${breakoutCount}/${evidenceCount}`,
      detail: "상한가, 신고가, 숏스퀴즈, 10배 기대 표현입니다.",
    },
    {
      key: "gajuaEngagement",
      label: "가즈아 반응 강도",
      score: Math.round(gajuaEngagement),
      value: `${gajuaEngagementTotal}`,
      detail: "가즈아 표현이 포함된 글의 댓글과 추천 반응입니다.",
    },
    {
      key: "gajuaSourceAgreement",
      label: "가즈아 소스 합의",
      score: Math.round(gajuaSourceAgreement),
      value: `${gajuaSourceAgreementCount}/${sourceCount}`,
      detail: "여러 소스에서 동시에 과열 표현이 잡히는지 봅니다.",
    },
  ];

  return {
    score,
    painScore: score,
    gajuaScore,
    divisionScore,
    sentimentRegime,
    level: getCommunityPainLevel(score),
    confidence,
    lowEvidence,
    factors,
    gajuaFactors,
    signalItemCount,
    verdict: getCommunityPainVerdict(score, lowEvidence, evidenceCount, sentimentRegime),
  };
};

const buildEmptyFactors = (): CommunityPainFactor[] => [
  {
    key: "painKeywordDensity",
    label: "비명 키워드 밀도",
    score: 0,
    value: "0회",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
  {
    key: "lossConfession",
    label: "손실 고백",
    score: 0,
    value: "0/0",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
  {
    key: "leverageStress",
    label: "레버리지 압박",
    score: 0,
    value: "0/0",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
  {
    key: "negativePositiveRatio",
    label: "부정/긍정 비율",
    score: 0,
    value: "0/0",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
  {
    key: "engagement",
    label: "반응 강도",
    score: 0,
    value: "0",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
  {
    key: "sourceConfidence",
    label: "소스 신뢰도",
    score: 0,
    value: "0.00",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
  {
    key: "sourceAgreement",
    label: "소스 합의",
    score: 0,
    value: "0/0",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
];

const buildEmptyGajuaFactors = (): CommunityGajuaFactor[] => [
  {
    key: "gajuaKeywordDensity",
    label: "가즈아 키워드 밀도",
    score: 0,
    value: "0회",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
  {
    key: "fomoConviction",
    label: "FOMO 확신",
    score: 0,
    value: "0/0",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
  {
    key: "breakoutHype",
    label: "돌파 기대",
    score: 0,
    value: "0/0",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
  {
    key: "gajuaEngagement",
    label: "가즈아 반응 강도",
    score: 0,
    value: "0",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
  {
    key: "gajuaSourceAgreement",
    label: "가즈아 소스 합의",
    score: 0,
    value: "0/0",
    detail: "분석 가능한 글이 아직 없습니다.",
  },
];

export const itemHasPainSignal = (item: NormalizedCommunityItem) =>
  itemHasAny(item, LEVERAGE_STRESS_TERMS) ||
  itemHasAny(item, LOSS_CONFESSION_TERMS) ||
  itemHasAny(item, PAIN_TERMS) ||
  itemHasAny(item, NEGATIVE_TERMS);

export const itemHasGajuaSignal = (item: NormalizedCommunityItem) =>
  itemHasAny(item, GAJUA_TERMS) ||
  itemHasAny(item, FOMO_CONVICTION_TERMS) ||
  itemHasAny(item, BREAKOUT_HYPE_TERMS);

export const buildSnippetReason = (item: NormalizedCommunityItem) => {
  const reasons = [
    itemHasAny(item, LEVERAGE_STRESS_TERMS) ? "레버리지 압박" : null,
    itemHasAny(item, LOSS_CONFESSION_TERMS) ? "손실 고백" : null,
    itemHasAny(item, PAIN_TERMS) ? "비명 키워드" : null,
    itemHasAny(item, NEGATIVE_TERMS) ? "부정 반응" : null,
    itemHasAny(item, GAJUA_TERMS) ? "가즈아 과열" : null,
  ].filter(Boolean);
  return reasons.join(", ") || "관련 커뮤니티 반응";
};
