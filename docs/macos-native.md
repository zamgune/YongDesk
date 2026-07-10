# YongStockDesk macOS 네이티브 앱

`apps/macos/StockAnalysisMac`은 YongStockDesk의 SwiftUI 앱이다. 이관 호환성을 위해 런타임 이름은 아직 `StockAnalysis.app`, Swift 제품명은 `StockAnalysisMac`, 번들 ID는 `com.stockanalysis.mac`을 사용한다. Keychain과 App Support 데이터를 함께 마이그레이션하기 전에는 이 값을 개별적으로 바꾸지 않는다.

## 아키텍처

- SwiftUI가 메인 대시보드, 설정 시트, 메뉴바, 알림, Keychain과 App Support 상태를 담당한다.
- 기본 창은 `BeginnerFirstRootView`이며 차트·내 자산·전략·자동화·설정 workspace를 분리한다. API credential은 설정 workspace의 인라인 연결 관리에서 등록하고, 전략·점검·배포·로그 시트는 그대로 재사용한다.
- 앱은 번들된 TypeScript sidecar를 `127.0.0.1`의 임의 포트에서 자동 시작한다.
- sidecar는 `src/domain`, `src/use-cases`, `src/ports`와 `src/adapters`의 기존 분석·자동화·브로커 코드를 재사용한다.
- 앱은 `STOCK_ANALYSIS_STORAGE_ROOT`를 `~/Library/Application Support/com.stockanalysis.mac/sidecar`로 설정한다.
- broker credential 암호화 키는 App Support의 권한 제한 파일을 시작 경로로 사용하고 macOS Keychain에 함께 보관한다.
- 웹 route는 관리·fallback 용도로 유지하지만 Finder에서 실행한 앱은 별도의 Next 서버가 없어도 동작한다.

```text
SwiftUI
→ EngineClient
→ local_engine.mts
→ domain / use-cases
→ OrderIntent / RiskCheck
→ Toss·Upbit·Bithumb adapter
```

이 다이어그램은 전체 코드 경계를 나타낸다. 데스크톱 1.0.0 실행은 Toss와 코인 모두 adapter의 실제 submit 호출 전에 종료되고 paper 계좌에만 기록된다.

## 로컬 엔진

개발 중 sidecar만 실행하려면 다음 명령을 사용한다.

```bash
yarn local-engine --port=38771
curl http://127.0.0.1:38771/health
```

주요 endpoint 그룹은 다음과 같다.

| 그룹 | endpoint 예시 | 역할 |
|---|---|---|
| 상태 | `GET /health`, `GET /api/local/self-test` | sidecar와 앱 준비 상태 |
| 시장 | `GET /api/market/:symbol`, `GET /api/briefing/daily-market` | 분석과 시장 브리핑 |
| 멀티타임프레임 | `GET /api/local/analysis/workspace` | 1시간·4시간·일봉 분석, metadata와 단타·스윙·장기 계획 |
| 관심종목 | `GET/POST /api/local/watchlist`, `DELETE /api/local/watchlist/:id`, `GET /api/local/watchlist/summary` | 이 Mac의 관심종목 저장과 한국·미국 주식·코인 시세 요약 |
| 뉴스·민심 | `GET /api/news/events`, `GET /api/community-pain/:symbol` | 공식/RSS 뉴스와 종목별 커뮤니티 근거 |
| 대시보드 | `GET /api/dashboard/terminal`, `POST /api/dashboard/playbook` | macOS 대시보드와 포지션 메모 |
| Toss | `/api/local/broker/credentials`, `/api/local/toss/readiness` | credential과 계좌 준비 상태 |
| 주문 | `/api/local/holdings`, `/api/local/orders/precheck`, `/api/local/orders/sync` | 조회·사전검증·체결 동기화 |
| 전략 | `/api/local/strategy-configs`, `/:id/simulate` | 전략 CRUD와 시뮬레이션 |
| 자동화 | `/api/automation/cycle`, `/api/local/automation/scheduler` | 1회·연속 자동화 실행 |
| 안전 | `/api/local/live-trading`, `/api/local/worker-control`, `/api/local/kill-switch` | 제출 차단 경계 |
| 코인 | `/api/local/crypto-exchanges` | Upbit·Bithumb 연결과 사전검증 |

정확한 method와 요청 형식은 `scripts/local_engine.mts`와 `tests/local_engine.test.mts`를 기준으로 한다. endpoint를 변경하면 두 파일과 이 표를 함께 갱신한다.

대시보드와 페이퍼 상태는 `STOCK_ANALYSIS_STORAGE_ROOT` 아래에 저장된다. sidecar 로그는 기본적으로 `~/Library/Application Support/com.stockanalysis.mac/logs/sidecar.log`에 기록되며 앱의 `로그` 화면에서 확인할 수 있다.

## SwiftUI 기능

### 시작과 상태

- 첫 설치에서는 시작 안내가 자동으로 열리고 `삼성전자 예제 분석 시작`, `내 API 연결하기`, `나중에 연결` 중 필요한 경로를 선택한다. API 연결은 별도 팝업이 아니라 설정 workspace의 Toss·Upbit·Bithumb 인라인 연결 관리로 이동한다.
- credential은 선택 사항이다. API 키 없이도 삼성전자 Yahoo fallback 분석, Upbit 공개 분석, 공식/RSS 뉴스와 모의투자를 사용할 수 있다.
- 차트에서 현재 종목을 관심종목에 추가하면 최대 20개를 이 Mac의 sidecar 저장소에 보관한다. 관심종목은 현재가·등락·출처·갱신 상태만 비교하며, 행 선택 후 단건 분석으로 이동한다.
- Finder/Dock 실행 시 번들 sidecar를 우선 사용한다.
- 번들 경로가 없으면 빌드 시 저장한 저장소 경로와 사용자가 저장한 sidecar 경로를 순서대로 확인한다.
- 상단 상태와 메뉴바에서 sidecar, 모의투자, `PAPER ONLY`, 최근 갱신을 확인한다.
- `점검` 화면은 credential이 없을 때 외부 계좌를 호출하지 않고 안전 경로를 검증한다.
- `로그`와 운영 리포트는 secret, token과 raw account number를 제외한다.
- 일반 설정은 API 연결·알림·자동화 안전 상태만 제공한다. self-test와 진단 로그는 앱 메뉴의 `지원` 경로로, 배포·설치 검증은 개발·패키징 경로로 분리한다.

### 차트와 멀티타임프레임 분석

- 화면 차트는 `30일·90일·1년` 범위의 일봉과 최근 종가를 사용한다. 분석 workspace의 1시간·4시간봉을 실시간 스트리밍 차트로 표현하지 않는다.
- 주식 `source=auto`는 저장된 Toss credential이 있으면 Toss를 사용하고, 없거나 자동 조회가 실패하면 경고와 함께 Yahoo fallback을 사용한다. `source=toss`는 credential이 없거나 공식 조회가 실패하면 오류를 반환한다.
- Toss는 1분봉을 한국·미국 정규장 마감 시각에 맞춘 1시간봉으로 집계한다. 세션 길이 때문에 생기는 장 초반 30분 부분 봉은 snapshot과 경고에는 남기되 지표 계산에서는 제외한다. 현재 주봉도 다음 market week가 시작되기 전에는 확정하지 않는다.
- Upbit 공개 REST는 키 없이 KRW 마켓의 1시간·4시간·일봉을 제공한다. 코인은 일봉 방향, 4시간봉 진입과 1시간봉 재확인을 조합하고, 최근 무거래 시간 공백이 있으면 신규 진입 계획을 대기한다.
- 데스크톱 코인 분석은 `KRW-*` 입력만 허용한다. BTC·USDT 호가 시장과 KRW 시장을 같은 종목처럼 변환하지 않는다.
- 장기 계획의 10개월 이동평균은 진행 중인 현재 달을 제외한 완료 월 종가로 계산한다.
- 형성 중인 봉은 확정 분석에서 제외하고 `market`, `currency`, `dataSource`, `timeframe`, `quoteAt`, `stale`을 응답과 화면에 함께 표시한다.
- 단타·스윙·장기 계획은 구조선·ATR·장기 이동평균 조건으로 손절·익절을 계산한다. 데이터가 부족하거나 오래됐으면 고정 퍼센트로 채우지 않고 `계산 불가` 또는 `조건 대기`를 표시한다.
- 계획의 stop과 take-profit은 분석 조언이며 주문 제출이 아니다. `orderSubmissionAttempted=false`와 broker stop 부적격 계약을 유지한다.

### Toss 연결

- `검증 후 저장`은 token과 계좌 endpoint를 확인한 뒤 credential을 저장한다.
- 계좌가 하나면 자동 선택하고, 여러 개면 사용자가 조회·자동화 준비에 사용할 계좌를 선택한다.
- `공인 IP 확인`과 `IP 복사`는 Toss 개발자 콘솔의 허용 IP 등록을 돕는다.
- credential 삭제는 sidecar 암호화 저장소와 Keychain 백업을 함께 제거한다.
- 보유, 미체결, 매수 가능 금액, 매도 가능 수량과 주문 precheck는 실제 주문 없이 사용할 수 있다.
- 데스크톱 1.0.0은 운영자·사용자 toggle 값과 관계없이 Toss broker submit을 `501 not supported`로 차단한다.
- credential 등록 성공이나 계좌 조회는 live 제출 상태로 전환되지 않는다.

### 전략과 자동화

- 현재 엔진은 `ladder`, `percent-grid`, `loop-grid` 계약을 지원한다.
- 전략은 초안 저장, 현재 config hash 시뮬레이션, 명시적 활성화 순서로 준비한다.
- Beginner-first 전략 workspace는 주식 고정 수량(기본 1주), 코인 고정 주문금액(기본 50,000원), 현재가·기준가 분리, 차수별 예상 수량·노출을 표시한다. 기존 `orderSizing` 없는 전략은 금액 기준으로 호환한다.
- `현재 틱`, `발동가 테스트`와 자동화 dry-run은 broker submit을 호출하지 않는다.
- `자동화 1회 실행`은 데스크톱 1.0.0에서 주식과 코인 모두 paper 계좌만 갱신한다.
- 연속 scheduler는 기본 OFF이며 30초~15분 주기, 중복 cycle 방지, 마지막 결과와 다음 실행 시각을 저장한다.
- `보유 조회`, `사전검증`, `주문 동기화`는 각각 조회와 준비 작업이며 그 자체로 주문을 만들지 않는다.
- `전략 초안`은 현재 limit `OrderIntent`를 3차 `percent-grid` 초안으로 변환하며, 시뮬레이션과 활성화를 대신하지 않는다.
- Beginner-first 화면은 전략 설정의 시각적 진입점만 바꿨다. `초안 저장 → 조건 확인 → 시뮬레이션 → 활성화` 순서와 scheduler·worker·kill switch 동작은 변경하지 않았다.
- 추가매수 중단선은 신규 매수만 차단하고, 손절은 grid 평단·loop 진입가·ladder 보유 평단 기준으로 paper 전량 청산한다. 청산 실패는 `stop-loss-pending`으로 다음 cycle에 재시도하며, 완료 후 전략을 자동 일시중지하고 시뮬레이션을 폐기한다.

문장형 블록, 동적 1~20차와 직접 만들기는 아직 HTML 시안이다. [전략 조립기 명세](automation-strategy-builder-spec.md)를 SwiftUI와 엔진에 연결하기 전에는 현재 앱 기능으로 표시하지 않는다.

### Upbit·Bithumb

- 거래소별 credential을 검증하고 암호화 저장소와 Keychain에 보관한다.
- 계좌, 주문 가능 정보, REST 현재가 응답 신선도, 최소·최대 주문금액과 수수료를 확인하고 limit 주문 입력을 preview한다. Upbit 호가 단위는 deprecated chance 필드가 아니라 공식 `/v1/orderbook/instruments`의 `tick_size`를 사용하고, Bithumb은 chance 응답의 `price_unit`을 사용한다.
- 암호화폐 전략은 거래소를 명시하며 페이퍼 모드에서는 소수 수량을 지원한다.
- 1.0.0에서는 코인 실제 주문을 지원하지 않는다. 체결·부분체결·미체결·취소 동기화와 재시작 멱등성 검증 전까지 sidecar가 paper 자동화만 실행한다.
- 주문 사전검증 결과의 차단 사유와 현재가·최소 주문금액을 앱에서 표시하며, 이 점검은 broker submit을 호출하지 않는다.

거래소 연결 여부와 실시간 코인 차트는 현재 별도 기능이다. credential 검증이 성공해도 WebSocket 캔들 수집을 구현하기 전에는 실시간 차트로 표현하지 않는다.

### 뉴스와 커뮤니티 민심

- 공식 Federal Reserve, SEC, BEA RSS는 앱 실행 중 2분마다 polling한다. 동시 갱신은 single-flight로 합치고 실패 소스에는 지수 backoff를 적용한다. 이는 streaming 실시간 뉴스가 아니다.
- 선택 종목과 직접 연결된 ticker 뉴스, 금리·고용·GDP·무역 같은 거시 뉴스만 개요의 관련 뉴스에 표시한다.
- 커뮤니티 민심은 사용자가 `뉴스·알림 갱신`을 실행할 때 선택 종목 기준으로 계산한다. 정상 응답은 30분 캐시하지만 수동 갱신은 캐시를 우회하고, 소스 오류·timeout 응답은 1분만 캐시한다.
- `lowEvidence=true`이면 점수보다 `근거 부족`을 우선 표시한다. 민심 데이터는 참고 근거이며 `OrderIntent`, `RiskCheck` 또는 broker 입력으로 사용하지 않는다.
- Reddit은 뉴스·알림 화면에서 Client ID와 Secret을 입력하면 이 Mac의 Keychain에 저장하고 sidecar를 재시작해 공식 OAuth API로만 읽는다. 앱이 관리하는 sidecar는 부모 Reddit 환경변수를 상속하지 않으며, 환경변수 방식은 독립 실행한 개발용 sidecar에서만 유지한다. 설정이 없으면 `configuration-required`로 표시한다.

## 로컬 빌드와 검증

```bash
yarn mac:build
yarn mac:test
yarn mac:app
yarn mac:verify
yarn mac:verify:launch
```

- `mac:test`: Swift core와 앱 계약 smoke test
- `mac:app`: 현재 Mac 아키텍처용 `.app`과 번들 Node·sidecar 생성
- `mac:verify`: Info.plist, 코드 서명, Node, sidecar endpoint와 안전 경계 검증
- `mac:verify:launch`: 실제 앱 프로세스와 sidecar 자동 시작 검증

`yarn mac:open`은 앱을 다시 빌드하고 `dist/macos/StockAnalysis.app`을 연다.

## 릴리스 패키징

```bash
yarn mac:package:all
yarn mac:release-check:all --write-report
yarn mac:verify:dmg:all
yarn mac:verify:install:all --write-report --ui-smoke
```

개별 아키텍처가 필요하면 다음 명령을 사용한다.

```bash
yarn mac:package:arm64
yarn mac:package:x64
```

패키징 도구는 `.node-version`의 Node 22.17.0을 고정해 번들하고 실제 바이너리 버전이 다르면 실패한다. host 런타임이나 target 아키텍처가 다르면 공식 Node 런타임을 `.cache/macos-node-runtimes`에 내려받고 생성물을 `dist/macos/release`에 저장한다.

- `StockAnalysis-<version>-macos-<arch>.dmg`
- `StockAnalysis-<version>-macos-<arch>.zip`
- `StockAnalysis-<version>-macos-<arch>.manifest.json`
- `StockAnalysis-<version>-macos-release-index.json`
- `StockAnalysis-<version>-macos-release-check.json`
- `StockAnalysis-<version>-macos-install-verification.json`

DMG에는 `StockAnalysis.app`, `Applications` symlink와 설치 안내가 있어야 한다. install verifier는 DMG를 mount하고 임시 Applications 폴더로 복사한 앱의 번들 sidecar와 UI smoke를 확인한다.

각 아키텍처는 해당 DMG·ZIP·manifest 생성, checksum, `mac:verify:dmg:<arch>`와 `mac:verify:install:<arch> --ui-smoke` 결과가 모두 확인된 뒤에만 배포 가능으로 표시한다. 한 아키텍처의 성공으로 다른 아키텍처를 추정하지 않는다.

이전 터미널형 UI 패키지의 검증 결과는 Beginner-first UI 완료 증거로 재사용하지 않는다. Beginner-first AX smoke와 arm64/x64 1.0.0 설치 검증의 과거 결과는 [릴리스 이력](releases/v1.0.0.md)에 보존한다. UI, AXIdentifier, 번들 구성 또는 패키징 스크립트가 바뀌면 새 패키지에서 1440×900·최소 1024×720 UI smoke와 아키텍처별 설치 검증을 다시 실행해야 한다.

네트워크와 credential 없이 반복 가능한 UI·workspace 검증에는 `STOCK_ANALYSIS_MARKET_FIXTURE_MODE=1`을 사용한다. 이 모드는 응답에 fixture 출처와 경고를 표시하므로 실제 투자 판단이나 실 API 인수 증거로 사용하지 않는다. 로컬 준비 게이트와 실 API 인수 절차는 [데스크톱 실 API 인수 QA](desktop-live-api-qa.md)를 따른다.

## 공개 배포

로컬 기본 빌드는 ad-hoc 서명이다. 다른 Mac에서 Gatekeeper 경고 없이 배포하려면 Developer ID와 notarization 입력을 별도로 준비한다.

```bash
export MACOS_CODESIGN_IDENTITY="Developer ID Application: <Team Name> (<TEAMID>)"
export MACOS_NOTARIZE=1
export MACOS_NOTARYTOOL_PROFILE="<keychain-profile>"

yarn mac:signing-check --require-external
yarn mac:package:public
yarn mac:release-check:all --require-external
```

Apple ID 방식을 사용할 때는 `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`를 로컬 환경에서만 제공한다. 이 값과 notary credential을 문서, Git, 로그와 리포트에 넣지 않는다.

공개 준비 완료 판정에는 두 아키텍처의 checksum, `staplerValidated=true`, `gatekeeperAccepted=true`와 대상 Mac 설치 확인이 필요하다.

## 안전 경계

향후 실제 주문 제출을 다시 열 때는 다음 조건을 모두 통과해야 한다. 데스크톱 1.0.0은 이 경계 전에 broker submit을 강제 차단한다.

```text
OrderIntent
→ RiskCheck
→ verified credential
→ selected Toss account
→ operator live gate
→ user live gate
→ worker control
→ kill switch
→ broker adapter
```

- SwiftUI와 signal code는 broker를 직접 호출하지 않는다.
- 앱 실행, credential 등록, 시뮬레이션과 precheck는 주문 제출이 아니다.
- live gate가 열려 있어도 `RiskCheck`, worker pause와 kill switch는 제출을 차단한다.
- Toss API는 1.0.0에서 credential·계좌·보유·미체결·precheck 전용이며 broker submit 경로에 도달하지 않는다.
- 공식/RSS 뉴스 polling 실패는 분석·자동화를 중단시키지 않지만 실패 상태를 표시한다.
- 커뮤니티 민심은 주문 입력에 직접 사용하지 않는다.
- 코인 API는 1.0.0에서 조회·사전검증·paper 자동화 전용이며 broker submit 경로에 도달하지 않는다.
- 실제 계좌 조회가 가능한 상태에서는 자동 self-test가 사용자 의도 없이 계좌 endpoint를 호출하지 않는다.
