import { createHash } from "node:crypto";

import {
  COMMUNITY_SOURCE_CONFIGS,
  REDDIT_MAX_COMMENT_POSTS,
  REDDIT_MAX_POSTS,
} from "../config.mts";
import type { CommunitySourceAdapter, RawCommunityItem } from "../types.mts";
import {
  buildErrorResult,
  buildOkResult,
  buildSkippedResult,
  fetchJson,
  fetchWithTimeout,
  mapWithConcurrency,
} from "./shared.mts";

const config = COMMUNITY_SOURCE_CONFIGS.reddit;
const subreddits = ["stocks", "wallstreetbets", "investing"];
const userAgent = "YongStockDesk/1.0 macOS market research";
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

const redditHeaders = (accessToken: string) => ({
  "User-Agent": userAgent,
  Authorization: `Bearer ${accessToken}`,
  Accept: "application/json",
});

const getRedditAccessToken = async (clientId: string, clientSecret: string) => {
  const cacheKey = createHash("sha256").update(`${clientId}\0${clientSecret}`).digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken;
  }
  const response = await fetchWithTimeout("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!response.ok) {
    throw new Error(`Reddit OAuth HTTP ${response.status}`);
  }
  const payload = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Reddit OAuth access token missing");
  }
  const expiresIn = Number(payload.expires_in);
  tokenCache.set(cacheKey, {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3_600) * 1_000,
  });
  return payload.access_token;
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

const fetchRedditComments = async (post: RawCommunityItem, accessToken: string) => {
  const match = post.url.match(/\/comments\/([^/]+)/);
  const id = match?.[1] ?? post.id;
  const url = `https://oauth.reddit.com/comments/${encodeURIComponent(id)}?limit=100&depth=2&raw_json=1`;
  const payload = await fetchJson(url, { headers: redditHeaders(accessToken) });
  return Array.isArray(payload) && payload[1] ? parseCommentTree(payload[1], post) : [];
};

export const redditAdapter: CommunitySourceAdapter = {
  config,
  async fetchItems(context) {
    const clientId = process.env.REDDIT_CLIENT_ID?.trim();
    const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      return buildSkippedResult(
        config,
        "configuration-required",
        "앱 뉴스 화면의 Reddit OAuth Keychain 설정 또는 REDDIT_CLIENT_ID·REDDIT_CLIENT_SECRET이 필요합니다.",
      );
    }
    const items: RawCommunityItem[] = [];
    const query = context.queryTerms
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((term) => (/\s/.test(term) ? `\"${term.replaceAll("\"", "")}\"` : term))
      .join(" OR ") || context.canonicalSymbol;
    const subredditQuery = subreddits.map((subreddit) => `subreddit:${subreddit}`).join(" OR ");
    const postLimit = Math.min(REDDIT_MAX_POSTS, Math.max(1, context.limit));
    const url = `https://oauth.reddit.com/search?q=${encodeURIComponent(
      `(${query}) (${subredditQuery})`,
    )}&sort=new&t=week&limit=${postLimit}&raw_json=1`;

    try {
      const accessToken = await getRedditAccessToken(clientId, clientSecret);
      const payload = await fetchJson(url, { headers: redditHeaders(accessToken) });
      const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];
      for (const child of children) {
        const data = child?.data;
        const post = parseSubmission(data);
        if (post) items.push(post);
      }
      if (context.summaryOnly) {
        return buildOkResult({ config, context, url, items });
      }
      const commentTargets = items
        .filter((item) => (item.commentCount ?? 0) > 0)
        .slice(0, REDDIT_MAX_COMMENT_POSTS);
      let commentFailureCount = 0;
      const commentBundles = await mapWithConcurrency(
        commentTargets,
        async (post) => {
          try {
            return await fetchRedditComments(post, accessToken);
          } catch {
            commentFailureCount += 1;
            return [];
          }
        },
      );
      const result = buildOkResult({ config, context, url, items: [...items, ...commentBundles.flat()] });
      if (commentFailureCount === 0) {
        return result;
      }
      const completedRatio = commentTargets.length > 0
        ? (commentTargets.length - commentFailureCount) / commentTargets.length
        : 1;
      return {
        ...result,
        confidenceWeight: result.confidenceWeight * Math.max(0.5, completedRatio),
        reason: `Reddit 댓글 ${commentFailureCount}/${commentTargets.length}건 수집에 실패해 신뢰도를 낮췄습니다.`,
      };
    } catch (error) {
      return buildErrorResult(
        config,
        error instanceof Error ? error.message : "Reddit 공식 OAuth 수집 실패",
        url,
      );
    }
  },
};
