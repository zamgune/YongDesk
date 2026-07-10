# Community Pain Source Policy

Last checked: 2026-07-10 KST.

This note keeps the v1 community-source decisions close to the implementation.
The feature only reads public pages or official APIs, keeps short attribution,
and does not persist raw community text beyond the response/cache lifetime.

| Source | v1 status | Default | Notes |
| --- | --- | --- | --- |
| Paxnet 종목토론실 | allowed | enabled | `https://www.paxnet.co.kr/tbbs/list?tbbsType=L&id=<code>` exposes stock-specific post titles for Korean symbols. Samsung `005930` and SK Hynix `000660` pages returned list HTML with `best-title` anchors. |
| Reddit | allowed with configuration | disabled until configured | Uses OAuth `client_credentials`, `oauth.reddit.com` search/comments, and a descriptive User-Agent. The macOS News screen stores the optional Client ID/Secret in Keychain and injects them into the sidecar; development env vars remain supported. Public JSON scraping is not used. |
| Bobaedream | allowed supplemental | optional | Public community boards expose `bsubject` links and list/search parameters. This is broad-market chatter, not stock-specific evidence, so it is included only when broad sources are requested. |
| Blind | spike-only | disabled | Public web requests returned a block/error page. v1 does not scrape Blind automatically; it can surface a spike-only placeholder so a later manual/approved connector can feed it. |
| Naver Finance 종토방 | disabled | disabled | Excluded from v1 because scraping policy and anti-automation risk are higher than Paxnet for the first slice. |
| Clien | disabled | disabled | Excluded from v1 due login/community policy uncertainty and weak stock-specific targeting. |

Implementation defaults:

- Paxnet is the primary Korean stock-specific source.
- Reddit is implemented as a configuration-gated official OAuth adapter, not a public JSON scraper. Finder users can manage the optional credential from the News screen without shell environment setup.
- Bobaedream is supplemental and broad only.
- Blind, Naver Finance, and Clien must not be fetched by default.
- SwiftUI requests broad and spike-only sources only when explicitly enabled. The default selected-symbol refresh does not turn them on.
- Raw post bodies are not persisted by the macOS app; only the short scored response remains in the in-process cache. Successful responses use a 30-minute TTL, transient source failures use a 1-minute TTL, and an explicit app refresh bypasses completed cache entries.
