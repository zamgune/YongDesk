# YongStockDesk

YongStockDesk는 관심종목, 포트폴리오 관리, 단건 차트 분석, 데일리 시장 브리핑과 자동화 전략 설계를 한곳에서 다루는 macOS 트레이딩 워크벤치입니다.

이 앱은 자동 매수/매도 지시가 아니라 의사결정 보조 도구입니다. 최종 진입 여부는 가격 움직임, 거래량, 시장 상태, 개인 리스크 한도를 함께 보고 판단해야 합니다.

이 저장소는 기존 StockAnalysis에서 분리한 최신 앱 소스의 기준 저장소입니다. 현재 배포 호환성을 위해 앱 번들 이름 `StockAnalysis.app`, Swift 제품명, 번들 ID, Keychain 서비스와 App Support 경로는 유지합니다. 전체 YongStockDesk 리브랜딩과 기존 사용자 데이터 이전은 별도 단계에서 진행합니다.

## macOS App

SwiftUI 앱은 `apps/macos/StockAnalysisMac`, 로컬 TypeScript sidecar와 패키징 도구는 `scripts/`에 있습니다. 앱은 sidecar가 사용하는 `src/` 도메인·유스케이스와 함께 빌드되므로 이 저장소 전체가 배포 소스의 기준입니다.

```bash
yarn install --frozen-lockfile
yarn mac:test
yarn mac:app
yarn mac:verify
yarn mac:verify:launch
```

상세한 로컬 실행, Toss 연결과 배포 절차는 [macOS 네이티브 앱 안내](docs/macos-native.md)를 참고합니다.

## Main Features

- `macOS 앱`: Finder/Dock에서 실행되는 SwiftUI 앱이 번들된 TypeScript sidecar를 자동으로 시작합니다.
- `시장 분석`: 종목 검색, 일봉 차트, 지지·저항, 돌파 상태, 실행 참고선과 신호 신뢰도를 제공합니다.
- `시장 브리핑`: US·KR 시장의 주도 후보, 진입 준비도, 뉴스 이벤트와 페이퍼 후보를 정리합니다.
- `전략·자동화`: ladder, 분할차수, 1% 반복 전략의 저장·시뮬레이션·활성화와 페이퍼 실행을 지원합니다.
- `브로커 연결`: Toss, Upbit와 Bithumb credential 검증, 조회·사전검증과 안전한 주문 경계를 제공합니다.
- `안전장치`: `OrderIntent`, `RiskCheck`, live gate, worker control과 kill switch를 모든 실제 주문보다 먼저 적용합니다.
- `웹 fallback`: 포트폴리오, 분석, 자동화 관리와 백테스트 화면을 관리·보조 경로로 유지합니다.

현재 SwiftUI와 향후 HTML 시안의 차이는 [기능 상태 문서](docs/features.md)에서 확인합니다.

## Getting Started

```bash
yarn install --frozen-lockfile
yarn dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

검증 명령:

```bash
yarn lint
yarn build
```

현재 테스트 스크립트:

```bash
yarn test:crypto-buy
yarn test:community-pain
yarn test:market-briefing
yarn test:portfolio-daily-action
yarn test:signal-reliability
yarn test:symbol-search
yarn test:trading
```

종목 마스터 캐시 갱신:

```bash
yarn refresh:symbol-master
```

## Core API

```text
GET /api/market/[symbol]?days=365&tf=1d
GET /api/briefing/[symbol]?market=US&days=365&tf=1d
GET /api/briefing/daily-market?session=US
GET /api/briefing/daily-market?session=KR
GET /api/market/auto-leaders?market=US&limit=50
GET /api/market/auto-leaders?market=KOSPI&limit=50
GET /api/market/auto-leaders?market=KOSDAQ&limit=50
GET /api/market/leaders?market=US&top=4
GET /api/community-pain/[symbol]
GET /api/symbol-search?q=AP&markets=US,KOSPI,KOSDAQ,CRYPTO&limit=12
```

### API Roles

- `/api/market/[symbol]`: 차트, 지표, 레거시 신호, 추세추종 블록, 신고가 돌파 룰 블록을 반환하는 단건 시장 데이터 API입니다.
- `/api/briefing/[symbol]`: 단건 종목을 현재가 기준 실행 브리핑으로 요약합니다.
- `/api/briefing/daily-market`: `US` 또는 `KR` 세션 단위 데일리 브리핑입니다. `US`는 장외 보조 체크를 포함할 수 있고, `KR`은 KOSPI와 KOSDAQ을 함께 다룹니다. 각 시장 리포트는 상세 보기용 `scanCandidates`를 포함합니다.
- `/api/market/auto-leaders`: 데일리 브리핑을 만드는 내부 스캔 엔진입니다. 시장별 자동 후보, 후보 소스, 기준 거래일, 다음 분석 시각, 대장주 점수, 신고가 돌파 상태를 함께 반환합니다.
- `/api/market/leaders`: 명시 종목 목록 또는 기본 유니버스를 스캔하는 호환 API입니다. 외부 호출 호환성을 위해 유지하며, 50일 상대강도에 신고가 돌파 여부를 보조 가점으로 반영합니다.
- `/api/community-pain/[symbol]`: 커뮤니티 반응 기반 곡소리 점수를 반환합니다.
- `/api/symbol-search`: 종목 자동완성 서버 API입니다. `.cache/stock-analysis/symbol-master` 캐시를 우선 사용하고, 캐시가 없거나 깨지면 repo seed와 기존 유니버스 fallback으로 응답합니다.

## Symbol Master

- 자동완성은 클라이언트 정적 별칭 사전이 아니라 서버의 종목 마스터 검색 API를 사용합니다.
- US 종목 마스터는 Nasdaq Trader symbol directory를 기준으로 갱신합니다.
- KOSPI/KOSDAQ 전체 종목 갱신은 `SYMBOL_MASTER_KRX_SERVICE_KEY`가 있을 때 KRX 공공 API를 사용합니다.
- KRX key가 없으면 기존 한국 유니버스 fallback으로 검색되며, API 응답의 `source`에 `fallback`이 표시됩니다.
- 캐시 파일은 `.cache/stock-analysis/symbol-master/*.json`에 저장되며 커밋 대상이 아닙니다.

### Breakout Rule Payload

`/api/market/[symbol]`, `/api/market/leaders`, `/api/market/auto-leaders`는 `breakoutRule` 블록을 포함할 수 있습니다.

```text
status: breakout-ready | wait-pullback | profit-tracking | risk-off | avoid
newHighLevel: 최근 120봉 또는 252봉 신고가 기준가
breakoutDistancePct: 신고가 기준가 대비 현재가 거리
avgTradedValue20: 최근 20봉 평균 거래대금
volumeConfirmation: 돌파 또는 지지 구간의 거래량 배율과 판정
fixedStopPrice: 진입 기준가 대비 -10% 보조 손절가
profitSwitchPrice: 진입 기준가 대비 +20% 수익 추적 전환가
trailingExitPrice: 20일선 추적 기준가
reasons: 한국어 판단 사유
```

### Signal Reliability Payload

`/api/market/[symbol]`, `/api/market/leaders`, `/api/market/auto-leaders`는 `signalReliability` 블록을 포함할 수 있습니다.

```text
grade: high | medium | low | insufficient-data
score: 0~100 신뢰도 점수
sampleSize: 과거 유사 신호 수
successRate: 목표 구간 선도달 비율
stopHitRate: 손절선 선도달 비율
averageMaxGainPct: 평균 최대 상승률
averageMaxDrawdownPct: 평균 최대 하락률
riskReward: 평균 손익비
reasons: 한국어 판단 사유
```

### Extended Session Payload

`/api/briefing/daily-market?session=US`는 미국장 프리마켓/애프터마켓 시간에 `extendedSession` 블록을 포함합니다.

```text
session: pre-market | regular | after-hours | closed
available: 장외 가격 참조 가능 여부
topMovers: 장외 변화율 상위 후보
summary: 장외 움직임 요약
warnings: 정규장 확인 필요 안내
```

장외 가격은 정규장 신호 계산, 신고가 돌파 확정, 포트폴리오 손익 계산에 직접 반영하지 않습니다.

## Crypto Buy Backtest

기본 실행:

```bash
yarn backtest:crypto-buy --symbols BTC,ETH,SOL --tf 1d --start 2024-01-01 --mode both --cost all
```

결과 파일 저장:

```bash
yarn backtest:crypto-buy --symbols BTC --tf 4h --start 2026-02-01 --mode A --cost normal --out ./artifacts/crypto-buy
```

## Documentation

- [문서 전체 안내](docs/README.md)
- [새 저장소에서 이어서 개발하기](docs/continuation-guide.md)
- [현재 기능 상태](docs/features.md)
- [macOS 네이티브 앱](docs/macos-native.md)
- [기능 확장 가이드](docs/feature-extension-guide.md)
- [초보자용 전략 조립기 명세](docs/automation-strategy-builder-spec.md)
- [보유 기간별 익절·손절 명세](docs/ux-prototypes/macos-native/horizon-exit-plan-spec.md)
- [어스플러스식 브리핑 전략 기준](docs/us-plus-briefing-strategy.md)
- [신고가 돌파 보조 룰](docs/breakout-rule.md)
- [추세추종 대장주 백테스트](docs/trend-following-leader-backtest.md)
- [추세추종 임계값 메모](docs/trend-following-threshold-notes.md)
- [커뮤니티 곡소리 소스 정책](docs/community-pain-sources.md)
- [크립토 buy 신호 백테스트 사양](crypto_buy_signal_backtest_spec.md)

완료된 목표와 과거 로드맵은 [문서 전체 안내](docs/README.md)의 archive 섹션에서 확인합니다.

## Notes

- Candle timestamp는 API 응답에서 UNIX seconds를 사용합니다.
- 한국 종목은 Yahoo Finance 심볼 규칙에 맞춰 KOSPI는 `.KS`, KOSDAQ은 `.KQ`로 정규화합니다.
- 데일리 브리핑의 상세 후보는 Yahoo Finance 데이터 품질과 후보 소스 가용성에 영향을 받습니다. 한국 시장 후보가 부족하면 기본 유니버스 fallback을 표시합니다.
- `.cache/`와 `.playwright-mcp/`는 런타임/검증 산출물이므로 커밋 대상이 아닙니다.
