import {
  COMMUNITY_SOURCE_CONFIGS,
  REDDIT_MAX_COMMENT_POSTS,
  REDDIT_MAX_POSTS,
} from "../config.mts";
import type { CommunitySourceAdapter, RawCommunityItem } from "../types.mts";
import { buildErrorResult, buildOkResult, fetchJson, mapWithConcurrency } from "./shared.mts";

const config = COMMUNITY_SOURCE_CONFIGS.reddit;
const subreddits = ["stocks", "wallstreetbets", "investing"];
const userAgent = "CommunityPainMeter/1.0 by StockAnalysis";

const redditHeaders = {
  "User-Agent": userAgent,
  Accept: "application/json",
};

const parseSubmission = (data: Record<string, unknown>): RawCommunityItem | null => {
  if (!data || !subreddits.includes(String(data.subreddit).toLowerCase())) {
    return null;
  }
  return {
    sourceId: "reddit",
    id: String(data.id),
    kind: "post",
    title: String(data.title ?? ""),
    text: String(data.selftext ?? ""),
    url: `https://www.reddit.com${data.permalink ?? ""}`,
    author: typeof data.author === "string" ? data.author : undefined,
    authorHash: typeof data.author_fullname === "string" ? data.author_fullname : undefined,
    commentCount: typeof data.num_comments === "number" ? data.num_comments : 0,
    reactionCount: typeof data.score === "number" ? data.score : 0,
    createdAt:
      typeof data.created_utc === "number"
        ? new Date(data.created_utc * 1000).toISOString()
        : undefined,
  };
};

const parseCommentTree = (
  listing: unknown,
  parent: RawCommunityItem,
  depth = 0,
): RawCommunityItem[] => {
  const container = listing as { data?: { children?: unknown[] } } | undefined;
  const children = Array.isArray(container?.data?.children) ? container.data.children : [];
  const items: RawCommunityItem[] = [];
  for (const child of children) {
    const childData = (child as { kind?: string; data?: Record<string, unknown> })?.data;
    if (!childData || typeof childData.body !== "string") {
      continue;
    }
    items.push({
      sourceId: "reddit",
      id: `${parent.id}:comment:${String(childData.id)}`,
      parentId: parent.id,
      kind: depth > 0 ? "reply" : "comment",
      title: String(childData.body),
      url: `https://www.reddit.com${childData.permalink ?? ""}`,
      author: typeof childData.author === "string" ? childData.author : undefined,
      authorHash:
        typeof childData.author_fullname === "string" ? childData.author_fullname : undefined,
      reactionCount: typeof childData.score === "number" ? childData.score : 0,
      commentCount: 0,
      createdAt:
        typeof childData.created_utc === "number"
          ? new Date(childData.created_utc * 1000).toISOString()
          : parent.createdAt,
    });
    const replies = childData.replies;
    if (replies && typeof replies === "object" && depth < 1) {
      items.push(...parseCommentTree(replies, parent, depth + 1));
    }
  }
  return items;
};

const fetchRedditComments = async (post: RawCommunityItem) => {
  const match = post.url.match(/\/comments\/([^/]+)/);
  const id = match?.[1] ?? post.id;
  const url = `https://www.reddit.com/comments/${encodeURIComponent(id)}.json?limit=100&depth=2`;
  const payload = await fetchJson(url, { headers: redditHeaders });
  return Array.isArray(payload) && payload[1] ? parseCommentTree(payload[1], post) : [];
};

export const redditAdapter: CommunitySourceAdapter = {
  config,
  async fetchItems(context) {
    const items: RawCommunityItem[] = [];
    const query = context.queryTerms[0] || context.canonicalSymbol;
    const subredditQuery = subreddits.map((subreddit) => `subreddit:${subreddit}`).join(" OR ");
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(
      `(${query}) (${subredditQuery})`,
    )}&sort=new&t=week&limit=${REDDIT_MAX_POSTS}`;

    try {
      const payload = await fetchJson(url, { headers: redditHeaders });
      const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];
      for (const child of children) {
        const data = child?.data;
        const post = parseSubmission(data);
        if (post) items.push(post);
      }
      const commentTargets = items
        .filter((item) => (item.commentCount ?? 0) > 0)
        .slice(0, REDDIT_MAX_COMMENT_POSTS);
      const commentBundles = await mapWithConcurrency(
        commentTargets,
        async (post) => {
          try {
            return fetchRedditComments(post);
          } catch {
            return [];
          }
        },
      );
      return buildOkResult({ config, context, url, items: [...items, ...commentBundles.flat()] });
    } catch (error) {
      return buildErrorResult(
        config,
        error instanceof Error ? error.message : "Reddit 공개 JSON 수집 실패",
        url,
      );
    }
  },
};
