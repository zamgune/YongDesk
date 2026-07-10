import type { CommunitySourceConfig, CommunitySourceId } from "./types.mts";

export const COMMUNITY_SOURCE_CONFIGS: Record<CommunitySourceId, CommunitySourceConfig> = {
  paxnet: {
    id: "paxnet",
    label: "팍스넷 종목토론실",
    policyStatus: "allowed",
    defaultEnabled: true,
    confidenceWeight: 1,
  },
  bobaedream: {
    id: "bobaedream",
    label: "보배드림 커뮤니티",
    policyStatus: "allowed",
    defaultEnabled: false,
    confidenceWeight: 0.44,
    reason: "종목 전용이 아닌 광역 시장 반응입니다.",
  },
  reddit: {
    id: "reddit",
    label: "Reddit",
    policyStatus: "allowed",
    defaultEnabled: true,
    confidenceWeight: 0.72,
    reason: "앱 Keychain 또는 REDDIT_CLIENT_ID·REDDIT_CLIENT_SECRET으로 공식 OAuth API를 사용할 때만 실행합니다.",
  },
  threads: {
    id: "threads",
    label: "Threads",
    policyStatus: "allowed",
    defaultEnabled: false,
    confidenceWeight: 0.68,
    reason: "THREADS_ACCESS_TOKEN 설정이 있을 때만 실행합니다.",
  },
  blind: {
    id: "blind",
    label: "블라인드",
    policyStatus: "spike",
    defaultEnabled: false,
    confidenceWeight: 0.35,
    reason: "공개 웹 접근이 차단되어 수동 스파이크 확인만 허용합니다.",
  },
  naver_finance: {
    id: "naver_finance",
    label: "네이버 금융 종토방",
    policyStatus: "disabled",
    defaultEnabled: false,
    confidenceWeight: 0,
    reason: "v1에서는 자동 수집하지 않습니다.",
  },
  clien: {
    id: "clien",
    label: "클리앙",
    policyStatus: "disabled",
    defaultEnabled: false,
    confidenceWeight: 0,
    reason: "v1에서는 자동 수집하지 않습니다.",
  },
};

export const COMMUNITY_CACHE_TTL_SECONDS = 30 * 60;
export const COMMUNITY_CACHE_MAX_ENTRIES = 200;
export const COMMUNITY_LOOKBACK_HOURS = 24;
export const COMMUNITY_FALLBACK_LOOKBACK_HOURS = 72;
export const DEFAULT_ITEM_LIMIT = 250;
export const FETCH_TIMEOUT_MS = 6_000;
export const FETCH_MAX_BODY_BYTES = 1_000_000;
export const SOURCE_REQUEST_CONCURRENCY = 4;
export const PAXNET_MAX_PAGES = 20;
export const PAXNET_MAX_DETAIL_FETCHES = 60;
export const PAXNET_MAX_COMMENT_POSTS = 25;
export const PAXNET_MAX_COMMENT_PAGES_PER_POST = 2;
export const BOBAEDREAM_MAX_KEYWORDS = 4;
export const BOBAEDREAM_MAX_PAGES_PER_KEYWORD = 5;
export const BOBAEDREAM_MAX_DETAIL_FETCHES = 40;
export const REDDIT_MAX_POSTS = 100;
export const REDDIT_MAX_COMMENT_POSTS = 30;
export const THREADS_MAX_QUERIES = 3;
export const THREADS_MAX_POSTS_PER_QUERY = 50;
export const THREADS_MAX_CONVERSATION_POSTS = 20;
