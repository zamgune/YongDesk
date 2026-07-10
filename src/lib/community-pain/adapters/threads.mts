import {
  COMMUNITY_SOURCE_CONFIGS,
  THREADS_MAX_CONVERSATION_POSTS,
  THREADS_MAX_POSTS_PER_QUERY,
  THREADS_MAX_QUERIES,
} from "../config.mts";
import type { CommunitySourceAdapter, RawCommunityItem } from "../types.mts";
import { buildErrorResult, buildOkResult, buildSkippedResult, fetchJson, mapWithConcurrency } from "./shared.mts";

const config = COMMUNITY_SOURCE_CONFIGS.threads;
const graphBaseUrl = "https://graph.threads.net/v1.0";

type ThreadsMedia = {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
  permalink?: string;
  like_count?: number;
  replies_count?: number;
  reply_count?: number;
  has_replies?: boolean;
};

const toThreadsItem = (
  media: ThreadsMedia,
  kind: "post" | "comment" | "reply",
  parentId?: string,
): RawCommunityItem | null => {
  if (!media.id || !media.text) {
    return null;
  }
  const replyCount = media.replies_count ?? media.reply_count ?? 0;
  return {
    sourceId: "threads",
    id: media.id,
    kind,
    parentId,
    title: media.text,
    url: media.permalink ?? `https://www.threads.net/@${media.username ?? "post"}/post/${media.id}`,
    author: media.username,
    authorHash: media.username,
    createdAt: media.timestamp ? new Date(media.timestamp).toISOString() : undefined,
    commentCount: replyCount,
    reactionCount: media.like_count ?? 0,
  };
};

const buildKeywordUrl = (query: string, accessToken: string) => {
  const url = new URL(`${graphBaseUrl}/keyword_search`);
  url.searchParams.set("q", query);
  url.searchParams.set("search_type", "RECENT");
  url.searchParams.set("search_mode", "KEYWORD");
  url.searchParams.set("limit", String(THREADS_MAX_POSTS_PER_QUERY));
  url.searchParams.set(
    "fields",
    "id,text,username,timestamp,permalink,like_count,replies_count,has_replies",
  );
  url.searchParams.set("access_token", accessToken);
  return url.toString();
};

const buildConversationUrl = (mediaId: string, accessToken: string) => {
  const url = new URL(`${graphBaseUrl}/${encodeURIComponent(mediaId)}/conversation`);
  url.searchParams.set("limit", "100");
  url.searchParams.set("fields", "id,text,username,timestamp,permalink,like_count,replies_count");
  url.searchParams.set("access_token", accessToken);
  return url.toString();
};

const fetchConversation = async (post: RawCommunityItem, accessToken: string) => {
  const payload = await fetchJson(buildConversationUrl(post.id, accessToken));
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .map((row: ThreadsMedia, index: number) =>
      toThreadsItem(row, index === 0 ? "comment" : "reply", post.id),
    )
    .filter((item: RawCommunityItem | null): item is RawCommunityItem => item !== null);
};

export const threadsAdapter: CommunitySourceAdapter = {
  config,
  async fetchItems(context) {
    const accessToken = process.env.THREADS_ACCESS_TOKEN;
    if (!accessToken) {
      return buildSkippedResult(
        config,
        "configuration-required",
        "THREADS_ACCESS_TOKEN 설정 후 Threads 공식 API를 실행합니다.",
      );
    }

    const queries = context.queryTerms.slice(0, THREADS_MAX_QUERIES);
    const fallbackQuery = context.canonicalSymbol || context.symbol;
    const selectedQueries = queries.length ? queries : [fallbackQuery];
    let lastUrl = buildKeywordUrl(selectedQueries[0], accessToken);

    try {
      const bundles = await mapWithConcurrency(selectedQueries, async (query) => {
        lastUrl = buildKeywordUrl(query, accessToken);
        const payload = await fetchJson(lastUrl);
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        return rows
          .map((row: ThreadsMedia) => toThreadsItem(row, "post"))
          .filter((item: RawCommunityItem | null): item is RawCommunityItem => item !== null);
      });
      const posts = bundles.flat();
      const conversationTargets = posts
        .filter((post) => (post.commentCount ?? 0) > 0)
        .slice(0, THREADS_MAX_CONVERSATION_POSTS);
      const conversationBundles = await mapWithConcurrency(
        conversationTargets,
        async (post) => {
          try {
            return fetchConversation(post, accessToken);
          } catch {
            return [];
          }
        },
      );

      return buildOkResult({
        config,
        context,
        url: lastUrl,
        items: [...posts, ...conversationBundles.flat()],
      });
    } catch (error) {
      return buildErrorResult(
        config,
        error instanceof Error ? error.message : "Threads 공식 API 수집 실패",
        lastUrl,
      );
    }
  },
};
