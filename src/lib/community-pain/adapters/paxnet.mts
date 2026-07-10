import {
  COMMUNITY_SOURCE_CONFIGS,
  PAXNET_MAX_COMMENT_PAGES_PER_POST,
  PAXNET_MAX_COMMENT_POSTS,
  PAXNET_MAX_DETAIL_FETCHES,
  PAXNET_MAX_PAGES,
} from "../config.mts";
import type { CommunitySourceAdapter, RawCommunityItem } from "../types.mts";
import {
  buildErrorResult,
  buildOkResult,
  cleanTitle,
  fetchHtml,
  fetchWithTimeout,
  isOlderThanWindow,
  mapWithConcurrency,
  parsePaxnetDate,
} from "./shared.mts";

const config = COMMUNITY_SOURCE_CONFIGS.paxnet;

const buildListUrl = (symbol: string, page: number) => {
  const baseUrl = `https://www.paxnet.co.kr/tbbs/list?tbbsType=L&id=${encodeURIComponent(symbol)}`;
  return page > 1 ? `${baseUrl}&page=${page}` : baseUrl;
};

const buildViewUrl = (symbol: string, seq: string) =>
  `https://www.paxnet.co.kr/tbbs/view?id=${encodeURIComponent(symbol)}&seq=${encodeURIComponent(seq)}`;

const decodeJsString = (value: string) =>
  value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'");

export const parsePaxnetArticleText = (html: string) => {
  const contentMatch =
    html.match(/bbsWrtCntnVO[\s\S]{0,800}?cntn\s*:\s*"(.*?)"\s*[,}]/i) ??
    html.match(/bbsWrtCntnVO[\s\S]{0,800}?cntn\s*:\s*'(.*?)'\s*[,}]/i);
  if (contentMatch) {
    return cleanTitle(decodeJsString(contentMatch[1]));
  }
  const metaMatch = html.match(/<meta[^>]+name=["']tbbsContents["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  if (metaMatch) {
    const parts = cleanTitle(metaMatch[1]).split("|");
    return parts[2] ?? parts.join(" ");
  }
  return "";
};

export const parsePaxnetComments = (
  html: string,
  parent: RawCommunityItem,
): RawCommunityItem[] => {
  const items: RawCommunityItem[] = [];
  const blockPattern = /<(?:li|div)[^>]*(?:reply|comment|cmt)[^>]*>([\s\S]*?)<\/(?:li|div)>/gi;
  let index = 0;
  for (const blockMatch of html.matchAll(blockPattern)) {
    const text = cleanTitle(blockMatch[1])
      .replace(/^(답글|댓글|수정|삭제|신고)\s*/g, "")
      .trim();
    if (text.length < 4 || text.length > 500 || /로그인|비밀번호|댓글쓰기/.test(text)) {
      continue;
    }
    index += 1;
    items.push({
      sourceId: "paxnet",
      id: `${parent.id}:comment:${index}`,
      parentId: parent.id,
      kind: "comment",
      title: text,
      url: `${parent.url}#comment-${index}`,
      createdAt: parent.createdAt,
      commentCount: 0,
      reactionCount: 0,
    });
  }
  return items;
};

export const parsePaxnetItems = (
  html: string,
  pageUrl: string,
): RawCommunityItem[] => {
  const items: RawCommunityItem[] = [];
  const blockPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  for (const blockMatch of html.matchAll(blockPattern)) {
    const block = blockMatch[1];
    const titleMatch = block.match(
      /<a[^>]+class=["']best-title["'][^>]+href=["']javascript:bbsWrtView\((\d+)\);["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!titleMatch) {
      continue;
    }
    const title = cleanTitle(titleMatch[2]);
    if (!title) {
      continue;
    }
    const symbolMatch = pageUrl.match(/[?&]id=([^&]+)/);
    const symbol = symbolMatch ? decodeURIComponent(symbolMatch[1]) : "";
    const seq = titleMatch[1];
    const dateMatch = block.match(/data-date-format=["']([^"']+)["']/i);
    const commentMatch = block.match(/class=["']comment-num["'][^>]*>\s*(\d+)\s*<\/b>/i);
    const reactionMatch = block.match(/<div[^>]+class=["']like["'][^>]*>[\s\S]*?(\d+)\s*<\/div>/i);
    items.push({
      sourceId: "paxnet",
      id: seq,
      title,
      url: symbol ? buildViewUrl(symbol, seq) : `${pageUrl}#${seq}`,
      kind: "post",
      commentCount: commentMatch ? Number.parseInt(commentMatch[1], 10) : 0,
      reactionCount: reactionMatch ? Number.parseInt(reactionMatch[1], 10) : 0,
      createdAt: dateMatch ? parsePaxnetDate(dateMatch[1]) : undefined,
    });
  }
  return items;
};

const fetchPaxnetDetailBundle = async (
  item: RawCommunityItem,
  symbol: string,
  includeComments: boolean,
) => {
  const detailUrl = buildViewUrl(symbol, item.id);
  const html = await fetchHtml(detailUrl);
  const articleText = parsePaxnetArticleText(html);
  const detailedItem: RawCommunityItem = {
    ...item,
    text: articleText || item.text,
    url: detailUrl,
  };
  if (!includeComments) {
    return [detailedItem];
  }
  const comments: RawCommunityItem[] = [];
  for (let page = 1; page <= PAXNET_MAX_COMMENT_PAGES_PER_POST; page += 1) {
    const response = await fetchWithTimeout("https://www.paxnet.co.kr/tbbs/bbsCommentList", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 CommunityPainMeter/1.0",
        Accept: "text/html, */*; q=0.01",
      },
      body: new URLSearchParams({
        id: symbol,
        seq: item.id,
        page: String(page),
        orderType: "0",
        commentSeq: "",
        modCmt: "",
        regmnId: "",
      }),
      next: { revalidate: 1800 },
    });
    if (!response.ok) {
      break;
    }
    const pageComments = parsePaxnetComments(await response.text(), detailedItem);
    comments.push(...pageComments);
    if (!pageComments.length) {
      break;
    }
  }
  return [detailedItem, ...comments];
};

export const paxnetAdapter: CommunitySourceAdapter = {
  config,
  async fetchItems(context) {
    if (!/^\d{6}$/.test(context.canonicalSymbol)) {
      return buildOkResult({
        config,
        context,
        url: "https://www.paxnet.co.kr/tbbs/list",
        items: [],
      });
    }

    const url = buildListUrl(context.canonicalSymbol, 1);

    try {
      const items: RawCommunityItem[] = [];
      let lastUrl = url;
      const pageLimit = Math.min(PAXNET_MAX_PAGES, Math.max(2, Math.ceil(context.limit / 15)));
      const detailLimit = Math.min(PAXNET_MAX_DETAIL_FETCHES, Math.max(6, Math.ceil(context.limit / 4)));
      const commentPostLimit = Math.min(PAXNET_MAX_COMMENT_POSTS, Math.max(3, Math.ceil(detailLimit / 2)));
      for (let page = 1; page <= pageLimit; page += 1) {
        lastUrl = buildListUrl(context.canonicalSymbol, page);
        const pageItems = parsePaxnetItems(await fetchHtml(lastUrl), lastUrl);
        items.push(...pageItems);
        const datedItems = pageItems.filter((item) => item.createdAt);
        if (
          page > 1 &&
          items.filter((item) => item.createdAt && !isOlderThanWindow(item.createdAt, context)).length >=
            Math.min(context.limit, 40) &&
          datedItems.length &&
          datedItems.every((item) => isOlderThanWindow(item.createdAt, context))
        ) {
          break;
        }
      }
      const detailCandidates = items
        .filter((item) => !item.createdAt || !isOlderThanWindow(item.createdAt, context))
        .sort((left, right) => (right.commentCount ?? 0) - (left.commentCount ?? 0))
        .slice(0, detailLimit);
      const commentCandidateIds = new Set(
        detailCandidates
          .filter((item) => (item.commentCount ?? 0) > 0)
          .slice(0, commentPostLimit)
          .map((item) => item.id),
      );
      const detailBundles = await mapWithConcurrency(
        detailCandidates,
        async (item) => {
          try {
            return fetchPaxnetDetailBundle(
              item,
              context.canonicalSymbol,
              commentCandidateIds.has(item.id),
            );
          } catch {
            return [item];
          }
        },
      );
      return buildOkResult({
        config,
        context,
        url: lastUrl,
        items: [...items, ...detailBundles.flat()],
      });
    } catch (error) {
      return buildErrorResult(
        config,
        error instanceof Error ? error.message : "팍스넷 수집 실패",
        url,
      );
    }
  },
};
