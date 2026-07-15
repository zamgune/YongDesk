# YongStockDesk macOS 네이티브 앱

`apps/macos/StockAnalysisMac`은 YongStockDesk의 SwiftUI 앱이며 Finder·Dock·창의 표시 이름은 `Yong'Desk`다. 이관 호환성을 위해 생성 번들 이름은 계속 `StockAnalysis.app`, Swift 제품명은 `StockAnalysisMac`, 번들 ID는 `com.stockanalysis.mac`을 사용한다. Keychain과 App Support 데이터를 함께 마이그레이션하기 전에는 이 값을 개별적으로 바꾸지 않는다.

## 아키텍처

- SwiftUI가 메인 대시보드, 설정 시트, 메뉴바, 알림, Keychain과 App Support 상태를 담당한다.
- 기본 창은 `BeginnerFirstRootView`이며 차트·섹터·관심종목·내 자산·전략·자동화·설정 workspace를 분리한다. API credential은 설정 workspace의 인라인 연결 관리에서 등록하고, 전략·점검·배포·로그 시트는 그대로 재사용한다.
- 앱은 번들된 TypeScript sidecar를 `127.0.0.1`의 임의 포트에서 자동 시작한다.
- sidecar는 `src/domain`, `src/use-cases`, `src/ports`와 `src/adapters`의 기존 분석·자동화·브로커 코드를 재사용한다.
- 앱은 `STOCK_ANALYSIS_STORAGE_ROOT`를 `~/Library/Application Support/com.stockanalysis.mac/sidecar`로 설정한다. 승인된 주식 플레이북 evidence와 registry도 이 루트의 `backtests/` 아래에 함께 배치되어야 하며, repo `.cache`만 생성해서는 앱 runtime이 승격하지 않는다.
- broker credential 암호화 키는 App Support의 권한 제한 파일에서 읽으며, 생성·변경 시에만 기록하고 앱 시작마다 Keychain에 다시 저장하지 않는다.
- 웹 route는 관리·fallback 용도로 유지하지만 Finder에서 실행한 앱은 별도의 Next 서버가 없어도 동작한다.

```text
SwiftUI
→ EngineClient
→ local_engine.mts
→ domain / use-cases
→ OrderIntent / RiskCheck
→ Toss·Upbit·Bithumb adapter
```

이 다이어그램은 전체 코드 경계를 나타낸다. 1.2.0-beta.2는 `liveSubmissionMode=disabled` 고정 정책으로 모든 adapter submit·cancel을 네트워크 호출 전에 차단하며 자동화는 paper 계좌에만 기록된다.

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
| 섹터 강도 | `GET /api/local/sector-strength?market=US|KR` | 대표 ETF의 1일·1주·1개월 수익률과 시장 대비 초과수익률. `refresh=1`은 5초 제한 수동 갱신 |
| 멀티타임프레임 | `GET /api/local/analysis/workspace` | 1시간·4시간·일봉 분석, metadata, 1~3일 단기·스윙·장기 계획과 additive v2 `tradeSignalSet` |
| 관심종목 | `GET/POST /api/local/watchlist`, `DELETE /api/local/watchlist/:id`, `GET /api/local/watchlist/summary` | 이 Mac의 관심종목 저장과 시세·일봉 기술 요약·커뮤니티 민심·관심도 요약. 코인은 이번 버전에서 시세만 제공 |
| 급락 감시 | `POST /api/local/watchlist/signal-scan`, `GET /api/local/watchlist/signals` | 한국 주식 관심종목의 Toss 확정 5분봉 장중 급락반등, 동일 시간대 20거래일 RVOL, KOSPI 문맥과 additive `tradePlan`. 주문 제출 없음 |
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
- `내 자산`은 Toss·Upbit·Bithumb 실자산만 포지션 중심 보드로 표시한다. 공급자별 색상·연결 상태와 종목 수를 구분하고 평가금액은 공급자·통화별로만 표시하며, 모의계좌 전환은 노출하지 않는다. paper 엔진은 무실주문 베타의 자동화·안전 검증을 위해 유지한다.
- 차트에서 현재 종목을 관심종목에 추가하면 최대 20개를 이 Mac의 sidecar 저장소에 보관한다. 관심종목은 현재가·등락·출처·갱신 상태만 비교하며, 행 선택 후 단건 분석으로 이동한다.
- 관심종목의 `급락 감시`는 사용자가 켠 경우에만 앱 실행 중 KRX 정규장에서 60초마다 동작한다. 검증된 Toss credential이 필요하며, 1분봉을 확정 5분봉으로 집계해 `급락 감지 → 반전 대기 → 매수 검토 가능`을 구분한다. Yahoo fallback, stale 시세와 429 응답에서는 알림을 내지 않는다.
- `매수 검토 가능`은 동일 급락·확인봉 조합에서 한 번만 macOS 알림을 보낸다. 차트 카드의 기준가·구조 손절·1R/저항 1차 50%·2R 2차 50%는 분석값이며 주문이나 보유 사실을 뜻하지 않는다.
- Finder/Dock 실행 시 번들 sidecar를 우선 사용한다.
- 번들 경로가 없으면 빌드 시 저장한 저장소 경로와 사용자가 저장한 sidecar 경로를 순서대로 확인한다.
- 상단 상태와 메뉴바에서 sidecar, 모의투자, `PAPER ONLY`, 최근 갱신을 확인한다.
- `점검` 화면은 credential이 없을 때 외부 계좌를 호출하지 않고 안전 경로를 검증한다.
- `로그`와 운영 리포트는 secret, token과 raw account number를 제외한다.
- 일반 설정은 API 연결·알림·자동화 안전 상태만 제공한다. self-test와 진단 로그는 앱 메뉴의 `지원` 경로로, 배포·설치 검증은 개발·패키징 경로로 분리한다.

### 차트와 멀티타임프레임 분석

- 화면 차트는 `5분·15분·30분·1시간·4시간·일봉·주봉`을 선택해 확정 캔들을 다시 조회한다. 이는 REST 기반 조회이며 실시간 스트리밍 차트가 아니다.
- 주식 `source=auto`는 저장된 Toss credential이 있으면 Toss를 사용하고, 없거나 자동 조회가 실패하면 경고와 함께 Yahoo fallback을 사용한다. Toss 조회가 성공해도 확정 1시간봉이 20개 미만이거나 ATR14·최근 저점이 없으면 해당 시간봉만 Yahoo로 보완한다. SMA200·10개월 평균·주봉 SMA20/60 중 하나가 없으면 일봉만 Yahoo로 보완하고 기간별 `dataSource`와 경고에 혼합 출처를 표시한다. `source=toss`는 자동 보완하지 않는다.
- Toss는 1분봉을 한국·미국 정규장 마감 시각에 맞춘 1시간봉으로 집계한다. 세션 길이 때문에 생기는 장 초반 30분 부분 봉은 snapshot과 경고에는 남기되 지표 계산에서는 제외한다. 현재 주봉도 다음 market week가 시작되기 전에는 확정하지 않는다.
- Upbit 공개 REST는 키 없이 KRW 마켓의 1시간·4시간·일봉을 제공한다. 코인은 일봉 방향, 4시간봉 진입과 1시간봉 재확인을 조합하고, 최근 무거래 시간 공백이 있으면 신규 진입 계획을 대기한다.
- 데스크톱 코인 분석은 `KRW-*` 입력만 허용한다. BTC·USDT 호가 시장과 KRW 시장을 같은 종목처럼 변환하지 않는다.
- 장기 계획은 일봉 730일을 조회해 SMA200, 주봉 SMA20/60과 10개월 이동평균을 계산하며, 10개월 평균은 진행 중인 현재 달을 제외한 완료 월 종가만 사용한다.
- 형성 중인 봉은 확정 분석에서 제외하고 `market`, `currency`, `dataSource`, `timeframe`, `quoteAt`, `stale`을 응답과 화면에 함께 표시한다.
- 1~3일 단기·스윙·장기 계획은 구조선·ATR·장기 이동평균 조건으로 손절·익절을 계산한다. 가격 계산 상태와 신규 진입 상태를 별도 배지로 표시하며, 추세 조건이 부족한 `조건 대기`에서도 계산된 가격은 유지한다. 필수 가격 데이터가 없을 때만 고정 퍼센트 없이 `계산 불가`를 표시한다.
- 기준가는 최근 확정 종가, 일치하는 실제 보유 평단, 직접 입력 중 선택한다. 직접 입력은 0보다 큰 유한 숫자만 `entryPrice` 쿼리로 전달한다.
- 실제 보유 평단은 `planMode=position-management`로 전달한다. 장기 현재가가 무효선 아래면 `invalidation-breached`와 축소·청산·회복 행동을 우선 표시하고, 평단이 무효선 위일 때만 기존 평단 기준 목표를 함께 유지한다.
- 계획의 stop과 take-profit은 분석 조언이며 주문 제출이 아니다. `orderSubmissionAttempted=false`와 broker stop 부적격 계약을 유지한다.

### 섹터 강도

- 사이드바의 `섹터`는 한국과 미국을 전환하며 대표 ETF의 강약을 히트맵과 시장 대비 초과수익률 순위봉으로 표시한다. 타일을 선택하면 대표 ETF를 기존 차트 workspace에서 분석한다.
- 미국은 SPY와 GICS 11개 Select Sector SPDR ETF를, 한국은 KODEX 200과 반도체·자동차·은행·증권·헬스케어·보험·건설·IT·K콘텐츠·에너지화학·철강·기계장비·운송·필수소비재·경기소비재·부동산리츠 ETF를 비교한다.
- 1일은 정규장 현재가와 전일 종가를 우선 사용해 `장중 잠정`으로 표시하고, 1주·1개월은 각각 확정 일봉 5·21거래일 기준이다. 강도는 `ETF 수익률 - 시장 벤치마크 수익률`이며 주문 신호가 아니다.
- sidecar는 Yahoo provider 요청을 최대 4개씩 처리하고 시장별 결과를 5분 캐시한다. 개별 ETF 실패는 성공 항목을 유지하면서 제외 종목을 표시하고, 벤치마크 실패는 상대강도 계산을 중단한다. 이전 성공 결과가 있으면 `이전 데이터`로 명시한다.

### Toss 연결

- `검증 후 저장`은 token과 계좌 endpoint를 확인한 뒤 credential을 저장한다.
- 계좌가 하나면 자동 선택하고, 여러 개면 사용자가 조회·자동화 준비에 사용할 계좌를 선택한다.
- `공인 IP 확인`과 `IP 복사`는 Toss 개발자 콘솔의 허용 IP 등록을 돕는다.
- credential 삭제는 sidecar 암호화 저장소와 Keychain 백업을 함께 제거한다.
- 보유, 미체결, 매수 가능 금액, 매도 가능 수량과 주문 precheck는 실제 주문 없이 사용할 수 있다.
- Toss 실거래는 현재 Mac·선택 계좌의 자동 readiness, 이용 동의, 별도 수동 토글, 10분 미리보기, typed confirmation, RiskCheck와 KST 한도를 모두 통과한 지정가 주문만 제출한다.
- credential 등록 성공이나 계좌 조회는 live 제출 상태로 전환되지 않는다.

### 전략과 자동화

- 현재 엔진은 `ladder`, `percent-grid`, `loop-grid` 계약을 지원한다.
- 전략은 초안 저장, 현재 config hash 시뮬레이션, 명시적 활성화 순서로 준비한다.
- Beginner-first 전략 workspace는 주식 고정 수량(기본 1주), 코인 고정 주문금액(기본 50,000원), 현재가·기준가 분리, 차수별 예상 수량·노출을 표시한다. 기존 `orderSizing` 없는 전략은 금액 기준으로 호환한다.
- `현재 틱`, `발동가 테스트`와 자동화 dry-run은 broker submit을 호출하지 않는다.
- `자동화 1회 실행`은 거래소별 live 토글이 열리기 전까지 paper 계좌만 갱신한다. 코인 live 자동화는 수동 주문 5건·재시작 재조정·kill switch 증거 뒤 ladder KRW 지정가에 한해 열리고 실제 체결 확인 뒤 전략 단계를 반영한다.
- 연속 scheduler는 기본 OFF이며 30초~15분 주기, 중복 cycle 방지, 마지막 결과와 다음 실행 시각을 저장한다.
- `보유 조회`, `사전검증`, `주문 동기화`는 각각 조회와 준비 작업이며 그 자체로 주문을 만들지 않는다.
- `전략 초안`은 현재 limit `OrderIntent`를 3차 `percent-grid` 초안으로 변환하며, 시뮬레이션과 활성화를 대신하지 않는다.
- Beginner-first 화면은 전략 설정의 시각적 진입점만 바꿨다. `초안 저장 → 조건 확인 → 시뮬레이션 → 활성화` 순서와 scheduler·worker·kill switch 동작은 변경하지 않았다.
- 추가매수 중단선은 신규 매수만 차단하고, 손절은 grid 평단·loop 진입가·ladder 보유 평단 기준으로 paper 전량 청산한다. 청산 실패는 `stop-loss-pending`으로 다음 cycle에 재시도하며, 완료 후 전략을 자동 일시중지하고 시뮬레이션을 폐기한다.

문장형 블록, 동적 1~20차와 직접 만들기는 아직 HTML 시안이다. [전략 조립기 명세](automation-strategy-builder-spec.md)를 SwiftUI와 엔진에 연결하기 전에는 현재 앱 기능으로 표시하지 않는다.

### Upbit·Bithumb

- 거래소별 credential을 검증하고 암호화 저장소와 Keychain에 보관한다.
- 계좌, 주문 가능 정보, REST 현재가 응답 신선도, 최소·최대 주문금액과 수수료를 확인하고 limit 주문 입력을 preview한다. Upbit 호가 단위는 deprecated chance 필드가 아니라 공식 `/v1/orderbook/instruments`의 `tick_size`를 사용하고, Bithumb은 chance 응답의 `price_unit`을 사용한다.
- Upbit는 공식 `/v1/orders/test`로 실제 주문 없이 권한·JWT·KRW 지정가 형식을 확인한다. 테스트 식별자는 실제 원장·조회·취소·수동 5건 조건에 반영하지 않는다. Upbit 미체결 조회는 `/v1/orders/open`을 사용한다.
- Bithumb은 1.2.0-beta.2에서 mock lifecycle까지만 검증하며 실제 연결·실주문 인수는 완료로 표시하지 않는다.
- 암호화폐 전략은 거래소를 명시하며 페이퍼 모드에서는 소수 수량을 지원한다.
- Upbit·Bithumb `KRW-*` 지정가는 자동 readiness, 현재 설치·API binding hash, 이용 동의, 거래소별 토글, `OrderIntent`·`RiskCheck`, 잔고·수수료·최소 주문금액·호가 단위·현재가 신선도 재검증과 주문 요약 재입력을 모두 통과한 경우에만 제출한다. 거래소별 주문당 100,000 KRW, KST 일일 누적 300,000 KRW 한도를 수동·자동이 공유한다.
- 429·5xx·timeout 또는 응답 불명은 자동 재시도하지 않고 해당 거래소 토글을 잠근다. Upbit `identifier`, Bithumb `client_order_id` 조회가 주문을 확인할 때만 잠금을 해소한다.
- 미체결과 부분체결은 30초 동기화하며 자동 취소하지 않는다. 같은 전략 단계의 후속 주문을 차단하고, 사용자가 확인 문구를 입력한 미체결 일괄 취소만 허용한다.
- 주문 사전검증 결과의 차단 사유와 현재가·최소 주문금액을 앱에서 표시하며, 이 점검은 broker submit을 호출하지 않는다.

거래소 연결 여부와 실시간 코인 차트는 현재 별도 기능이다. credential 검증이 성공해도 WebSocket 캔들 수집을 구현하기 전에는 실시간 차트로 표현하지 않는다.

### 뉴스와 커뮤니티 민심

- 공식 Federal Reserve, SEC, BEA RSS는 앱 실행 중 2분마다 polling한다. 동시 갱신은 single-flight로 합치고 실패 소스에는 지수 backoff를 적용한다. 이는 streaming 실시간 뉴스가 아니다.
- 선택 종목과 직접 연결된 ticker 뉴스, 금리·고용·GDP·무역 같은 거시 뉴스만 개요의 관련 뉴스에 표시한다.
- 커뮤니티 민심은 사용자가 `뉴스·알림 갱신`을 실행할 때 선택 종목 기준으로 계산한다. 정상 응답은 30분 캐시하지만 수동 갱신은 캐시를 우회하고, 소스 오류·timeout 응답은 1분만 캐시한다.
- `lowEvidence=true`이면 점수보다 `근거 부족`을 우선 표시한다. 민심 데이터는 참고 근거이며 `OrderIntent`, `RiskCheck` 또는 broker 입력으로 사용하지 않는다.
- Reddit은 뉴스·알림 화면에서 Client ID와 Secret을 입력하면 이 Mac의 Keychain에 저장하고 sidecar를 재시작해 공식 OAuth API로만 읽는다. 앱이 관리하는 sidecar는 부모 Reddit 환경변수를 상속하지 않으며, 환경변수 방식은 독립 실행한 개발용 sidecar에서만 유지한다. 설정이 없으면 `configuration-required`로 표시한다.
- 일반 시작은 Toss·Upbit·Bithumb 비밀값을 읽지 않고 sidecar의 비민감 상태만 사용한다. Reddit은 연결된 경우 비대화식으로 최대 한 번 읽으며, 권한 확인 UI가 필요하면 값을 노출하지 않고 연결되지 않은 상태로 시작한다.
- `Keychain 권한 재설정`은 사용자가 명시적으로 실행할 때만 상호작용 읽기를 허용하고, 현재 정식 서명 기준으로 항목을 재등록한다. 재등록 실패 시 메모리의 원본으로 복구를 시도하며 자동 삭제나 로그 노출을 하지 않는다.
- Toss·Upbit·Bithumb의 `검증 후 저장`은 엔진 오프라인 여부와 무관하게 ID·Secret을 입력하면 활성화된다. 저장 시 앱이 sidecar를 자동 시작하고 최대 15초 기다리며, 시작 실패 시 credential POST와 Keychain 저장을 호출하지 않고 입력값을 유지한다.
- 연결 화면은 번들 파일 누락, 실행 권한 거부, 프로세스 조기 종료 코드, health timeout을 구분해 표시한다. 해결 동작은 `엔진 다시 시작`과 앱 지원 폴더의 `로그 열기`이며 Gatekeeper 비활성화나 quarantine 임의 제거는 안내하지 않는다.

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

`yarn mac:open`과 `dist/macos/StockAnalysis.app` 직접 실행은 개발 진단 전용이다. 사용자 credential이 있는 일반 실행·Keychain 권한 재설정은 Developer ID 서명·공증·stapling·Gatekeeper 검증을 통과해 `/Applications`에 설치된 앱에서만 수행한다.

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

패키징은 번들 Node와 동적 라이브러리, Swift 실행 파일, 앱 순서로 hardened runtime 서명한 뒤 앱을 먼저 공증·staple한다. 그 앱으로 ZIP과 DMG를 만들고 DMG도 공증·staple한다. 대상 아키텍처의 새 사용자 실기기 설치까지 완료한 최종 패키지만 `MACOS_HARDWARE_VERIFIED=1`을 설정한다.

Apple ID 방식을 사용할 때는 `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`를 로컬 환경에서만 제공한다. 이 값과 notary credential을 문서, Git, 로그와 리포트에 넣지 않는다.

manifest의 `developerIdSigned`, `notarized`, `staplerValidated`, `gatekeeperAccepted`, `hardwareVerified`가 모두 참이어야 하며, 공개 준비 완료 판정에는 두 아키텍처의 checksum과 Apple Silicon·Intel 대상 Mac 설치 확인이 모두 필요하다.

Swift는 sidecar에 `--parent-pid`를 전달한다. 정상 종료는 관리 중인 자식 프로세스에 SIGTERM을 보내 최대 1초를 기다린 뒤 그 자식만 강제 종료하며, 앱 강제 종료 시 Node watchdog이 부모 PID 변경을 감지해 서버와 38771 포트를 닫는다.

## 안전 경계

Toss·Upbit·Bithumb 실제 주문은 각각 다음 조건을 모두 통과해야 한다.

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
- Toss API는 자동 readiness와 이용 동의가 기록된 단일 Mac·선택 계좌에 한해 KR/US 지정가 submit 경로에 도달한다. `unknown` 주문은 자동 재시도·추측 매칭 없이 모든 live 제출을 잠근다.
- 공식/RSS 뉴스 polling 실패는 분석·자동화를 중단시키지 않지만 실패 상태를 표시한다.
- 커뮤니티 민심은 주문 입력에 직접 사용하지 않는다.
- Upbit·Bithumb API는 readiness·이용 동의·거래소별 토글이 열린 현재 Mac에서만 KRW 지정가 submit 경로에 도달한다. `unknown`은 자동 재시도하지 않고 client order ID 조회 전까지 해당 거래소를 잠근다.
- 실제 계좌 조회가 가능한 상태에서는 자동 self-test가 사용자 의도 없이 계좌 endpoint를 호출하지 않는다.
