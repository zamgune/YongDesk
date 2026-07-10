# Current Main Features

이 문서는 `main` 브랜치에 들어간 현재 StockAnalysis 기능을 기준으로 유지합니다. 기능 설명이 README보다 자세해야 할 때 이 문서를 먼저 갱신합니다.

## 화면 구성

### 관심종목

- 기본 관심종목과 사용자가 추가한 종목을 시장별로 확인합니다.
- 종목 추가 입력은 서버 종목 마스터 자동완성을 사용합니다. `AP`처럼 입력하면 US 후보를, `삼성`이나 `005930`처럼 입력하면 한국 후보를 드롭다운으로 보여줍니다.
- 가격 곡소리 점수, 현재가, 변화율, RSI, ADX, 추세 판단을 표시합니다.
- 리스크 기준은 5일선, 20일선, 1차 손절, 강제 손절을 중심으로 설명합니다.
- 모바일에서는 표 대신 카드형 UI로 종목명, 시장, 핵심 지표, 리스크 요약을 우선 보여줍니다.

### 포트폴리오

- 사용자가 보유 중인 종목, 시장, 평단가, 수량, 통화를 등록/수정/삭제합니다.
- 보유 종목 등록도 종목 마스터 자동완성을 사용하며, 후보 선택 시 시장과 기본 통화를 함께 채웁니다.
- 포트폴리오 데이터는 로그인 사용자 기준 서버 저장소에 저장합니다. 토스 미연동 상태에서도 수동 입력은 계속 사용할 수 있습니다.
- 토스 API 키를 등록한 사용자는 포트폴리오 탭에서 토스 보유 주식, 매수 가능 금액, 미체결 주문, USD/KRW 환율을 확인하고 보유 종목을 가져올 수 있습니다.
- 각 보유 종목은 현재가 기준 평가금액, 손익률, 리스크 기준, 분석 갱신 상태를 표시합니다.
- 각 보유 카드에는 `1차 익절`, `2차 익절`, `추적 손절`, `최종 손절` 가격을 우선 표시합니다.
- `내 포트폴리오 기준 오늘 할 일`은 보유 종목별로 `보유 유지`, `지지 확인`, `추가매수 대기`, `분할익절 검토`, `손절선 근접`, `신규 진입 보류`, `데이터 부족` 액션을 우선순위로 정리합니다.
- `손절/익절` 패널은 30/40/30 분할 손절, 30/30/40 분할익절, 재진입 조건, 추가매수 금지 조건을 분리해 보여줍니다.
- +20% 이상 수익권이거나 신고가 돌파 룰이 수익 추적 상태이면 `20일선 추적 모드` 배지를 표시합니다.
- 손절/익절 판단에는 단건 분석과 같은 `가격 기준선` 문구를 사용합니다. 보유 논리는 핵심 기준선 위 종가 유지, 재진입은 기준선 회복과 거래량 재확인, 실패는 실패선 이탈로 설명합니다.

### 자동매매

- 현재 자동매매 탭은 `토스 연결 투자 워크벤치`로 진입하며, 로그인 후 토스 API 키를 등록할 수 있습니다.
- 토스 API 키 등록은 서버 암호화 저장과 토큰/계좌 조회 검증으로 처리하며, client secret은 브라우저 응답이나 localStorage에 남기지 않습니다.
- 자동매매 전략 설정과 실행은 별도 베타 권한 뒤에 두며, 실거래 주문은 기본 OFF입니다.
- 베타 전략은 분할 퍼센트 그리드와 `1% 순환매매`를 지원합니다. 순환매매는 기준가 대비 하락 매수, 매수가 대비 상승 매도, 매도 후 매도가 기준 갱신을 반복하되 일일 횟수와 쿨다운 제한을 적용합니다.
- 한국장 모의 계좌는 `KRW 10,000,000`, 미국장 모의 계좌는 `USD 10,000`으로 시작합니다.
- `/api/paper-trading/run`은 페이퍼 후보 빌더의 `entryCandidates`를 사용해 페이퍼 주문, 체결, 제외 로그를 계산하고 파일 저장소에 반영합니다.
- `/api/paper-trading/state`, `/api/paper-trading/reset`으로 저장 상태 조회와 초기화를 처리합니다.
- `npm run paper:run -- --session=KR|US|ALL`은 Next 서버 없이 로컬 runner로 같은 전략을 실행합니다.
- `tradable` 후보는 정상 비중으로 신규 진입하고, `probe` 후보는 계획 비중의 30% 탐색 진입만 허용합니다. `armed`, `watch`, `blocked` 후보는 제외/주의 로그로 남깁니다.
- 시장별 하루 신규 진입 3개, 최대 보유 8종목, 종목당 15%, 1회 손실 1% 한도를 적용합니다.
- 손절/익절은 공통 포지션 관리 플랜의 30/40/30 분할 손절, 30/30/40 분할익절 기준을 사용합니다.
- 페이퍼 계좌, 보유 포지션, 실행 로그는 `.cache/stock-analysis/paper-trading/state.json`에 저장하며 JSON으로 내보낼 수 있습니다.
- Codex App 자동화가 runner를 호출하는 방식을 기본 운영 방식으로 두고, launchd 스크립트는 기본 범위에 포함하지 않습니다.
- 전략 버전은 `paper-breakout-v1`으로 고정 기록하고 자동 미세조정은 하지 않습니다.

### 데일리 브리핑

- `데일리 나스닥`과 `데일리 한국장`을 분리합니다.
- `데일리 나스닥`은 US 스캔 후보를 기준으로 주도 섹터와 대장주 후보를 정리합니다.
- `데일리 한국장`은 KOSPI와 KOSDAQ을 같은 화면에 별도 섹션으로 보여줍니다.
- 상단에는 분석 구분, 기준 거래일, 마지막 분석 시각, 다음 분석 예정 시각을 표시합니다.
- 보유 종목이 있으면 `내 포트폴리오 요약`으로 오늘 할 일을 데일리 브리핑 안에서도 함께 보여줍니다.
- 최근 브리핑은 브라우저 localStorage에 최대 10개 스냅샷으로 저장합니다.
- 강한 후보 목록에는 신고가 돌파 상태와 돌파/지지 거래량 확인 상태를 함께 표시합니다.
- `오늘의 돌파 후보`, `지지 확인 후보`, `주의 종목`은 신호 신뢰도, 돌파 상태, 거래량, 차트 품질, 손절폭을 함께 반영해 분리합니다.
- 강한 후보와 실행 기준에는 `돌파 지지선`, `5일선`, `20일선`, `회복 기준선` 중 현재 가장 중요한 가격 기준선과 실패선을 표시합니다.
- `주도테마별 후보`는 각 주도테마 안의 강한 후보를 같은 테마 기준으로 묶어 표시합니다.
- `스캔 상세 후보`는 기본 접힘 상태이며, 펼치면 전체 후보 흐름을 카드로 보여줍니다.
- 상세 후보 카드에는 `진입 가능`, `보유/관리`, `관찰`, `회피`, 대장주 점수, 신고가 돌파, 거래량 확인, 돌파매매 상태, 핵심 기준선, 실패선을 표시합니다.
- 상세 후보를 클릭하면 해당 종목을 일봉 기준 `종목분석`으로 로드하고 관심종목에도 반영합니다.
- `데일리 나스닥`은 프리마켓/애프터마켓 시간에 장외 보조 체크를 표시합니다.
- 장외 체크는 장외가, 정규장 종가 대비 변화율, 신고가 룰 상태, 정규장 확인 필요 문구를 보여줍니다.

### 종목분석

- 사용자가 원하는 종목을 직접 입력해 단건 분석을 실행합니다.
- 종목 입력은 자동완성을 지원하지만, 종목 마스터에 없는 코드를 직접 입력해도 기존처럼 분석을 시도합니다.
- 지원 시장은 `US`, `KOSPI`, `KOSDAQ`, `CRYPTO`입니다.
- 차트에는 현재가 기준 지지/저항, 손절선, 5일선/20일선 매수 구간, 차트 패턴 해석을 함께 보여줍니다.
- 분석 문구는 한국어로 표시하고, 기존 추세 신호는 보조 참고로만 사용합니다.
- `손절/분할익절 기준` 패널은 돌파매매 손절, 전체 손절, 1차 익절, 2차 익절, 분할 손절, 분할익절, 재진입 조건을 표시합니다.
- `신고가 돌파 룰` 패널은 신고가 기준가, 현재가 대비 거리, 20일 평균 거래대금, 돌파/지지 거래량, -10% 손절가, +20% 전환가, 20일선 추적선을 보여줍니다.
- `가격 기준선` 패널은 핵심 기준선, 실패선, 유효 조건, 실패 조건, 진입 방식을 별도로 보여줍니다.
- `실행 플랜`은 `우선 전략`, `진입 조건`, `실패 조건` 3줄로 표시하며 신고가 돌파, 박스권, 삼각수렴, 쌍봉, 20일선 이탈 등 차트 패턴에 맞춰 문구를 바꿉니다.
- `돌파매매 신호` 패널은 박스권 돌파, 삼각수렴 돌파, 컵앤핸들, 신고가, 20일선 회복 후보를 같은 형식으로 표시합니다. 차트 품질 점수, 돌파 기준선, 거래량 배율, 실패선을 함께 보여줍니다.
- `신호 신뢰도` 패널은 현재 신호와 유사한 과거 사례 수, 성공 비율, 손절 도달 비율, 평균 최대 상승/하락, 평균 손익비를 표시합니다.

## 주요 API

```text
GET /api/market/[symbol]?days=365&tf=1d
GET /api/briefing/[symbol]?market=US&days=365&tf=1d
GET /api/briefing/daily-market?session=US|KR
POST /api/paper-trading/run
GET /api/toss/workbench
GET /api/market/auto-leaders?market=US|KOSPI|KOSDAQ&limit=50
GET /api/market/leaders?market=US|KOSPI|KOSDAQ&top=4
GET /api/community-pain/[symbol]
GET /api/symbol-search?q=AP&markets=US,KOSPI,KOSDAQ,CRYPTO&limit=12
```

`/api/market/[symbol]`, `/api/market/auto-leaders`, `/api/market/leaders`는 `breakoutRule`, `tradeSetup`, `signalReliability` 블록을 반환할 수 있습니다.

```text
status: breakout-ready | wait-pullback | profit-tracking | risk-off | avoid
newHighLevel: 최근 120봉 또는 252봉 신고가 기준가
breakoutDistancePct: 신고가 기준가 대비 현재가 거리
avgTradedValue20: 최근 20봉 평균 거래대금
volumeConfirmation: 돌파 또는 지지 구간의 거래량 배율과 판정
fixedStopPrice: 진입 기준가 대비 -10% 보조 손절가
profitSwitchPrice: 진입 기준가 대비 +20% 수익 추적 전환가
trailingExitPrice: 20일선 추적 기준가
reasons: 판단 사유
```

`tradeSetup`은 실제 실행 판단을 가격 기준선 중심으로 읽기 위한 공통 블록입니다.

```text
type: breakout | pullback | reclaim | extended | risk-off
label: 화면 표시용 판단 라벨
keyLevelLabel: 돌파 지지선 | 5일선 | 20일선 | 회복 기준선 | 20일선 추적선 | 방어 기준선
keyLevel: 핵심 기준가
failureLevel: 실패 기준가
validIf: 기준선 유효 조건
invalidIf: 기준선 실패 조건
entryPlan: 진입 또는 추가매수 방식
stopReason: 실패선을 두는 이유
```

돌파 차트 필터는 `chartQuality`, `patternSignals`, `breakoutSignal` 블록으로 표현합니다.

```text
chartQuality: 차트 품질 점수, 등급, 판단 사유
patternSignals: 박스권, 삼각수렴, 컵앤핸들, 신고가, 20일선 회복 패턴 후보
breakoutSignal: watch | triggered | confirmed | retest | failed 상태와 기준선/실패선/거래량
```

`signalReliability`는 신호를 매수 확정이 아니라 과거 유사 성과 관점으로 읽기 위한 보조 블록입니다.

```text
pattern: 평가한 패턴 또는 추세 유형
grade: high | medium | low | insufficient-data
score: 0~100 신뢰도 점수
sampleSize: 과거 유사 신호 수
successRate: 목표 구간 선도달 비율
stopHitRate: 손절선 선도달 비율
averageMaxGainPct: 평균 최대 상승률
averageMaxDrawdownPct: 평균 최대 하락률
riskReward: 평균 손익비
reasons: 판단 사유
```

`/api/briefing/daily-market?session=US`는 `extendedSession` 블록을 반환할 수 있습니다.

```text
session: pre-market | regular | after-hours | closed
available: 장외 가격 참조 가능 여부
topMovers: 장외 변화율 상위 후보
summary: 장외 움직임 요약
warnings: 장외 데이터 사용 주의
```

`/api/briefing/daily-market?session=US|KR`의 각 시장 리포트는 내부 확장용 `entryCandidates` 블록을 반환합니다. 이 큐는 UI의 데일리 브리핑 카드에는 직접 노출하지 않습니다.

```text
automationStatus: tradable | probe | armed | watch | blocked
setup: breakout | pullback-5d | pullback-20d | trend-continuation
entryType: limit | stop-limit | close-confirmation
entryRange: 5일선 또는 20일선 기준 진입 검토 구간
stop: 신규 진입 후 매매 아이디어 훼손 기준
riskPct: 진입 기준 대비 손절 위험
blockers: 자동매매 차단 사유 또는 조건부 대기 사유
tradeSetup: 기준선/실패선/진입 방식
```

`/api/paper-trading/run`은 실주문 없이 페이퍼 실행 결과를 만들고 파일 저장소에 반영합니다.

```text
request: session, today, source
response: run, nextAccount, nextPositions, orders, executions, logs, state, storagePath, snapshotPath
```

`/api/toss/workbench`는 로그인 + 토스 credential 검증 사용자의 개인화 워크벤치 데이터를 반환합니다. 응답에는 secret 값이 포함되지 않습니다.

```text
response: connected, credential(status only), accounts(masked), positions, buyingPower, commissions, orders, marketInfo
```

시장 리포트는 `breakoutCandidates`도 반환합니다. 이 목록은 `confirmed`, `retest`, `triggered` 돌파 후보를 차트 품질 점수와 신호 신뢰도와 함께 정렬해 데일리 브리핑의 `오늘의 돌파 후보` 섹션에 사용합니다.

시장 리포트는 `supportCandidates`와 `cautionCandidates`도 반환합니다. `supportCandidates`는 돌파 후 지지 확인 또는 5일선/20일선 눌림 후보이고, `cautionCandidates`는 돌파 실패, 20일선 이탈, 낮은 신뢰도, 과도한 손절폭 후보입니다.

시장 리포트는 `scanCandidates`도 반환합니다. 이 목록은 `/api/market/auto-leaders` 후보를 데일리 브리핑 상세 보기용으로 보존하며, 별도 `시장 스캔` 탭 없이 `스캔 상세 후보` 섹션에서 사용합니다.

`/api/symbol-search`는 서비스형 자동완성 검색 API입니다. 응답 항목은 `symbol`, `displaySymbol`, `market`, `exchange`, `name`, `currency`, `assetType`, `source`, `score`를 포함합니다.

```text
q: 검색어
markets: US,KOSPI,KOSDAQ,CRYPTO 중 쉼표 구분 목록
limit: 반환 후보 수
source: cache | seed | fallback | nasdaq | krx
```

## 종목 마스터 검색 기준

- 자동완성은 브라우저 정적 배열이 아니라 서버 API가 종목 마스터를 검색합니다.
- 저장소 경계는 `SymbolMasterRepository` 포트로 분리해두며, v1은 파일 캐시/seed 기반이고 추후 DB 저장소로 교체할 수 있습니다.
- 캐시는 `.cache/stock-analysis/symbol-master/*.json`에 저장하며 커밋하지 않습니다.
- `npm run refresh:symbol-master`는 US Nasdaq Trader symbol directory를 내려받아 US 캐시를 갱신합니다.
- `SYMBOL_MASTER_KRX_SERVICE_KEY`가 있으면 KRX 상장종목정보 공공 API로 KOSPI/KOSDAQ 캐시를 갱신합니다.
- KRX key가 없거나 캐시가 깨지면 기존 유니버스 fallback을 사용해 검색 기능이 끊기지 않게 합니다.
- 정렬은 티커 exact, 티커 prefix, 티커 부분/약어 매칭, 종목명 prefix, 종목명 포함 순서로 우선순위를 둡니다.

## 내부 스캔 기준

- US는 Yahoo screener 기반 동적 후보를 우선 사용합니다.
- KOSPI/KOSDAQ은 동적 후보가 부족하면 기본 유니버스를 fallback으로 사용합니다.
- API 응답의 `candidateSource`에 `dynamic`, `mixed`, `fallback` 상태를 표시합니다.
- 내부 스캔 결과는 런타임 캐시에 저장할 수 있으며, 캐시는 `.cache/stock-analysis/market-scans` 하위에 둡니다.
- 대장주 후보 정렬은 `leadershipScore`를 중심으로 합니다. 50일 상대강도, 5일 탄력, 신고가/박스권 돌파 상태, 돌파 거래량, 차트 품질, 손절폭을 함께 점수화합니다.
- 신호 신뢰도가 높거나 보통인 후보는 보조 가점을 받고, 낮은 후보는 주의 후보로 강등될 수 있습니다.
- LG전자처럼 fallback 유니버스에서 누락되면 안 되는 대형/테마 핵심 종목은 보강 후보로 포함할 수 있으며, 응답의 `candidateSourceDetail`에 출처를 표시합니다.
- 자동매매 준비 큐는 강한 종목 목록과 별도로 계산하지만, 현재 데일리 브리핑 UI는 돌파 후보, 지지 확인 후보, 주의 후보, 스캔 상세 후보 탐색에 집중합니다.
- 돌파 후보 정렬은 기존 50일 상대강도에 더해 돌파 상태와 차트 품질 점수를 보조 가점으로 사용합니다.

## 트레이딩 판단 원칙

- 1일봉을 primary 기준으로 사용하고, 4시간봉은 보조 타이밍 확인용입니다.
- 신규 진입은 현재가 추격보다 5일선 지지 구간 또는 20일선 보수 진입 구간을 우선합니다.
- 20일선 이탈, 최근 구조 저점 이탈, SMA50 추세 훼손은 리스크 축소 기준으로 봅니다.
- 2R은 참고 기준이며 강제 전량 익절 규칙으로 쓰지 않습니다.
- 신고가 돌파 룰은 보조 판단입니다. `신고가 돌파 즉시 매수`가 아니라 거래량, 5일선 지지, 20일선 추적 기준을 함께 확인합니다.
- 신고가 돌파 시에는 5일선/20일선만 보지 않고 이전 고점 저항선이 `돌파 지지선`으로 바뀌는지 확인합니다. 일봉 종가가 이 기준선 아래에서 마감하면 돌파 실패로 봅니다.
- 좋은 돌파 차트는 패턴명보다 조건을 우선합니다. 일봉 종가 돌파, 20일 평균 대비 거래량 증가, 실패선까지의 손절폭, 조정 중 거래량 감소를 함께 확인합니다.
- 거래대금은 평소 유동성, 돌파/지지 거래량은 최신 봉 수급 확인으로 분리해 봅니다.
- 수익이 +20% 이상으로 전환되면 고정 목표가보다 20일선 추적을 우선 참고합니다.
- 손실권 종목은 기존 구조 손절과 진입 기준 -10% 보조 손절을 함께 확인합니다.
- 장외 가격은 보조 체크입니다. 프리마켓/애프터마켓 변동이 커도 정규장 초반 거래대금과 지지 확인 전에는 진입 신호로 확정하지 않습니다.
- 자동매매 후보 큐는 `entryCandidates`로 내부 계산만 유지합니다. 토스 credential을 등록해도 실주문은 `live_trading` 권한과 서버 킬스위치가 모두 켜진 경우에만 가능합니다.

### macOS 네이티브 앱

- `apps/macos/StockAnalysisMac`은 SwiftUI 기반 macOS shell입니다.
- `npm run local-engine`은 기존 TypeScript 분석/브리핑/자동매매 로직을 `127.0.0.1` HTTP sidecar로 제공합니다.
- Swift 앱은 메뉴바 상태, macOS 알림, App Support 저장소, SQLite migration, Keychain credential 저장 경계를 담당합니다.
- 공식/RSS 뉴스 소스는 Fed, SEC, BEA를 기본값으로 사용하며 실패해도 분석 엔진은 계속 동작합니다.
- 실거래 주문은 Swift 앱에서 직접 제출하지 않고 기존 `OrderIntent + RiskCheck + live_trading gate`를 통과해야 합니다.
- 연속 자동 실행은 기본 OFF이며 30초~15분 주기를 명시적으로 선택해야 합니다. 앱과 sidecar가 실행 중일 때만 동작하고 중복 cycle, 워커 일시중지, kill switch를 안전하게 처리합니다.
- 상단 종목 검색은 한글·영문 종목명과 종목코드를 지원하며, 결과에 한글명·영문명·시장·코드를 함께 표시합니다. 캐시가 없어도 주요 종목 seed와 수동 코드 입력을 유지합니다.
- `코인` 설정은 Upbit와 Bithumb API 키를 sidecar 암호화 저장소와 macOS Keychain에 분리 저장하고, 계좌 잔고·주문 가능 정보·지정가 주문 사전검증을 실제 주문 제출 없이 확인합니다.
- 전략 작성에서 `코인(KRW)`과 Upbit/Bithumb 실행 거래소를 선택할 수 있습니다. 코인 분할·순환 전략은 동일한 시뮬레이션, RiskCheck, 잔고 사전검증, kill switch, 연속 스케줄러를 거쳐 기본적으로 paper 계좌에 소수 수량으로 기록됩니다.
- 코인 실거래는 전체 실거래 마스터와 별도의 코인 게이트가 모두 켜진 경우에만 허용됩니다. 활성 전략의 현재 시뮬레이션, 선택 거래소 credential, 주문 가능 잔고를 다시 확인한 뒤 Upbit/Bithumb 지정가 주문 또는 청산 시장가 매도를 제출하며, 결과를 로컬 감사 기록에 남깁니다.

## 운영 주의

- 이 앱의 공개 분석 기능은 자동 매수/매도 지시가 아니라 진입 여부 판단 보조입니다.
- 토스 연결 기능은 개인 보유/주문 가능 정보 확인과 주문 전 검증을 위한 것이며, 기본 상태에서 실주문을 전송하지 않습니다.
- 데일리 브리핑 후보 카드는 실제 주문, 수익 보장, 매수 추천을 의미하지 않으며 상세 판단은 종목분석에서 확인합니다.
- Yahoo Finance 데이터 지연, 조정주가, 거래소 휴일, 장중 가격 변동에 따라 결과가 달라질 수 있습니다.
- 한국 시장 스캔 후보는 데이터 소스 한계로 fallback 표시가 자주 나올 수 있습니다.
- 커뮤니티 곡소리 기능은 공개/허용된 소스만 사용하며 로그인 기반 페이지나 비공개 API를 수집 대상으로 삼지 않습니다.
