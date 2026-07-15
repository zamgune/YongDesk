export type CommunitySourceId =
  | "paxnet"
  | "bobaedream"
  | "reddit"
  | "threads"
  | "blind"
  | "naver_finance"
  | "clien";

export type SourcePolicyStatus = "allowed" | "spike" | "disabled";

export type SourceRunStatus =
  | "ok"
  | "empty"
  | "error"
  | "skipped"
  | "configuration-required"
  | "spike-only";

export type CommunitySourceConfig = {
  id: CommunitySourceId;
  label: string;
  policyStatus: SourcePolicyStatus;
  defaultEnabled: boolean;
  confidenceWeight: number;
  reason?: string;
};

export type RawCommunityItem = {
  sourceId: CommunitySourceId;
  id: string;
  title: string;
  text?: string;
  url: string;
  author?: string;
  authorHash?: string;
  createdAt?: string;
  commentCount?: number;
  reactionCount?: number;
  kind?: "post" | "comment" | "reply";
  parentId?: string;
  sourceWeight?: number;
  recencyWeight?: number;
};

export type NormalizedCommunityItem = RawCommunityItem & {
  normalizedText: string;
  matchedTerms: string[];
  engagement: number;
};

export type CommunityPainFactor = {
  key:
    | "painKeywordDensity"
    | "lossConfession"
    | "leverageStress"
    | "negativePositiveRatio"
    | "engagement"
    | "sourceConfidence"
    | "sourceAgreement";
  label: string;
  score: number;
  value: string;
  detail: string;
};

export type CommunityGajuaFactor = {
  key:
    | "gajuaKeywordDensity"
    | "fomoConviction"
    | "breakoutHype"
    | "gajuaEngagement"
    | "gajuaSourceAgreement";
  label: string;
  score: number;
  value: string;
  detail: string;
};

export type CommunityPainLevel = "평온" | "한숨" | "비명 전조" | "곡소리" | "대합창";

export type CommunitySentimentRegime = "calm" | "panic" | "hype" | "divided" | "low_evidence";

export type CommunitySentimentCategory =
  | "bullish_hype"
  | "bearish_criticism"
  | "mixed"
  | "neutral";

export type CommunitySentimentDistributionStatus = "ready" | "low_evidence" | "unavailable";

export type CommunitySentimentRatios = Record<CommunitySentimentCategory, number>;

export type CommunitySentimentCounts = Record<CommunitySentimentCategory, number>;

export type CommunitySentimentPostClassification = {
  category: CommunitySentimentCategory;
  bullishTerms: string[];
  bearishTerms: string[];
  toxicityTerms: string[];
  toxicity: number;
};

export type CommunitySentimentEvidence = {
  category: CommunitySentimentCategory;
  sourceId: CommunitySourceId;
  title: string;
  url: string;
  createdAt: string;
  engagement: number;
  matchedTerms: string[];
};

export type CommunitySentimentDistribution = {
  status: CommunitySentimentDistributionStatus;
  ratios: CommunitySentimentRatios | null;
  sampleCount: number;
  uniqueAuthorCount: number | null;
  effectiveWindowHours: 24 | 72;
  pain: number;
  fomo: number;
  toxicity: number;
  counts: CommunitySentimentCounts;
  evidence: CommunitySentimentEvidence[];
  reason?: string;
  generatedAt: string;
};

export type CommunitySentimentDistributionOptions = {
  nowTimestamp?: number;
  queryTerms?: string[];
};

export type CommunityPainSourceResult = {
  id: CommunitySourceId;
  label: string;
  policyStatus: SourcePolicyStatus;
  status: SourceRunStatus;
  url?: string;
  itemCount: number;
  postCount: number;
  commentItemCount: number;
  replyCount: number;
  candidateCount: number;
  recentItemCount: number;
  confidenceWeight: number;
  reason?: string;
  oldestItemAt?: string;
  newestItemAt?: string;
  dateParseCoverage: number;
  timedOut?: boolean;
  items: NormalizedCommunityItem[];
};

export type CommunityPainSourceStats = {
  id: CommunitySourceId;
  label: string;
  policyStatus: SourcePolicyStatus;
  status: SourceRunStatus;
  confidenceWeight: number;
  reason?: string;
  candidateCount: number;
  recentItemCount: number;
  itemCount: number;
  postCount: number;
  commentItemCount: number;
  replyCount: number;
  oldestItemAt?: string;
  newestItemAt?: string;
  dateParseCoverage: number;
  timedOut: boolean;
};

export type CommunityPainResponse = {
  symbol: string;
  canonicalSymbol: string;
  market: string;
  queryTerms: string[];
  lookbackHours: number;
  score: number;
  painScore: number;
  gajuaScore: number;
  divisionScore: number;
  sentimentRegime: CommunitySentimentRegime;
  level: CommunityPainLevel;
  confidence: number;
  verdict: string;
  evidenceCount: number;
  postCount: number;
  commentCount: number;
  replyCount: number;
  signalItemCount: number;
  collectionWindowHours: number;
  lowEvidence: boolean;
  qualityReasons: string[];
  factors: CommunityPainFactor[];
  gajuaFactors: CommunityGajuaFactor[];
  sourceStats: CommunityPainSourceStats[];
  snippets: Array<{
    sourceId: CommunitySourceId;
    sourceLabel: string;
    title: string;
    url: string;
    reason: string;
    engagement: number;
    kind: "post" | "comment" | "reply";
  }>;
  painSnippets: Array<{
    sourceId: CommunitySourceId;
    sourceLabel: string;
    title: string;
    url: string;
    reason: string;
    engagement: number;
    kind: "post" | "comment" | "reply";
  }>;
  gajuaSnippets: Array<{
    sourceId: CommunitySourceId;
    sourceLabel: string;
    title: string;
    url: string;
    reason: string;
    engagement: number;
    kind: "post" | "comment" | "reply";
  }>;
  generatedAt: string;
  cacheTtlSeconds: number;
};

export type SourceFetchContext = {
  symbol: string;
  canonicalSymbol: string;
  market: string;
  queryTerms: string[];
  includeBroad: boolean;
  includeSpikeSources: boolean;
  limit: number;
  lookbackHours: number;
  collectionWindowHours: number;
  nowTimestamp: number;
  sinceTimestamp: number;
  primarySinceTimestamp: number;
  summaryOnly?: boolean;
};

export type CommunitySourceAdapter = {
  config: CommunitySourceConfig;
  fetchItems: (context: SourceFetchContext) => Promise<CommunityPainSourceResult>;
};
