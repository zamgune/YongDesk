# macOS Native App

`apps/macos/StockAnalysisMac` is the native macOS shell for StockAnalysis.

## Architecture

- SwiftUI owns the macOS surface: main dashboard, menu bar extra, UserNotifications, local App Support storage, SQLite migration, and Keychain credential storage.
- The app starts the TypeScript sidecar on `127.0.0.1`. It reuses existing strategy, briefing, paper trading, Toss, `OrderIntent`, and `RiskCheck` code.
- The sidecar reads `STOCK_ANALYSIS_STORAGE_ROOT`; the Swift app sets this to `~/Library/Application Support/com.stockanalysis.mac/sidecar`.
- The sidecar receives `BROKER_CREDENTIAL_ENC_KEY` from the Swift app. The app keeps a local App Support key cache for non-blocking sidecar startup and mirrors the same key into macOS Keychain in the background.
- `npm run mac:app` creates `dist/macos/StockAnalysis.app` with the Swift executable, sidecar source, `node_modules`, and a bundled Node runtime for the target architecture.
- `npm run mac:verify` validates the app bundle, ad-hoc or Developer ID code signature, bundled Node runtime, sidecar health, Toss OpenAPI contract metadata, Toss credential state endpoint, strategy config endpoint, packaged magic-split strategy lifecycle, strategy backup/import safety, and the no-credential safe paths for Toss holdings/order precheck.
- `npm run mac:package` rebuilds the app, runs verification, and creates zip/dmg release artifacts plus a SHA-256 manifest under `dist/macos/release`.
- `npm run mac:package:arm64` creates an Apple Silicon release. `npm run mac:package:x64` creates an Intel Mac release by cross-building the Swift app and bundling the official Node.js x64 runtime.
- `npm run mac:package:all` creates both Apple Silicon and Intel releases, validates the combined release index, then rebuilds and verifies `dist/macos/StockAnalysis.app` for the current Mac architecture so Finder launch stays predictable.
- `npm run mac:release-check` reads the latest single-architecture release manifest. `npm run mac:release-check:all` validates the arm64/x64 release set for handoff to other Macs.
- Web routes remain available for fallback/admin workflows.

## Local Engine

```bash
npm run local-engine -- --port=38771
curl http://127.0.0.1:38771/health
curl "http://127.0.0.1:38771/api/news/events?limit=10"
curl "http://127.0.0.1:38771/api/dashboard/terminal?symbol=NVDA&session=US"
curl -X POST "http://127.0.0.1:38771/api/dashboard/playbook?symbol=NVDA" \
  -H "Content-Type: application/json" \
  -d '{"thesis":"AI leader momentum","entryRule":"limit pullback","workerMode":"paper-only"}'
curl "http://127.0.0.1:38771/api/briefing/daily-market?session=US&force=1"
curl "http://127.0.0.1:38771/api/market/NVDA?days=365&tf=1d"
curl "http://127.0.0.1:38771/api/local/holdings?symbol=NVDA"
curl -X POST "http://127.0.0.1:38771/api/local/orders/precheck" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"NVDA","side":"buy","quantity":1,"price":120,"currency":"USD"}'
```

Implemented endpoints:

- `GET /health`
- `GET /api/dashboard/terminal?symbol=NVDA&session=US`
- `POST /api/dashboard/playbook?symbol=NVDA`
- `GET /api/news/events?limit=50`
- `GET /api/briefing/daily-market?session=US|KR&force=1`
- `GET /api/market/:symbol?days=365&tf=1d`
- `GET /api/automation/health`
- `GET /api/local/broker/credentials`
- `GET /api/local/broker/account-preference`
- `PUT /api/local/broker/account-preference`
- `POST /api/local/broker/credentials`
- `DELETE /api/local/broker/credentials`
- `GET /api/local/holdings?symbol=NVDA`
- `POST /api/local/orders/precheck`
- `GET /api/local/orders/sync`
- `POST /api/local/orders/sync`
- `GET /api/local/strategy-configs`
- `POST /api/local/strategy-configs`
- `PUT /api/local/strategy-configs/:id`
- `DELETE /api/local/strategy-configs/:id`
- `POST /api/local/strategy-configs/:id/simulate`
- `POST /api/paper-trading/run`
- `POST /api/automation/cycle`

`/api/dashboard/terminal` is the macOS terminal dashboard contract. It returns the selected symbol, an `OrderIntent` preview, `RiskCheck`, local audit trail, risk scenarios, watchlist-level alert rules, watchlist alert evaluations, news credibility scores, pre-trade checklist, replay events, and the position playbook. Alert evaluations use market-data candles/volume when available, local paper positions, and stored official/RSS news events. Replay events share one timeline across candles, news, OrderIntent/RiskCheck audit entries, paper orders, and paper executions. `POST /api/dashboard/playbook` persists the editable position playbook. Dashboard state is stored under `STOCK_ANALYSIS_STORAGE_ROOT/dashboard`; paper order/execution replay reads from the existing paper-trading state store.

## Swift App

```bash
npm run mac:app
npm run mac:open
npm run mac:build
npm run mac:test
npm run mac:verify
npm run mac:package
npm run mac:package:all
npm run mac:package:arm64
npm run mac:package:x64
npm run mac:release-check
npm run mac:release-check:all -- --write-report
npm run toss:contract
swift run --package-path apps/macos/StockAnalysisMac StockAnalysisMac
```

`npm run mac:open` builds and opens `dist/macos/StockAnalysis.app`, so the app can be launched without keeping a Terminal sidecar running. Finder-launched apps use the bundled sidecar first, then the build-time repository path, then the saved App Support settings path. Sidecar stdout/stderr is written to `~/Library/Application Support/com.stockanalysis.mac/logs/sidecar.log`, and the app exposes a `로그` button in both the top bar and menu bar popover.

The `Toss` sheet owns the local live-trading setup for the native app:

- `검증 후 저장` verifies the Toss Open API client id/secret against token and account endpoints before saving anything.
- The saved Toss credential remains encrypted in the sidecar store with the app-managed broker encryption key. The key is file-permission protected for startup reliability and mirrored to macOS Keychain.
- `계좌 새로고침` queries Toss accounts from the sidecar, and `이 계좌 사용` stores the explicit `accountSeq` used by automation.
- If Toss returns exactly one brokerage account, the sidecar auto-selects it; if multiple brokerage accounts exist, live trading remains blocked until the user picks one.
- Local Toss diagnostics show live-gate, storage, kill-switch, worker, credential, and account readiness without automatically calling an external IP service.
- `운영 리포트 복사` writes a safe Toss readiness report to the clipboard. The report includes sidecar, credential status, Keychain backup, selected account sequence, public-IP status, local/user live gates, kill switch, worker state, readiness, gate reason, storage path, and next actions. It intentionally excludes client secrets, access tokens, refresh tokens, and raw account numbers.
- `Toss 문서` opens the official Toss Open API documentation for credential and allowed-IP setup.
- `공인 IP 확인` explicitly queries the current public egress IP, then exposes `IP 복사` so the user can paste it into the Toss Open API allowed-IP console before retrying credential or live-trading setup.
- `삭제` asks for confirmation before removing the Toss credential from both the sidecar encrypted store and macOS Keychain backup.
- The bundled sidecar exposes `GET /api/local/toss/openapi-contract` with the Toss OpenAPI 1.2.2 base URL, required endpoint list, and `X-Tossinvest-Account` account-header contract. `npm run toss:contract` compares this local contract against the official OpenAPI JSON without requiring credentials or touching a real account.
- `로컬 운영자 게이트 ENABLE_LIVE_TRADING` asks for confirmation before enabling, then stores an explicit app setting and restarts the sidecar with `ENABLE_LIVE_TRADING=true`; disabling it immediately closes live submission.
- `사용자 실거래 토글` asks for confirmation before enabling, calls the local sidecar, and remains disabled until a verified Toss credential and automation account selection both exist.
- Even when both toggles are on, live orders still pass through `OrderIntent`, `RiskCheck`, selected Toss account checks, and the kill switch.

The `전략` sheet owns local automation strategy setup:

- Users can create `순환분할`, `1% 순환`, `보수 분할`, or `사용자 지정` drafts without enabling live trading.
- A strategy must pass `시뮬레이션` with the current config hash before `활성화` is enabled.
- `현재 틱` and `발동가 테스트` are dry-run previews. They exercise strategy trigger logic without broker submission.
- `전략 리포트 복사` writes a safe strategy readiness report to the clipboard. It includes strategy count, active/draft/paused status, total exposure, simulation freshness, paper/live readiness, live-gate state, kill switch, worker state, blockers, and next actions.
- The report is for setup/debugging only and is not an order submission record.

- The `주문·리스크` tab exposes `자동화 점검`, which calls the automation cycle with `dryRun: true` so a user can confirm enabled strategies, credential state, live gate state, and zero broker submissions before pressing `자동화 1회 실행`.
- `자동화 1회 실행` asks for confirmation before running the live automation boundary. If live gate is open, only orders that pass `OrderIntent`, `RiskCheck`, Toss credential, selected account, and kill switch checks can be submitted.
- `연속 자동 실행` persists an explicit OFF/ON setting and a 30-second to 15-minute cadence in App Support. The sidecar restores enabled schedules after restart, prevents overlapping cycles, records the last result and next run, and stops scheduling when the app/sidecar exits. It defaults to OFF and requires a confirmation before enabling.
- The top command bar searches the bundled/local symbol master by Korean name, English name, or ticker. Results show bilingual names, market, and symbol together while keeping manual ticker entry as a fallback.
- The `코인` sheet supports separate Upbit and Bithumb credentials. It verifies each key with `GET /v1/accounts`, checks `GET /v1/orders/chance`, stores verified credentials in the encrypted sidecar store and macOS Keychain, and previews limit-order inputs without calling an order creation endpoint.
- Strategy drafts can target `CRYPTO` with an explicit `upbit` or `bithumb` execution venue. Crypto strategies reuse simulation, RiskCheck, balance precheck, kill switch, worker pause, and the continuous scheduler. They default to fractional-quantity paper trades.
- Crypto live submission requires both `ENABLE_LIVE_TRADING=true` and the separately persisted `ENABLE_CRYPTO_LIVE_TRADING=true` gate. Enabling the crypto gate requires a destructive confirmation in the app and restarts the sidecar. A current passing simulation and verified credential for the selected exchange are still mandatory.
- Live limit orders use Upbit `POST /v1/orders` or Bithumb `POST /v2/orders`. The adapter keeps the exchange-specific order fields and client IDs separate, rejects unsupported market buys, and records every submitted, blocked, rejected, or failed automation order in the local dashboard audit trail.
- A scheduled cycle uses the same automation boundary as the manual cycle. With the live gate closed it records paper automation; with the live gate open it can submit only after credential, selected account, `OrderIntent`, `RiskCheck`, worker control, and kill-switch checks pass.
- The `주문·리스크` tab also exposes `보유 조회` and `사전검증`. These call the local sidecar only: `보유 조회` reads Toss holdings for the selected symbol, while `사전검증` checks buying power or sellable quantity, records an order preview audit entry, and still does not submit a live order.
- `주문·리스크 > 리포트 복사` writes a safe order-readiness report to the clipboard. It includes the current `OrderIntent`, `RiskCheck`, pre-trade checklist, risk scenarios, Toss holding status, order precheck result, latest automation dry-run/run summary, live gate, kill switch, worker state, and next actions. It explicitly states that the report is not a broker order submission record.
- The fixed decision panel exposes `전략 초안`. It converts the current limit-price `OrderIntent` into a three-rung `magic-split`/`percent-grid` draft and saves it through the local strategy endpoint. Repeated clicks update an existing non-enabled matching draft instead of creating duplicate drafts; enabled strategies are never overwritten. The draft still needs simulation and explicit activation before the automation worker can use it, and the button never submits a broker order.
- The `점검` sheet includes a `Toss 조회/사전검증 안전` check. It verifies the no-credential path without external Toss calls, and skips automatic account queries when a credential is present so real account lookups only happen after the user explicitly clicks the relevant button.

`npm run mac:package` creates:

- `dist/macos/release/StockAnalysis-<version>-macos-<arch>.zip`
- `dist/macos/release/StockAnalysis-<version>-macos-<arch>.dmg`
- `dist/macos/release/StockAnalysis-<version>-macos-<arch>.manifest.json`
- `dist/macos/release/StockAnalysis-<version>-macos-install.md`
- `dist/macos/release/StockAnalysis-<version>-macos-release-index.json`

The DMG root contains `StockAnalysis.app`, an `Applications` symlink, and `StockAnalysis 설치 안내.txt`. A new Mac install should be a Finder flow: open the DMG, drag the app to `Applications`, double-click `StockAnalysis.app` from Applications, then run `배포 > 설치 후 점검`. The user should not need a Terminal command or a manually started sidecar.

The target architecture defaults to the build machine architecture. To build a specific Mac target:

```bash
npm run mac:package:all

# or build one target at a time
npm run mac:package:arm64
npm run mac:package:x64

# equivalent explicit form
MACOS_TARGET_ARCH=x64 npm run mac:package
```

When the target architecture differs from the build host, the package script downloads the matching official Node.js runtime into `.cache/macos-node-runtimes` and bundles that runtime into the app. `mac:package` keeps existing release artifacts for other architectures instead of deleting the full release folder. After `mac:package:all`, the release folder contains both architecture-specific DMG/ZIP sets while `dist/macos/StockAnalysis.app` is restored to the current Mac architecture for local launch and click testing.

The app also has an `앱 배포` sheet. It shows the same release status in the UI: artifact presence, signing identity, notarization status, Gatekeeper risk, target architecture, and the Toss/live-trading checklist for a new Mac. When a release index is present, the sheet recalculates SHA-256 for each Apple Silicon and Intel DMG/ZIP/manifest artifact and marks checksum mismatches as failed install readiness.

The release manifest also records install compatibility evidence:

- minimum macOS version required by the app bundle
- target and supported CPU architectures
- bundled Node.js version used by the sidecar
- package-time sidecar health verification result

The install guide and release index are regenerated on each package run. They summarize which DMG to send to Apple Silicon vs Intel Macs, include SHA-256 checksums for both architecture builds when present, and repeat the Toss credential, selected account, allowed IP, live gate, `OrderIntent`, `RiskCheck`, and kill switch checklist for a new Mac.

`npm run mac:release-check` treats missing sidecar verification evidence as an incomplete release. Re-run `npm run mac:package` if a manifest was created before this check existed.

Use `npm run mac:release-check:all -- --write-report` before sending the app to another Mac. It fails if either the Apple Silicon or Intel DMG/ZIP set is missing, if a checksum no longer matches, or if sidecar health verification is missing for either architecture. It also writes `StockAnalysis-<version>-macos-release-check.json` with the actual DMG `xcrun stapler validate` and `spctl --assess --type open --context context:primary-signature` results so a public release cannot rely only on a manifest flag. The app's `배포` sheet reads this report and shows the `staplerValidated`/`gatekeeperAccepted` evidence.

Use `npm run mac:verify:dmg:all` to mount every DMG from the latest release index and verify the Finder install layout. It fails if the DMG root is missing `StockAnalysis.app`, the `Applications` symlink, `StockAnalysis 설치 안내.txt`, or the app `Info.plist`. `npm run mac:package:all` runs this check automatically after release checksum verification and before rebuilding the local host app.

Use `npm run mac:verify:install:all -- --ui-smoke` to mount every DMG, copy `StockAnalysis.app` into a temporary `Applications` folder, and verify the copied app. This proves the handoff contains a runnable bundled Node sidecar rather than only a correctly named app directory. The verifier checks the Toss OpenAPI contract, magic-split strategy lifecycle and draft-only backup/import, persistent continuous-scheduler ON/OFF, no-credential holdings/order-precheck/order-sync safety, app launch, menu bar, first-run actions, public-IP check/copy, reports, automation confirmation, logs, and kill-switch guards. `uiSmokeChecks.tossCredentialControls=true` means invalid Toss credentials were rejected without leaving the no-credential safety state; `uiSmokeChecks.continuousAutomationScheduler=true` means the scheduler confirmation, ON state, and stop-to-OFF flow were clicked in the shipped app. The other `uiSmokeChecks` and `sidecarEndpointChecks` fields provide equivalent per-action evidence. DMG SHA-256 is verified outside the installed app through the release index and release-check report. An installed app cannot copy the checksum of the source DMG after it has been separated from that file, so `releaseChecksumCopy` is only exercised by the host release-management smoke and is not required for copied-app verification. `npm run mac:package:all` writes the combined evidence to `StockAnalysis-<version>-macos-install-verification.json`, which the app's `배포` sheet reads as install readiness.

Without a Developer ID certificate the app is ad-hoc signed. That is useful for local testing and direct transfer, but another Mac can still show Gatekeeper quarantine warnings. For external distribution, set these environment variables before `npm run mac:package:all`:

```bash
export MACOS_CODESIGN_IDENTITY="Developer ID Application: <Team Name> (<TEAMID>)"
export MACOS_NOTARIZE=1

# Option A: notarytool keychain profile
export MACOS_NOTARYTOOL_PROFILE="stockanalysis-notary"

# Option B: Apple ID credentials
export APPLE_ID="<apple-id@example.com>"
export APPLE_TEAM_ID="<TEAMID>"
export APPLE_APP_PASSWORD="<app-specific-password>"

npm run mac:signing-check
npm run mac:package:all
npm run mac:signing-check -- --require-external
npm run mac:release-check:all -- --require-external
```

`npm run mac:signing-check` verifies local macOS signing tools, the configured `MACOS_CODESIGN_IDENTITY`, matching Developer ID identities in Keychain, and whether notarytool credentials were provided. The command stays non-blocking for local ad-hoc builds; add `-- --require-external` when you want CI or a release checklist to fail unless Developer ID signing and notarization inputs are ready.

`npm run mac:package:public` is the release gate for a handoff without Gatekeeper warnings. It first requires Developer ID/notary readiness, then runs `npm run toss:contract` against the official Toss OpenAPI JSON before packaging both architectures and running the external release check. The final public gate requires each architecture DMG to report `staplerValidated=true` and `gatekeeperAccepted=true` from the actual file on disk.

The package script signs with hardened runtime when `MACOS_CODESIGN_IDENTITY` is set, submits the dmg with `xcrun notarytool` when `MACOS_NOTARIZE=1`, staples the notarization ticket, and writes checksums to the manifest.

The current release artifacts are architecture-specific because the app bundles a Node runtime. Run `npm run mac:package:all` when you need to support Apple Silicon and Intel Macs. A single universal `.app` would still require a universal Node runtime bundle.

## Safety Boundaries

- Live trading is not enabled by the Swift app alone.
- Real orders still pass through the existing TypeScript gate: `ENABLE_LIVE_TRADING=true`, feature access, verified Toss credentials, selected Toss automation account, user live-trading toggle, precheck, `OrderIntent`, and `RiskCheck`.
- Official/RSS news polling is best-effort and does not block analysis or automation.
