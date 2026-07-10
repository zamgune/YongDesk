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
import { redactSensitiveUrl } from "../src/lib/community-pain/adapters/shared.mts";
import { normalizeItems } from "../src/lib/community-pain/normalize.mts";
import { scoreCommunityPain } from "../src/lib/community-pain/scoring.mts";
import type { CommunityPainSourceResult } from "../src/lib/community-pain/types.mts";

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
