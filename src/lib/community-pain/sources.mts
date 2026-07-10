import { bobaedreamAdapter } from "./adapters/bobaedream.mts";
import { paxnetAdapter } from "./adapters/paxnet.mts";
import { redditAdapter } from "./adapters/reddit.mts";
import { blindAdapter, clienAdapter, naverFinanceAdapter } from "./adapters/static.mts";
import { threadsAdapter } from "./adapters/threads.mts";
import type { CommunitySourceAdapter, CommunitySourceId } from "./types.mts";

export const COMMUNITY_SOURCE_ADAPTERS: Record<CommunitySourceId, CommunitySourceAdapter> = {
  paxnet: paxnetAdapter,
  bobaedream: bobaedreamAdapter,
  reddit: redditAdapter,
  threads: threadsAdapter,
  blind: blindAdapter,
  naver_finance: naverFinanceAdapter,
  clien: clienAdapter,
};

export const selectCommunitySources = ({
  requestedSources,
  includeBroad,
  includeSpikeSources,
}: {
  requestedSources?: CommunitySourceId[];
  includeBroad: boolean;
  includeSpikeSources: boolean;
}) => {
  if (requestedSources?.length) {
    return requestedSources.map((sourceId) => COMMUNITY_SOURCE_ADAPTERS[sourceId]).filter(Boolean);
  }

  return [
    COMMUNITY_SOURCE_ADAPTERS.paxnet,
    ...(includeBroad ? [COMMUNITY_SOURCE_ADAPTERS.bobaedream] : []),
    COMMUNITY_SOURCE_ADAPTERS.reddit,
    COMMUNITY_SOURCE_ADAPTERS.threads,
    ...(includeSpikeSources ? [COMMUNITY_SOURCE_ADAPTERS.blind] : [COMMUNITY_SOURCE_ADAPTERS.blind]),
    COMMUNITY_SOURCE_ADAPTERS.naver_finance,
    COMMUNITY_SOURCE_ADAPTERS.clien,
  ];
};
