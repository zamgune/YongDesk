# macOS Terminal Dashboard Goal

> Archive · 2026-07-10: 기존 터미널형 macOS UX의 목표와 수용 기준을 보존한 문서다. 현재 기능과 다음 UI 방향은 [기능 상태](../features.md)와 [이어서 개발하기](../continuation-guide.md)를 우선한다.

이 문서는 macOS 네이티브 앱의 v1 목표 UX와 구현 체크리스트를 고정한다. 기준 화면은 `docs/archive/ux-prototypes/macos-native/terminal-dense-detail.html`의 탭형 터미널 대시보드다.

## 제품 목표

- macOS 로컬 앱에서 시장 감시, 종목 분석, 뉴스 알림, 모의 주문, 실거래 전 안전 검증을 한 워크스페이스에서 처리한다.
- 주 UX는 SwiftUI macOS 앱으로 이전하고, 기존 Next 웹 UI는 fallback/admin 경로로 유지한다.
- TypeScript sidecar는 기존 분석, 브리핑, paper trading, Toss, `OrderIntent`, `RiskCheck` 로직을 계속 담당한다.
- 실거래는 기존 안전 경계를 우회하지 않는다: `OrderIntent + RiskCheck + credential 검증 + live_trading 권한 + ENABLE_LIVE_TRADING + kill switch`.

## 기준 UX

- Prototype: `docs/archive/ux-prototypes/macos-native/terminal-dense-detail.html`
- 기본 구조:
  - 좌측 고정: 관심목록, 자산군 필터, 스캐너 칩, 보유/감시 상태.
  - 상단 고정: 검색, sidecar 상태, 모의/실거래 게이트, 긴급 중지.
  - 중앙 탭: `개요`, `주문·리스크`, `뉴스·알림`, `리플레이`, `플레이북`.
  - 우측 고정: 판단 패널, `OrderIntent` 미리보기, 안전 게이트, 자동화 큐.
  - 하단: 이벤트 테이프, 긴급 알림, 섹터 열지도, 세션 노트.
- 정보 복잡도 원칙:
  - 항상 보여야 하는 정보는 관심목록, 현재 선택 종목, 안전 게이트, 실거래 차단 상태다.
  - 조사성 정보는 중앙 탭으로 분리한다.
  - 우측 판단 패널은 탭 전환과 무관하게 항상 표시한다.

## 사용자 흐름

1. 관심목록에서 종목을 선택한다.
2. `개요` 탭에서 시장 지표, 차트, 시그널, 뉴스 영향, 포지션 요약을 확인한다.
3. `주문·리스크` 탭에서 `OrderIntent`, `RiskCheck`, 리스크 시나리오, 주문 전 체크리스트를 확인한다.
4. 조건이 맞으면 모의 주문을 실행한다.
5. `뉴스·알림`, `리플레이`, `플레이북` 탭에서 진입 근거와 운영 규칙을 검토한다.
6. 실거래는 모든 안전 게이트가 통과된 경우에만 별도 활성화한다.

## 우선순위

### P0: v1 필수

- [x] `OrderIntent` 감사 로그
  - 주문 후보 생성 이유, 시세 스냅샷, 뉴스 근거, `RiskCheck` 결과, 사용자 액션을 저장한다.
  - 사고 분석과 자동매매 디버깅에 사용할 수 있어야 한다.
- [x] 리스크 시나리오 패널
  - 지수, 섹터, 금리, 환율 충격별 예상 손익을 표시한다.
  - 단일 종목 신호보다 계좌 단위 방어 판단을 우선한다.
- [x] 관심목록 단위 알림
  - 거래량, 돌파, 뉴스 영향, 보유 리스크 조건을 watchlist 전체에 적용한다.
  - 종목별 알림 반복 설정을 피한다.

### P1: v1 포함

- [x] 뉴스 신뢰도 점수
  - 공식 공시, 기업 IR, 검증된 금융 뉴스, 일반 RSS를 등급화한다.
  - 낮은 신뢰도 출처는 주문 판단 입력값으로 직접 쓰지 않는다.
- [x] 주문 전 체크리스트
  - 실적 발표, 매크로 이벤트, 스프레드, ATR, live gate 상태를 주문 전 강제 확인한다.
  - 위험 조건이 있으면 실거래 전송을 차단하거나 수동 승인을 요구한다.
- [x] 리플레이 모드
  - 캔들, 뉴스, 시그널, `RiskCheck`, 주문 이벤트를 시간축으로 복기한다.
  - 백테스트 점수보다 운영 판단을 개선하는 용도로 둔다.
- [x] 포지션 플레이북
  - 진입, 손절, 추가매수, 축소/청산 조건을 저장한다.
  - 수동 판단과 자동 워커가 같은 규칙을 공유하게 한다.

### P2: v1 이후

- [ ] 오디오 Squawk 모드
  - 중요 알림만 짧은 음성으로 읽어준다.
  - v1 핵심 거래 플로우가 안정된 뒤 후순위로 구현한다.

## 구현 체크리스트

### 문서/목표 세팅

- [x] 목표 문서를 `docs/macos-terminal-dashboard-goal.md`로 추가한다.
- [x] HTML 프로토타입 경로와 탭 구조를 기준 UX로 명시한다.
- [x] P0/P1/P2 우선순위와 v1 포함 범위를 체크리스트화한다.

### SwiftUI 화면

- [x] 좌측 `WatchlistSidebar`를 추가한다.
- [x] 중앙 `WorkspaceTabs`를 추가하고 탭을 `Overview`, `OrderRisk`, `NewsAlerts`, `Replay`, `Playbook` 5개로 고정한다.
- [x] 우측 `DecisionPanel`을 탭과 독립적으로 항상 표시한다.
- [x] 하단 `EventTape`를 추가한다.
- [x] macOS 메뉴바 미니뷰에는 sidecar 상태, 긴급 알림, 모의/실거래 게이트, 긴급 중지만 노출한다.

### Local Engine 연동

- [x] `GET /health`로 sidecar 상태를 표시한다.
- [x] `GET /api/dashboard/terminal?symbol=NVDA&session=US`로 macOS 터미널 대시보드의 P0/P1 데이터 계약을 제공한다.
- [x] `GET /api/market/:symbol`로 선택 종목 차트/분석 데이터를 로드한다.
- [x] `GET /api/news/events`로 뉴스·알림 탭과 이벤트 테이프를 채운다.
- [x] `GET /api/briefing/daily-market`로 시장 개요와 브리핑 요약을 채운다.
- [x] `POST /api/paper-trading/run`으로 모의 주문 실행 경로를 연결한다.
- [x] `POST /api/automation/cycle`은 자동화 큐에서 명시적으로만 호출한다.
- [x] `GET /api/local/holdings`로 선택 종목의 Toss 실계좌 보유 상태를 조회한다.
- [x] `POST /api/local/orders/precheck`로 주문 제출 전 매수 가능 금액/매도 가능 수량, `OrderIntent`, `RiskCheck`, live gate를 한 번에 확인한다.
- [x] 아직 endpoint가 없는 P0/P1 데이터는 mock 대신 `준비중` 또는 `미지원` 상태로 표시한다.

### P0/P1 데이터 계약

- [x] `OrderIntent` 감사 로그를 local-engine dashboard store에 누적한다.
- [x] `RiskCheck` 결과를 주문 전 체크리스트와 판단 패널에 표시한다.
- [x] 리스크 시나리오 데이터를 dashboard endpoint에서 계산해 표시한다.
- [x] 관심목록 단위 알림 규칙을 dashboard endpoint에서 제공한다.
- [x] 뉴스 신뢰도 점수를 dashboard endpoint에서 제공한다.
- [x] 리플레이 이벤트를 감사 로그 기반으로 dashboard store에 누적한다.
- [x] 저장된 뉴스 이벤트를 리플레이 타임라인에 통합한다.
- [x] 종목별 포지션 플레이북 기본값을 dashboard store에 유지한다.
- [x] 포지션 플레이북 편집/저장 UI와 CRUD endpoint를 추가한다.
- [x] 관심목록 알림 조건을 실제 시세/보유종목 이벤트에 대해 평가한다.
  - `watchlistAlertEvaluations`는 market-data 캔들/거래량, 로컬 paper 포지션, 저장 뉴스 이벤트를 기준으로 발동/정상/준비중 상태를 반환한다.
- [x] 리플레이를 캔들/주문 체결 이벤트까지 통합한 전체 타임라인으로 확장한다.
  - `replayEvents`는 캔들 이벤트, 뉴스 이벤트, OrderIntent/RiskCheck 감사 이벤트, paper order, paper execution을 같은 시간축으로 반환한다.

### 안전/거래 경계

- [x] SwiftUI에서 broker를 직접 호출하지 않는다.
- [x] 모든 주문은 sidecar의 `OrderIntent`/`RiskCheck` 경계를 통과한다.
- [x] `ENABLE_LIVE_TRADING=false`이면 실거래 버튼을 비활성화하고 차단 사유를 표시한다.
- [x] live 권한, credential 검증, user toggle 중 하나라도 미충족이면 실거래 전송을 차단한다.
- [x] kill switch는 모의/실거래 자동화 큐를 모두 즉시 중단하는 상태로 표시한다.
- [x] SwiftUI의 `보유 조회`/`사전검증` 버튼은 sidecar 조회와 preview 감사 로그까지만 수행하고 broker 주문 제출은 수행하지 않는다.

## 수용 기준

- 사용자는 앱 첫 화면에서 선택 종목, 현재 시장 상태, 실거래 차단 상태, 안전 게이트를 즉시 볼 수 있다.
- 중앙 탭 5개가 목적별로 분리되어 한 화면에 모든 정보를 과밀하게 표시하지 않는다.
- P0/P1 항목은 화면상 위치와 구현 상태가 체크리스트로 추적된다.
- 실거래 게이트 OFF 상태에서는 어떤 UI에서도 실거래 전송이 불가능하다.
- 기존 Next 웹 UI는 제거하지 않고 fallback/admin 경로로 남긴다.

## 검증 계획

### 문서 검증

- [x] P0/P1/P2 항목이 누락 없이 포함되어 있는지 확인한다.
  - P0/P1은 v1 구현 대상으로 체크했고, P2 오디오 Squawk는 v1 이후 항목으로 남겼다.
- [x] HTML 프로토타입 경로와 문서의 화면 구조가 일치하는지 확인한다.
  - `docs/archive/ux-prototypes/macos-native/terminal-dense-detail.html` 파일 존재와 좌측/상단/중앙 탭/우측/하단 구조를 확인했다.

### 로컬 엔진 검증

```bash
npm run test:local-engine
npm run test:market-briefing
npm run test:paper-trading
npm run test:trading
npm run test:toss
```

### macOS 앱 검증

```bash
npm run mac:build
npm run mac:test
```

### 수동 UX 검증

- [x] 탭 5개가 목적별로 정보가 분리되어 복잡도가 줄었는지 확인한다.
  - `WorkspaceContent`가 `Overview`, `OrderRisk`, `NewsAlerts`, `Replay`, `Playbook`으로 분기한다.
- [x] sidecar health 성공/실패 상태가 상단에 표시되는지 확인한다.
  - 상단 상태 pill과 메뉴바 미니뷰가 `EngineHealth`의 성공/실패 상태를 표시한다.
- [x] 실거래 게이트 OFF 상태에서 실거래 전송이 차단되는지 확인한다.
  - SwiftUI 실거래 버튼은 비활성 상태이고, 판단 패널/체크리스트에 live gate 차단 상태가 표시된다.
- [x] P0/P1 기능이 화면 표시 상태와 실제 데이터/엔진 구현 상태로 분리 관리되는지 확인한다.
  - unsupported 데이터는 `준비중` 상태로 표시하고, 구현된 데이터는 sidecar 응답 필드로 분리한다.

## Assumptions

- v1 목표 플랫폼은 macOS 전용이다.
- 현재 HTML 프로토타입은 SwiftUI 구현의 정보 구조 기준안이다.
- P0/P1은 v1 목표에 포함하고, P2 오디오 Squawk는 후순위로 둔다.
- 부족한 데이터는 임시 mock으로 실제처럼 보이게 하지 않고 `준비중` 또는 `미지원` 상태로 표시한다.
- 실거래 안전 게이트는 기존 TypeScript sidecar 경계를 절대 우회하지 않는다.
