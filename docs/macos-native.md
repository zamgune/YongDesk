# YongStockDesk macOS 네이티브 앱

`apps/macos/StockAnalysisMac`은 YongStockDesk의 SwiftUI 앱이다. 이관 호환성을 위해 런타임 이름은 아직 `StockAnalysis.app`, Swift 제품명은 `StockAnalysisMac`, 번들 ID는 `com.stockanalysis.mac`을 사용한다. Keychain과 App Support 데이터를 함께 마이그레이션하기 전에는 이 값을 개별적으로 바꾸지 않는다.

## 아키텍처

- SwiftUI가 메인 대시보드, 설정 시트, 메뉴바, 알림, Keychain과 App Support 상태를 담당한다.
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

- Finder/Dock 실행 시 번들 sidecar를 우선 사용한다.
- 번들 경로가 없으면 빌드 시 저장한 저장소 경로와 사용자가 저장한 sidecar 경로를 순서대로 확인한다.
- 상단 상태와 메뉴바에서 sidecar, 모의투자, live gate, 최근 갱신을 확인한다.
- `점검` 화면은 credential이 없을 때 외부 계좌를 호출하지 않고 안전 경로를 검증한다.
- `로그`와 운영 리포트는 secret, token과 raw account number를 제외한다.

### Toss 연결

- `검증 후 저장`은 token과 계좌 endpoint를 확인한 뒤 credential을 저장한다.
- 계좌가 하나면 자동 선택하고, 여러 개면 사용자가 자동화 계좌를 선택할 때까지 실거래를 차단한다.
- `공인 IP 확인`과 `IP 복사`는 Toss 개발자 콘솔의 허용 IP 등록을 돕는다.
- credential 삭제는 sidecar 암호화 저장소와 Keychain 백업을 함께 제거한다.
- 로컬 운영자 gate와 사용자 live-trading toggle은 각각 명시적 확인 후 변경한다.
- credential 등록 성공이나 계좌 조회만으로 실거래가 켜지지 않는다.

### 전략과 자동화

- 현재 엔진은 `ladder`, `percent-grid`, `loop-grid` 계약을 지원한다.
- 전략은 초안 저장, 현재 config hash 시뮬레이션, 명시적 활성화 순서로 준비한다.
- `현재 틱`, `발동가 테스트`와 자동화 dry-run은 broker submit을 호출하지 않는다.
- `자동화 1회 실행`은 확인 후 동일한 실거래 안전 경계로 진입한다.
- 연속 scheduler는 기본 OFF이며 30초~15분 주기, 중복 cycle 방지, 마지막 결과와 다음 실행 시각을 저장한다.
- `보유 조회`, `사전검증`, `주문 동기화`는 각각 조회와 준비 작업이며 그 자체로 주문을 만들지 않는다.
- `전략 초안`은 현재 limit `OrderIntent`를 3차 `percent-grid` 초안으로 변환하며, 시뮬레이션과 활성화를 대신하지 않는다.

문장형 블록, 동적 1~20차와 직접 만들기는 아직 HTML 시안이다. [전략 조립기 명세](automation-strategy-builder-spec.md)를 SwiftUI와 엔진에 연결하기 전에는 현재 앱 기능으로 표시하지 않는다.

### Upbit·Bithumb

- 거래소별 credential을 검증하고 암호화 저장소와 Keychain에 보관한다.
- 계좌 조회와 주문 가능 조건을 확인하고 limit 주문 입력을 preview한다.
- 암호화폐 전략은 거래소를 명시하며 페이퍼 모드에서는 소수 수량을 지원한다.
- 실주문은 공통 운영자 gate와 별도 crypto live gate가 모두 열려야 한다.
- unsupported market buy는 adapter 진입 전에 차단한다.
- 실제 제출, 차단, 거절과 실패는 대시보드 audit trail에 남긴다.

거래소 연결 여부와 실시간 코인 차트는 현재 별도 기능이다. credential 검증이 성공해도 WebSocket 캔들 수집을 구현하기 전에는 실시간 차트로 표현하지 않는다.

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

host와 target 아키텍처가 다르면 패키징 스크립트가 공식 Node 런타임을 `.cache/macos-node-runtimes`에 내려받아 번들한다. 생성물은 `dist/macos/release`에 저장된다.

- `StockAnalysis-<version>-macos-<arch>.dmg`
- `StockAnalysis-<version>-macos-<arch>.zip`
- `StockAnalysis-<version>-macos-<arch>.manifest.json`
- `StockAnalysis-<version>-macos-release-index.json`
- `StockAnalysis-<version>-macos-release-check.json`
- `StockAnalysis-<version>-macos-install-verification.json`

DMG에는 `StockAnalysis.app`, `Applications` symlink와 설치 안내가 있어야 한다. install verifier는 DMG를 mount하고 임시 Applications 폴더로 복사한 앱의 번들 sidecar와 UI smoke를 확인한다.

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

실제 주문은 다음 조건을 모두 통과해야 한다.

```text
OrderIntent
→ RiskCheck
→ verified credential
→ selected account 또는 exchange
→ operator live gate
→ user/crypto live gate
→ worker control
→ kill switch
→ broker adapter
```

- SwiftUI와 signal code는 broker를 직접 호출하지 않는다.
- 앱 실행, credential 등록, 시뮬레이션과 precheck는 주문 제출이 아니다.
- live gate가 열려 있어도 `RiskCheck`, worker pause와 kill switch는 제출을 차단한다.
- 공식/RSS 뉴스 polling 실패는 분석·자동화를 중단시키지 않지만 실패 상태를 표시한다.
- 실제 계좌 조회가 가능한 상태에서는 자동 self-test가 사용자 의도 없이 계좌 endpoint를 호출하지 않는다.
