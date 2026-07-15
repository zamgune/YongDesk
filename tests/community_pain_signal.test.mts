import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBobaedreamArticleText,
  parseBobaedreamComments,
  parseBobaedreamItems,
} from "../src/lib/community-pain/adapters/bobaedream.mts";
import {
  parsePaxnetArticleText,
  parsePaxnetComments,
  parsePaxnetItems,
} from "../src/lib/community-pain/adapters/paxnet.mts";
import { redditAdapter } from "../src/lib/community-pain/adapters/reddit.mts";
import { redactSensitiveUrl } from "../src/lib/community-pain/adapters/shared.mts";
import {
  buildQueryTerms,
  normalizeCommunitySymbol,
  normalizeItems,
} from "../src/lib/community-pain/normalize.mts";
import {
  buildCommunitySentimentDistribution,
  classifyCommunityPost,
} from "../src/lib/community-pain/distribution.mts";
import { scoreCommunityPain } from "../src/lib/community-pain/scoring.mts";
import type {
  CommunityPainSourceResult,
  RawCommunityItem,
  SourceFetchContext,
} from "../src/lib/community-pain/types.mts";

const createSource = (titles): CommunityPainSourceResult => ({
  id: "paxnet",
  label: "팍스넷 종목토론실",
  policyStatus: "allowed",
  status: "ok",
  url: "https://www.paxnet.co.kr/tbbs/list?tbbsType=L&id=005930",
  itemCount: titles.length,
  postCount: titles.length,
  commentItemCount: 0,
  replyCount: 0,
  candidateCount: titles.length,
  recentItemCount: titles.length,
  confidenceWeight: 1,
  dateParseCoverage: 0,
  items: normalizeItems(
    titles.map((title, index) => ({
      sourceId: "paxnet",
      id: String(index),
      kind: "post",
      title,
      url: "https://example.com",
      commentCount: index + 1,
    })),
    ["005930", "삼성전자", "삼전"],
  ),
});

const createSourceFromItems = (items): CommunityPainSourceResult => ({
  id: "paxnet",
  label: "팍스넷 종목토론실",
  policyStatus: "allowed",
  status: "ok",
  url: "https://www.paxnet.co.kr/tbbs/list?tbbsType=L&id=005930",
  itemCount: items.length,
  postCount: items.filter((item) => item.kind === "post").length,
  commentItemCount: items.filter((item) => item.kind === "comment").length,
  replyCount: items.filter((item) => item.kind === "reply").length,
  candidateCount: items.length,
  recentItemCount: items.length,
  confidenceWeight: 1,
  dateParseCoverage: 0,
  items: normalizeItems(items, ["005930", "삼성전자", "삼전"]),
});

test("crypto community symbols normalize to the base asset", () => {
  for (const symbol of ["KRW-BTC", "BTC-USD", "BTCUSDT"]) {
    assert.equal(normalizeCommunitySymbol(symbol, "CRYPTO"), "BTC");
    assert.deepEqual(buildQueryTerms(symbol, "CRYPTO"), ["BTC"]);
  }
});

test("paxnet parser extracts createdAt from data-date-format", () => {
  const items = parsePaxnetItems(
    `
    <li>
      <a class="best-title" href="javascript:bbsWrtView(150357590213952);">삼성전자 손절 고민</a>
      <b class="comment-num">7</b>
      <div class="like"><span>추천 </span>3</div>
      <div class="date"><span class="data-date-format" data-date-format="Wed May 20 22:02:49 KST 2026"></span></div>
    </li>
    `,
    "https://www.paxnet.co.kr/tbbs/list?tbbsType=L&id=005930",
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].createdAt, "2026-05-20T13:02:49.000Z");
  assert.equal(items[0].commentCount, 7);
  assert.equal(items[0].reactionCount, 3);
});

test("community source URLs redact API tokens", () => {
  const redacted = redactSensitiveUrl(
    "https://graph.threads.net/v1.0/post/replies?access_token=secret-token&fields=text&api_key=another-secret",
  );

  assert.equal(
    redacted,
    "https://graph.threads.net/v1.0/post/replies?access_token=REDACTED&fields=text&api_key=REDACTED",
  );
  assert.ok(!redacted?.includes("secret-token"));
  assert.ok(!redacted?.includes("another-secret"));
});

test("reddit reports partial comment failures and lowers confidence", async () => {
  const previousClientId = process.env.REDDIT_CLIENT_ID;
  const previousClientSecret = process.env.REDDIT_CLIENT_SECRET;
  const originalFetch = globalThis.fetch;
  const nowTimestamp = Date.now();
  process.env.REDDIT_CLIENT_ID = `test-client-${nowTimestamp}`;
  process.env.REDDIT_CLIENT_SECRET = "test-secret";
  const responses = [
    Response.json({ access_token: "test-token", expires_in: 3600 }),
    Response.json({
      data: {
        children: [{
          data: {
            subreddit: "stocks",
            id: "post-1",
            title: "NVDA investors discuss the latest move",
            selftext: "NVDA outlook",
            permalink: "/r/stocks/comments/post-1/nvda/",
            num_comments: 2,
            score: 5,
            created_utc: nowTimestamp / 1_000,
          },
        }],
      },
    }),
    Response.json({ error: "rate limited" }, { status: 429 }),
  ];
  globalThis.fetch = (async () => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected Reddit test request");
    return response;
  }) as typeof fetch;
  const context: SourceFetchContext = {
    symbol: "NVDA",
    canonicalSymbol: "NVDA",
    market: "US",
    queryTerms: ["NVDA"],
    includeBroad: false,
    includeSpikeSources: false,
    limit: 60,
    lookbackHours: 24,
    collectionWindowHours: 72,
    nowTimestamp,
    sinceTimestamp: nowTimestamp - 72 * 60 * 60 * 1_000,
    primarySinceTimestamp: nowTimestamp - 24 * 60 * 60 * 1_000,
  };
  try {
    const result = await redditAdapter.fetchItems(context);
    assert.equal(result.status, "ok", result.reason);
    assert.equal(result.confidenceWeight, 0.36);
    assert.match(result.reason ?? "", /댓글 1\/1건 수집에 실패/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousClientId === undefined) delete process.env.REDDIT_CLIENT_ID;
    else process.env.REDDIT_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.REDDIT_CLIENT_SECRET;
    else process.env.REDDIT_CLIENT_SECRET = previousClientSecret;
  }
});

test("paxnet parser extracts detail body and comments", () => {
  const text = parsePaxnetArticleText(`
    <meta name="tbbsContents" content="삼성전자|제목|본문 손절 반대매매 공포|005930|user" />
  `);
  const comments = parsePaxnetComments(
    `<li class="reply"><p>살려주세요 계좌박살입니다</p></li>`,
    {
      sourceId: "paxnet",
      id: "150",
      kind: "post",
      title: "삼성전자",
      url: "https://www.paxnet.co.kr/tbbs/view?id=005930&seq=150",
    },
  );

  assert.equal(text, "본문 손절 반대매매 공포");
  assert.equal(comments.length, 1);
  assert.equal(comments[0].kind, "comment");
});

test("bobaedream parser infers Korean month/day dates", () => {
  const items = parseBobaedreamItems(
    `
    <tr>
      <td><a class="bsubject" href="/view?code=strange&No=1">주식 반대매매 공포</a>
      <span class="Comment">(<strong class="totreply">2</strong>)</span></td>
      <td class="date">05/19</td>
      <td class="recomm"><font>4</font></td>
    </tr>
    `,
    Date.parse("2026-05-20T03:00:00.000Z"),
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].createdAt, "2026-05-18T15:00:00.000Z");
  assert.equal(items[0].commentCount, 2);
  assert.equal(items[0].reactionCount, 4);
});

test("bobaedream parser extracts article body and comment blocks", () => {
  const parent = {
    sourceId: "bobaedream",
    id: "https://www.bobaedream.co.kr/view?code=strange&No=1",
    kind: "post",
    title: "주식 반대매매",
    url: "https://www.bobaedream.co.kr/view?code=strange&No=1",
  };
  const text = parseBobaedreamArticleText(
    `<meta property="og:description" content="파킹하기 좋은 나라">`,
  );
  const comments = parseBobaedreamComments(
    `<dd id="small_cmt_252116">주식 물렸다 살려주세요</dd>`,
    parent,
  );

  assert.equal(text, "파킹하기 좋은 나라");
  assert.equal(comments.length, 1);
  assert.equal(comments[0].kind, "comment");
});

test("community pain score rises with loss and leverage stress", () => {
  const calm = scoreCommunityPain([
    createSource(["삼성전자 반등 기대", "실적 회복 가능성", "신고가 돌파 기대"]),
  ]);
  const panic = scoreCommunityPain([
    createSource([
      "삼성전자 손절했습니다 계좌가 녹았습니다",
      "빚투 반대매매 때문에 죽겠습니다",
      "삼전 물렸다 구조대 언제 오나요",
      "폭락 공포 손실 복구가 안 됩니다",
      "미수 신용 반대매매 패닉 투매 폭락 하락",
    ]),
  ]);

  assert.ok(panic.score > calm.score);
  assert.equal(panic.painScore, panic.score);
  assert.equal(panic.sentimentRegime, "panic");
  assert.ok(panic.factors.find((factor) => factor.key === "leverageStress")?.score ?? 0);
});

test("low evidence caps confidence and score", () => {
  const result = scoreCommunityPain([createSource(["손절 망했다"])]);

  assert.equal(result.lowEvidence, true);
  assert.equal(result.sentimentRegime, "low_evidence");
  assert.ok(result.confidence < 70);
});

test("a healthy single source is usable with a bounded confidence", () => {
  const result = scoreCommunityPain([
    createSource(["반등 기대", "상승 기대", "회복 기대", "신고가 기대", "일반 의견"]),
  ]);

  assert.equal(result.lowEvidence, false);
  assert.ok(result.confidence <= 70);
});

test("gajua score rises with pump and fomo language", () => {
  const result = scoreCommunityPain([
    createSource([
      "삼전 가즈아 풀매수 간다",
      "상한가 10배 숏스퀴즈 기대",
      "신고가 돌파 지금 안 사면 바보",
      "몰빵 yolo to the moon",
      "따상 100배 무조건 간다",
    ]),
  ]);

  assert.ok(result.gajuaScore >= 45);
  assert.equal(result.sentimentRegime, "hype");
  assert.ok(result.gajuaFactors.find((factor) => factor.key === "fomoConviction")?.score ?? 0);
});

test("pain and gajua together marks divided sentiment", () => {
  const result = scoreCommunityPain([
    createSource([
      "손절했습니다 계좌 녹았습니다 폭락 공포",
      "빚투 반대매매 죽겠습니다 투매 하락",
      "가즈아 풀매수 10배 간다",
      "상한가 숏스퀴즈 몰빵",
      "폭락 공포 손실이지만 to the moon",
      "물렸다 구조대 패닉 그래도 신고가 돌파",
    ]),
  ]);

  assert.equal(result.sentimentRegime, "divided");
  assert.ok(result.divisionScore >= 45);
});

test("mixed pump noise and negative posts stays below panic", () => {
  const result = scoreCommunityPain([
    createSource([
      "삼전 가즈아 상한가 10배 간다",
      "폭락 무섭지만 반등 기대",
      "하락 위험 그래도 회복 가능",
      "신고가 돌파 기대",
      "손실은 있지만 몰빵은 안 합니다",
    ]),
  ]);

  assert.ok(result.score < 65);
  assert.ok(result.gajuaScore > 0);
});

test("strong comment signals are not diluted by neutral posts", () => {
  const neutralPosts = Array.from({ length: 200 }, (_, index) => ({
    sourceId: "paxnet",
    id: `post-${index}`,
    kind: "post",
    title: `삼성전자 일반 의견 ${index}`,
    url: "https://example.com",
  }));
  const painComments = Array.from({ length: 10 }, (_, index) => ({
    sourceId: "paxnet",
    id: `comment-${index}`,
    parentId: `post-${index}`,
    kind: "comment",
    title: "물렸다 손절 반대매매 살려주세요 계좌박살",
    url: "https://example.com#comment",
  }));
  const result = scoreCommunityPain([createSourceFromItems([...neutralPosts, ...painComments])]);

  assert.ok(result.signalItemCount >= 10);
  assert.ok(result.painScore >= 25);
});

const distributionNow = Date.parse("2026-07-15T12:00:00.000Z");

type DistributionEntry = {
  id?: string;
  kind?: RawCommunityItem["kind"];
  title: string;
  author?: string;
  ageHours?: number;
  createdAt?: string;
  engagement?: number;
};

const createDistributionItems = (entries: DistributionEntry[]) => normalizeItems(
  entries.map((entry, index) => ({
    sourceId: "paxnet" as const,
    id: entry.id ?? `distribution-${index}`,
    kind: entry.kind ?? "post",
    title: entry.title,
    url: `https://example.com/${entry.id ?? index}`,
    author: entry.author,
    createdAt: entry.ageHours === undefined
      ? entry.createdAt
      : new Date(distributionNow - entry.ageHours * 3_600_000).toISOString(),
    commentCount: entry.engagement ?? 0,
  })),
  ["005930", "삼성전자", "삼전"],
);

test("community distribution classifies Korean and English direction with word boundaries", () => {
  const cases = [
    ["삼전 가즈아 상한가 간다", "bullish_hype"],
    ["NVDA is bullish and going to the moon", "bullish_hype"],
    ["삼성전자 폭락으로 손절했다", "bearish_criticism"],
    ["this is a scam stock headed for a crash", "bearish_criticism"],
    ["삼전 가즈아 하지만 폭락도 걱정", "mixed"],
    ["실적 발표 자료를 읽어 봤다", "neutral"],
    ["moonlight software update", "neutral"],
  ];

  for (const [title, expected] of cases) {
    const [item] = createDistributionItems([{ title, ageHours: 1 }]);
    assert.equal(classifyCommunityPost(item, ["삼전", "삼성전자", "NVDA"]).category, expected);
  }
});

test("profanity is independent while target-specific criticism is bearish", () => {
  const [generic, bullish, targeted] = createDistributionItems([
    { title: "씨발 진짜 미쳤다", ageHours: 1 },
    { title: "미쳤다 삼전 가즈아", ageHours: 1 },
    { title: "삼성전자 경영진은 무능한 쓰레기", ageHours: 1 },
  ]);

  const genericResult = classifyCommunityPost(generic, ["삼성전자", "삼전"]);
  const bullishResult = classifyCommunityPost(bullish, ["삼성전자", "삼전"]);
  const targetedResult = classifyCommunityPost(targeted, ["삼성전자", "삼전"]);

  assert.equal(genericResult.category, "neutral");
  assert.ok(genericResult.toxicity > 0);
  assert.equal(bullishResult.category, "bullish_hype");
  assert.ok(bullishResult.toxicity > 0);
  assert.equal(targetedResult.category, "bearish_criticism");
});

test("explicit negation does not reverse-match the negated direction", () => {
  const [notRising, notBearish] = createDistributionItems([
    { title: "삼전 상승 아니다", ageHours: 1 },
    { title: "NVDA is not bearish", ageHours: 1 },
  ]);

  assert.equal(classifyCommunityPost(notRising, ["삼전"]).category, "bearish_criticism");
  assert.equal(classifyCommunityPost(notBearish, ["NVDA"]).category, "neutral");
});

test("distribution uses dated top-level deduped posts and caps each author at three", () => {
  const entries: DistributionEntry[] = [
    ...Array.from({ length: 4 }, (_, index) => ({
      title: `최근 중립 의견 ${index}`,
      ageHours: index + 1,
      author: `recent-${index}`,
    })),
    { title: "최근 중립 의견 0", ageHours: 30, author: "duplicate-author" },
    ...Array.from({ length: 5 }, (_, index) => ({
      title: `과거 가즈아 의견 ${index}`,
      ageHours: 30 + index,
      author: "burst-author",
    })),
    { title: "과거 폭락 의견", ageHours: 40, author: "older-author" },
    { title: "댓글 폭락", ageHours: 2, author: "commenter", kind: "comment" },
    { title: "날짜 없는 가즈아", author: "unknown-date" },
  ];
  const result = buildCommunitySentimentDistribution(createDistributionItems(entries), {
    nowTimestamp: distributionNow,
    queryTerms: ["삼전", "삼성전자"],
  });

  assert.equal(result.effectiveWindowHours, 72);
  assert.equal(result.sampleCount, 8);
  assert.equal(result.status, "low_evidence");
  assert.equal(result.uniqueAuthorCount, 6);
  assert.equal(result.counts.bullish_hype, 3);
  assert.equal(result.counts.bearish_criticism, 1);
  assert.equal(result.counts.neutral, 4);
  assert.equal(Object.values(result.ratios ?? {}).reduce((sum, value) => sum + value, 0), 100);
});

test("distribution keeps the 24-hour bucket once five usable posts exist", () => {
  const items = createDistributionItems([
    ...Array.from({ length: 5 }, (_, index) => ({
      title: `최근 가즈아 ${index}`,
      ageHours: index + 1,
      author: `recent-${index}`,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      title: `과거 폭락 ${index}`,
      ageHours: 30 + index,
      author: `older-${index}`,
    })),
  ]);
  const result = buildCommunitySentimentDistribution(items, { nowTimestamp: distributionNow });

  assert.equal(result.effectiveWindowHours, 24);
  assert.equal(result.sampleCount, 5);
  assert.equal(result.counts.bullish_hype, 5);
  assert.equal(result.counts.bearish_criticism, 0);
});

test("available ratios always total 100 and evidence is capped by category", () => {
  const items = createDistributionItems([
    ...Array.from({ length: 7 }, (_, index) => ({
      title: `가즈아 상한가 ${index}`,
      ageHours: index + 1,
      author: `bull-${index}`,
      engagement: index,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      title: `폭락 손절 ${index}`,
      ageHours: index + 1,
      author: `bear-${index}`,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      title: `가즈아 폭락 혼재 ${index}`,
      ageHours: index + 1,
      author: `mixed-${index}`,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      title: `일반 의견 ${index}`,
      ageHours: index + 1,
      author: `neutral-${index}`,
    })),
  ]);
  const result = buildCommunitySentimentDistribution(items, { nowTimestamp: distributionNow });

  assert.equal(result.status, "ready");
  assert.equal(result.sampleCount, 20);
  assert.equal(Object.values(result.ratios ?? {}).reduce((sum, value) => sum + value, 0), 100);
  for (const category of ["bullish_hype", "bearish_criticism", "mixed", "neutral"]) {
    assert.ok(result.evidence.filter((entry) => entry.category === category).length <= 3);
  }
});

test("unavailable distribution does not present zero-percent ratios", () => {
  const result = buildCommunitySentimentDistribution(createDistributionItems([
    { title: "가즈아", ageHours: 1 },
    { title: "폭락", ageHours: 2 },
    { title: "날짜 없는 글" },
    { title: "댓글", ageHours: 3, kind: "comment" },
  ]), { nowTimestamp: distributionNow });

  assert.equal(result.status, "unavailable");
  assert.equal(result.sampleCount, 2);
  assert.equal(result.ratios, null);
  assert.equal(result.uniqueAuthorCount, null);
});
