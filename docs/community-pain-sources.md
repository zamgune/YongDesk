# Community Pain Source Policy

Last checked: 2026-05-20 KST.

This note keeps the v1 community-source decisions close to the implementation.
The feature only reads public pages or official APIs, keeps short attribution,
and does not persist raw community text beyond the response/cache lifetime.

| Source | v1 status | Default | Notes |
| --- | --- | --- | --- |
| Paxnet 종목토론실 | allowed | enabled | `https://www.paxnet.co.kr/tbbs/list?tbbsType=L&id=<code>` exposes stock-specific post titles for Korean symbols. Samsung `005930` and SK Hynix `000660` pages returned list HTML with `best-title` anchors. |
| Reddit | allowed with configuration | disabled until configured | Use official Reddit JSON/OAuth-compatible reads only. v1 returns `configuration-required` unless `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are present. |
| Bobaedream | allowed supplemental | optional | Public community boards expose `bsubject` links and list/search parameters. This is broad-market chatter, not stock-specific evidence, so it is included only when broad sources are requested. |
| Blind | spike-only | disabled | Public web requests returned a block/error page. v1 does not scrape Blind automatically; it can surface a spike-only placeholder so a later manual/approved connector can feed it. |
| Naver Finance 종토방 | disabled | disabled | Excluded from v1 because scraping policy and anti-automation risk are higher than Paxnet for the first slice. |
| Clien | disabled | disabled | Excluded from v1 due login/community policy uncertainty and weak stock-specific targeting. |

Implementation defaults:

- Paxnet is the primary Korean stock-specific source.
- Reddit is implemented as a configuration-gated adapter, not a scraper.
- Bobaedream is supplemental and broad only.
- Blind, Naver Finance, and Clien must not be fetched by default.
