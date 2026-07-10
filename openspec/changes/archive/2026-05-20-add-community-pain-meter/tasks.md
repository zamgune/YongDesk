## 1. Source Feasibility

- [x] 1.1 Document current source policy status for Paxnet, Reddit, Bobaedream, Blind, Naver finance, and Clien in a repo-local reference note.
- [x] 1.2 Verify Paxnet symbol discussion page structure for at least Samsung Electronics and SK Hynix.
- [x] 1.3 Verify Bobaedream board/search structure for broad-market keywords such as `빚투`, `반대매매`, `주식`, and `하한가`.
- [x] 1.4 Verify Blind public `주식·투자` pages with a spike script or manual fetch and decide whether it remains `spike` or becomes `disabled` for v1.
- [x] 1.5 Define source enablement defaults: Paxnet enabled, Reddit config-required, Bobaedream optional, Blind spike-only, Naver/Clien disabled.

## 2. Core Data Model

- [x] 2.1 Create community pain TypeScript types for source config, raw item, normalized item, score factors, source breakdown, and API response.
- [x] 2.2 Add a source adapter interface with `sourceId`, `policyStatus`, `fetch`, and `normalize` responsibilities.
- [x] 2.3 Add source-level error and skipped-source result types so one failing source does not fail the whole score response.
- [x] 2.4 Add symbol/query normalization helpers for Korean stock codes, US tickers, and broad-market keyword queries.

## 3. Scoring Engine

- [x] 3.1 Create Korean and English pain lexicons for loss confession, panic/capitulation, leverage stress, exhaustion, positive relief, and pump noise.
- [x] 3.2 Implement text normalization for Korean/English community text, numeric loss percentages, repeated characters, and common slang.
- [x] 3.3 Implement factor scoring for pain keyword density, loss confession density, leverage stress, negative-positive ratio, engagement strength, and source confidence.
- [x] 3.4 Implement final 0-100 community pain score and level labels: `평온`, `한숨`, `비명 전조`, `곡소리`, `대합창`.
- [x] 3.5 Add low-evidence confidence reduction and source-agreement bonus logic.
- [x] 3.6 Add focused unit tests for scoring edge cases, sarcasm-like text, low evidence volume, and mixed positive/negative posts.

## 4. Source Adapters

- [x] 4.1 Implement Paxnet adapter with conservative fetch limits, HTML parsing, engagement extraction, and per-source error handling.
- [x] 4.2 Implement Bobaedream broad-market adapter with keyword-based fetch/search flow and lower source weighting.
- [x] 4.3 Implement Reddit adapter in config-required mode using official OAuth/Data API settings and rate-limit metadata handling.
- [x] 4.4 Add disabled adapter behavior for Naver finance and Clien so they are visible as intentionally excluded sources.
- [x] 4.5 Add Blind spike adapter or spike report result without enabling it by default.

## 5. API Integration

- [x] 5.1 Add `GET /api/community-pain/[symbol]` or equivalent App Router API endpoint.
- [x] 5.2 Validate query params for symbol, market, source selection, and optional broad-market mode.
- [x] 5.3 Add in-memory or framework-level caching with a conservative default TTL.
- [x] 5.4 Return source breakdown, skipped sources, score factors, level label, confidence, and updated timestamp.
- [x] 5.5 Ensure API failures return user-safe messages and do not expose raw parser/internal errors.

## 6. UI Integration

- [x] 6.1 Add a `커뮤니티 곡소리` panel separate from the existing price-based pain meter.
- [x] 6.2 Show community score, confidence, source availability, and top scoring factors.
- [x] 6.3 Show short attributed evidence snippets or normalized reasons without republishing full posts/comments.
- [x] 6.4 Add loading, empty, partial-source, and source-disabled states.
- [x] 6.5 Keep the existing price chart and price pain flow operational while adding the community panel.

## 7. Validation

- [x] 7.1 Run lint and build after implementation.
- [x] 7.2 Manually validate community pain output for at least Samsung Electronics, SK Hynix, Tesla, Nvidia, and one broad-market keyword query.
- [x] 7.3 Verify that disabled sources are not fetched.
- [x] 7.4 Verify that one failing source does not fail the full API response.
- [x] 7.5 Verify the UI in browser at desktop and mobile widths.
