# Community Sentiment Source Policy

Last checked: 2026-07-15 KST.

This note keeps the community-source decisions for the existing community-pain
endpoint and the native sentiment radar close to the implementation. The
feature only reads public pages or official APIs, keeps short attribution, and
does not persist raw community text beyond the response/cache lifetime.

| Source | v1 status | Default | Notes |
| --- | --- | --- | --- |
| Paxnet 종목토론실 | allowed | enabled | `https://www.paxnet.co.kr/tbbs/list?tbbsType=L&id=<code>` exposes stock-specific post titles for Korean symbols. Samsung `005930` and SK Hynix `000660` pages returned list HTML with `best-title` anchors. |
| Reddit | allowed with configuration | disabled until configured | Uses OAuth `client_credentials`, `oauth.reddit.com` search/comments, and a descriptive User-Agent. The macOS News screen stores the optional Client ID/Secret in Keychain and injects them into the sidecar; development env vars remain supported. Public JSON scraping is not used. |
| Bobaedream | allowed supplemental | optional | Public community boards expose `bsubject` links and list/search parameters. This is broad-market chatter, not stock-specific evidence, so it remains available only to the legacy community-pain request and is not used for sentiment-overview ratios. |
| Blind | spike-only | disabled | Public web requests returned a block/error page. v1 does not scrape Blind automatically; it can surface a spike-only placeholder so a later manual/approved connector can feed it. |
| Naver Finance 종토방 | disabled | disabled | Excluded from v1 because scraping policy and anti-automation risk are higher than Paxnet for the first slice. |
| Clien | disabled | disabled | Excluded from v1 due login/community policy uncertainty and weak stock-specific targeting. |

## Native sentiment radar contract

`GET /api/local/sentiment-overview?symbol=<symbol>&market=KR|US[&refresh=1]`
returns the selected instrument's Korean and global community buckets plus a
KR/US market comparison. `/api/community-pain/:symbol` remains compatible for
the existing chart panel.

Each dated top-level post is assigned to exactly one ratio bucket:

- `bullish_hype`: 상승 기대·가즈아 표현만 감지
- `bearish_criticism`: 하락 기대·손실·종목 또는 경영진 비난만 감지
- `mixed`: 상승과 비관 표현을 모두 감지
- `neutral`: 어느 방향도 감지하지 못함

General profanity does not decide direction and contributes only to
`toxicity`. Identical normalized text is deduplicated and each author can
contribute at most three top-level posts. Comments and replies can contribute
to `pain`, `fomo`, and evidence links, but not to the four-way ratio
denominator. Largest-remainder rounding keeps available integer ratios at a
total of exactly 100.

The default window is 24 hours. If fewer than five eligible posts exist, the
whole bucket is recalculated over 72 hours and reports
`effectiveWindowHours=72`. Instrument status is `ready` at 20 or more posts,
`low_evidence` at 5-19, and `unavailable` below 5.

The four-way values are experimental **collected-reaction ratios**, not people,
unique-user estimates, polling, or a representative public-opinion measure.
The UI must label them `수집된 반응 비율` and must not render an unavailable
bucket as 0%.

## Coverage matrix

| Instrument or aggregate | Korean community | Global community | Current limitation |
| --- | --- | --- | --- |
| Korean stock | Paxnet | Reddit OAuth search using symbol-master English names and aliases | Global coverage requires Reddit configuration. |
| US stock | unsupported | Reddit OAuth search | Korean community returns `unsupported_source_coverage`; it is not inferred from translated Reddit text. |
| Korean market top 30 | Paxnet | not applicable | Universe requires Toss `MARKET_TRADING_AMOUNT`, one-day ranking. |
| US market top 30 | not applicable | Reddit OAuth | Universe requires the same Toss ranking contract and configured Reddit OAuth. |

Market comparison uses exactly the Toss one-day
`MARKET_TRADING_AMOUNT` top 30 for each market. Korean constituents are scored
from Paxnet and US constituents from Reddit, then averaged with equal weight
per covered instrument rather than pooling posts. A market is `ready` at 20 or
more covered instruments and 100 or more posts, `low_evidence` at 10 or more
covered instruments and 50 or more posts, and `unavailable` otherwise.

If Toss ranking or Reddit authentication is unavailable, the native screen
hides the entire KR/US market comparison and explains the connection
requirement. It must not substitute Yahoo ranks, a seed list, or a fixed stock
universe. The unsupported US-stock/Korean-community bucket likewise remains
explicitly unavailable instead of using another source silently.

## Cache, persistence, and safety

- Instrument successes use a 30-minute TTL, transient failures a 1-minute TTL,
  and concurrent requests share a single flight. `refresh=1` refreshes only the
  selected instrument and is rate-limited to one forced request per 30 seconds.
- Market aggregates use a 30-minute TTL, a 5-minute failure backoff, and source
  concurrency of two instruments per market. The first request returns
  `warming` immediately and starts one background aggregation.
- Only aggregate ratios, universe metadata, and status are persisted in App
  Support. A persisted aggregate less than 24 hours old may be returned as
  `stale` while a background refresh runs. Raw titles, bodies, comments, and
  replies are not persisted.
- Sentiment, pain, FOMO, and toxicity are research context only. They must not
  feed a buy signal, strategy, `OrderIntent`, `RiskCheck`, broker submit, or any
  order/automation path.

## Implementation defaults

- Paxnet is the primary Korean stock-specific source.
- Reddit is implemented as a configuration-gated official OAuth adapter, not a public JSON scraper. Finder users can manage the optional credential from the News screen without shell environment setup.
- Bobaedream is supplemental and broad only.
- Blind, Naver Finance, and Clien must not be fetched by default.
- SwiftUI requests broad and spike-only sources only when explicitly enabled. The default selected-symbol refresh does not turn them on.
- Raw post bodies are not persisted by the macOS app. The legacy community-pain response remains in the in-process 30-minute success/1-minute failure cache; the native radar follows the cache and persistence rules above.
