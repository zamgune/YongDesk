import { COMMUNITY_SOURCE_CONFIGS } from "../config.mts";
import type { CommunitySourceAdapter, CommunitySourceConfig } from "../types.mts";
import { buildSkippedResult } from "./shared.mts";

const disabledAdapter = (config: CommunitySourceConfig): CommunitySourceAdapter => ({
  config,
  async fetchItems() {
    return buildSkippedResult(config, "skipped", config.reason ?? "v1에서 비활성화된 소스입니다.");
  },
});

export const blindAdapter: CommunitySourceAdapter = {
  config: COMMUNITY_SOURCE_CONFIGS.blind,
  async fetchItems(context) {
    if (!context.includeSpikeSources) {
      return buildSkippedResult(
        COMMUNITY_SOURCE_CONFIGS.blind,
        "spike-only",
        "공개 웹 접근이 차단되어 자동 수집하지 않습니다.",
      );
    }
    return buildSkippedResult(
      COMMUNITY_SOURCE_CONFIGS.blind,
      "spike-only",
      "스파이크 수동 입력 경로가 아직 연결되지 않았습니다.",
    );
  },
};

export const naverFinanceAdapter = disabledAdapter(COMMUNITY_SOURCE_CONFIGS.naver_finance);
export const clienAdapter = disabledAdapter(COMMUNITY_SOURCE_CONFIGS.clien);
