## Context

The app is a Next.js App Router project that already has market-data API routes and a price-based "곡소리 측정기" UI. The next product step is to measure community reaction before mixing it with trend-following signals.

The first implementation must be conservative because Korean community sources have different policy and technical constraints:

- Paxnet stock discussion is the primary MVP source because it is stock-code oriented and broadly crawlable under its current robots policy.
- Blind has high signal value through the public `주식·투자` channel, but access can be inconsistent and AI-related bot policies are restrictive. It should be treated as a gated spike before production use.
- Bobaedream is broadly crawlable and exposes posts/comments in HTML, but it is not stock-specific. It should be used for broad economic fear and retail pain signals only.
- Reddit should use the official Data API with OAuth, rate-limit handling, and deletion-aware retention behavior.
- Naver finance discussion boards and Clien are excluded from v1 automated ingestion because their crawl/policy posture is less suitable for a first implementation.

## Goals / Non-Goals

**Goals:**

- Add a community pain pipeline that can ingest public community text, normalize it, score it, and return a transparent 0-100 community pain score.
- Keep source adapters isolated so each site can be enabled, disabled, cached, or replaced independently.
- Make the first useful MVP possible with Paxnet and Reddit, while keeping Blind and Bobaedream as optional source adapters with explicit confidence levels.
- Return source evidence and scoring factors so the UI can explain why the score is high or low.
- Respect source policies by adding source gating, rate limiting, user-agent identification where applicable, caching, and minimal retention.

**Non-Goals:**

- Do not merge community pain and price pain into a single final trading score in v1.
- Do not implement login-based scraping, browser automation against authenticated sessions, mobile app reverse engineering, or private/internal API extraction.
- Do not include Naver finance discussion boards or Clien automated ingestion in v1.
- Do not add a new ML model dependency for v1; scoring should start as deterministic lexical/rule-based analysis.
- Do not make investment advice or automated trade execution decisions from community data.

## Decisions

### Decision: Source adapters with explicit source policy

Implement each source as an adapter behind a common contract:

```text
CommunitySourceAdapter
├─ sourceId
├─ policyStatus: allowed | spike | disabled
├─ fetch(query, options)
└─ normalize(rawItems)
```

Rationale: This prevents site-specific parsing and policy concerns from leaking into scoring or UI code. It also allows a source to be disabled without removing the whole feature.

Alternatives considered:

- Single scraper function for all sources: rejected because site behavior and policy constraints differ too much.
- Browser-only scraping: rejected because it is slow, brittle, and too close to authenticated/session behavior risks.

### Decision: Deterministic pain lexicon before ML

Start with a Korean/English pain lexicon and rule scoring:

- Loss confession: `물렸다`, `평단`, `-30%`, `계좌`, `녹았다`, `손절`.
- Panic/capitulation: `망했다`, `상폐`, `하한가`, `다 팔았다`, `포기`, `살려줘`, `구조대`.
- Leverage stress: `미수`, `신용`, `반대매매`, `마진콜`, `빚투`.
- Exhaustion/contrarian phrases: `다시는 안 산다`, `욕도 안 나온다`, `국장 접는다`.
- English equivalents for Reddit: `bagholder`, `down bad`, `capitulation`, `margin call`, `sold everything`, `never buying again`.

Rationale: The first question is whether community text contains useful signals. A transparent ruleset is easier to tune and debug than introducing a model immediately.

Alternatives considered:

- LLM-only sentiment scoring: rejected for cost, latency, reproducibility, and source-text retention concerns.
- Generic sentiment analysis: rejected because investor panic is domain-specific and often sarcastic.

### Decision: Score by factor, not only by sentiment

The API should return a score plus factor breakdown:

```text
Community pain score
├─ pain keyword density
├─ loss confession density
├─ leverage/liquidation stress
├─ negative-to-positive ratio
├─ mention/engagement strength
├─ source confidence
└─ source agreement
```

Rationale: "곡소리" is not the same as negative sentiment. A low-quality post with strong swear words should not outweigh multiple high-engagement loss-confession posts.

### Decision: Source confidence is part of the result

Each adapter must assign confidence based on:

- Whether data came from official API, static public HTML, or spike-only pages.
- Number of usable posts/comments.
- Freshness of posts.
- Whether the source is stock-specific or broad-market.

Rationale: A score from three Paxnet posts should not look as reliable as a score from many source-aligned posts across Paxnet and Reddit.

### Decision: Minimal caching and retention

Cache normalized summaries and scoring factors, not long-lived raw community text. For Reddit, follow official API guidance and avoid retaining deleted user content longer than necessary.

Rationale: This reduces policy and privacy risk while still allowing the UI to explain scoring.

### Decision: UI remains separate from price pain

The UI should show a separate `커뮤니티 곡소리` panel alongside the current price-based meter.

Rationale: Price pain and community pain are different signals. Keeping them separate avoids implying a trading recommendation before the combined model is proven.

## Risks / Trade-offs

- [Risk] Source policies or robots rules change after implementation.  
  → Mitigation: Keep source adapters gated and add `disabled` fallback behavior per source.

- [Risk] Community text contains sarcasm, spam, political noise, or pump-and-dump content.  
  → Mitigation: Use per-source weights, spam filters, repeated-text penalties, and factor transparency.

- [Risk] Blind or Toss-like dynamic pages require internal APIs or browser sessions.  
  → Mitigation: Treat them as spike-only unless public, stable, unauthenticated HTML/API access is confirmed.

- [Risk] Reddit OAuth setup delays implementation.  
  → Mitigation: Build the adapter interface and allow a disabled/mock mode until credentials are configured.

- [Risk] The score is mistaken for investment advice.  
  → Mitigation: Label the output as community reaction analysis and keep it separate from trading signals.

- [Risk] High-frequency fetching burdens third-party services.  
  → Mitigation: Add caching, request throttling, narrow symbol queries, and manual refresh intervals.

## Migration Plan

1. Add the community pain capability behind a new API route and UI panel.
2. Enable Paxnet first with conservative fetch limits and caching.
3. Add Reddit adapter in disabled/config-required mode, then enable when OAuth credentials exist.
4. Add Bobaedream as a broad-market keyword source if initial parsing is stable.
5. Run a Blind feasibility spike; only enable it if public unauthenticated pages provide reliable enough content.
6. Keep the existing price pain meter operational throughout; rollback is disabling the new panel/API route.

## Open Questions

- Which symbols should be used for the first manual validation set: Samsung Electronics, SK Hynix, Tesla, Nvidia, Bitcoin/crypto proxies, or another basket?
- Should v1 show raw evidence snippets, or only normalized reasons and counts to reduce retention/copyright risk?
- Should the first UI default to symbol-specific search only, or also include broad-market fear keywords like `반대매매`, `빚투`, `국장`, and `하한가`?
- What cache duration is acceptable for the user experience: 10 minutes, 30 minutes, or 1 hour?
