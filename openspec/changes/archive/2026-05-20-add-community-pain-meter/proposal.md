## Why

The current pain meter only reflects market price/indicator damage, but the intended product direction is to quantify investor "곡소리" from actual community reactions before combining it with trend-following signals. Starting with community reaction analysis first lets the project validate whether public posts and comments provide a useful contrarian sentiment signal.

## What Changes

- Add a community pain analysis capability that collects or ingests public investor reactions and converts them into a 0-100 "community 곡소리" score.
- Support a first Korean-source set focused on sources that are technically and policy-wise practical for an MVP:
  - Paxnet stock discussion as the primary Korean stock-specific source.
  - Blind stock/investment public pages as a secondary investor psychology source, gated behind a feasibility spike.
  - Bobaedream public boards as a supplemental broad-market fear/economy signal.
- Support Reddit as the first overseas source through the official Data API path rather than page scraping.
- Keep Naver finance discussion boards and Clien out of the first implementation path unless a later policy/feasibility review explicitly allows them.
- Add source-level transparency so the UI can show where each score came from, what text patterns contributed, and how confident the reading is.
- Preserve the existing price-based pain meter as a separate signal; the first implementation should not merge price and community scores into a single final score yet.

## Capabilities

### New Capabilities

- `community-pain-meter`: Community reaction ingestion, normalization, scoring, and UI/API reporting for investor "곡소리" signals.

### Modified Capabilities

- None.

## Impact

- New server-side modules for community source adapters, text normalization, Korean/English pain lexicons, scoring, and source confidence.
- New API route for fetching community pain by symbol/query.
- Home page or a related dashboard panel will show community pain separately from the existing price-based meter.
- Requires careful rate limiting, caching, source attribution, and robots/terms-aware source gating.
- Reddit integration will require OAuth/client configuration before live API use.
