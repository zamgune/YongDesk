import {
  BOBAEDREAM_MAX_KEYWORDS,
  BOBAEDREAM_MAX_DETAIL_FETCHES,
  BOBAEDREAM_MAX_PAGES_PER_KEYWORD,
  COMMUNITY_SOURCE_CONFIGS,
} from "../config.mts";
import type { CommunitySourceAdapter, RawCommunityItem } from "../types.mts";
import {
  buildErrorResult,
  buildOkResult,
  buildSkippedResult,
  cleanTitle,
  fetchHtml,
  isOlderThanWindow,
  mapWithConcurrency,
  parseKoreanMonthDayDate,
} from "./shared.mts";

const config = COMMUNITY_SOURCE_CONFIGS.bobaedream;

const buildSearchUrl = (keyword: string, page = 1) =>
  `https://www.bobaedream.co.kr/board/bulletin/list.php?code=strange&s_select=Subject&s_key=${encodeURIComponent(
    keyword,
  )}&or_gu=10&or_se=desc&pagescale=30${page > 1 ? `&page=${page}` : ""}`;

export const parseBobaedreamArticleText = (html: string) => {
  const bodyMatch =
    html.match(/<div[^>]+class=["'][^"']*(?:bodyCont|docuArea|viewCont)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  return bodyMatch ? cleanTitle(bodyMatch[1]) : "";
};

export const parseBobaedreamComments = (
  html: string,
  parent: RawCommunityItem,
): RawCommunityItem[] => {
  const items: RawCommunityItem[] = [];
  const commentPattern = /<dd[^>]+id=["']small_cmt_([^"']+)["'][^>]*>([\s\S]*?)<\/dd>/gi;
  let index = 0;
  for (const commentMatch of html.matchAll(commentPattern)) {
    const text = cleanTitle(commentMatch[2])
      .replace(/^(답글|댓글|수정|삭제|신고)\s*/g, "")
      .trim();
    if (text.length < 4 || text.length > 500) {
      continue;
    }
    index += 1;
    items.push({
      sourceId: "bobaedream",
      id: `${parent.id}:comment:${commentMatch[1]}`,
      parentId: parent.id,
      kind: index > 1 && /re|reply|depth|indent/i.test(commentMatch[0]) ? "reply" : "comment",
      title: text,
      url: `${parent.url}#small_cmt_${commentMatch[1]}`,
      createdAt: parent.createdAt,
      commentCount: 0,
      reactionCount: 0,
    });
  }
  return items;
};

export const parseBobaedreamItems = (
  html: string,
  nowTimestamp: number,
): RawCommunityItem[] => {
  const items: RawCommunityItem[] = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of html.matchAll(rowPattern)) {
    const row = rowMatch[1];
    const titleMatch = row.match(
      /<a[^>]+class=["']bsubject["'][^>]+href=["']([^"']+)["'][^>]*(?:title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!titleMatch) {
      continue;
    }
    const title = cleanTitle(titleMatch[2] || titleMatch[3]);
    if (!title || title.includes("[공지]")) {
      continue;
    }
    const href = titleMatch[1].startsWith("http")
      ? titleMatch[1]
      : `https://www.bobaedream.co.kr${titleMatch[1]}`;
    try {
      const parsedHref = new URL(href);
      if (parsedHref.protocol !== "https:" || parsedHref.hostname !== "www.bobaedream.co.kr") {
        continue;
      }
    } catch {
      continue;
    }
    const dateMatch = row.match(/<td[^>]+class=["']date["'][^>]*>([\s\S]*?)<\/td>/i);
    const commentMatch = row.match(/<strong class=["']totreply["']>(\d+)<\/strong>/i);
    const recommMatch = row.match(/<td[^>]+class=["']recomm["'][^>]*>[\s\S]*?(\d+)[\s\S]*?<\/td>/i);
    items.push({
      sourceId: "bobaedream",
      id: href,
      title,
      url: href,
      kind: "post",
      commentCount: commentMatch ? Number.parseInt(commentMatch[1], 10) : 0,
      reactionCount: recommMatch ? Number.parseInt(recommMatch[1], 10) : 0,
      createdAt: dateMatch ? parseKoreanMonthDayDate(cleanTitle(dateMatch[1]), nowTimestamp) : undefined,
    });
  }
  return items;
};

const fetchBobaedreamDetailBundle = async (item: RawCommunityItem) => {
  const html = await fetchHtml(item.url);
  const text = parseBobaedreamArticleText(html);
  const detailedItem: RawCommunityItem = {
    ...item,
    text: text || item.text,
  };
  return [detailedItem, ...parseBobaedreamComments(html, detailedItem)];
};

export const bobaedreamAdapter: CommunitySourceAdapter = {
  config,
  async fetchItems(context) {
    if (!context.includeBroad) {
      return buildSkippedResult(config, "skipped", "광역 커뮤니티 소스는 broad=1일 때만 실행합니다.");
    }

    const keywords = [
      ...context.queryTerms.slice(0, 2),
      "빚투",
      "반대매매",
      "하한가",
      "주식",
    ];
    const items: RawCommunityItem[] = [];
    let lastUrl = buildSearchUrl(keywords[0] ?? "주식");

    try {
      for (const keyword of keywords.slice(0, BOBAEDREAM_MAX_KEYWORDS)) {
        for (let page = 1; page <= BOBAEDREAM_MAX_PAGES_PER_KEYWORD; page += 1) {
          lastUrl = buildSearchUrl(keyword, page);
          const pageItems = parseBobaedreamItems(await fetchHtml(lastUrl), context.nowTimestamp);
          items.push(...pageItems);
          const datedItems = pageItems.filter((item) => item.createdAt);
          if (
            page > 1 &&
            datedItems.length &&
            datedItems.every((item) => isOlderThanWindow(item.createdAt, context))
          ) {
            break;
          }
        }
      }
      const detailCandidates = items
        .filter((item) => !item.createdAt || !isOlderThanWindow(item.createdAt, context))
        .sort((left, right) => (right.commentCount ?? 0) - (left.commentCount ?? 0))
        .slice(0, BOBAEDREAM_MAX_DETAIL_FETCHES);
      const detailBundles = await mapWithConcurrency(
        detailCandidates,
        async (item) => {
          try {
            return fetchBobaedreamDetailBundle(item);
          } catch {
            return [item];
          }
        },
      );
      return buildOkResult({ config, context, url: lastUrl, items: [...items, ...detailBundles.flat()] });
    } catch (error) {
      return buildErrorResult(
        config,
        error instanceof Error ? error.message : "보배드림 수집 실패",
        lastUrl,
      );
    }
  },
};
