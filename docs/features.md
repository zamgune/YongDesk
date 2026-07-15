# YongStockDesk 기능 상태

이 문서는 실제 코드와 검증 근거를 기준으로 유지하는 기능 목록이다. README나 UX 시안과 설명이 다르면 이 문서의 상태를 우선하고, 코드 변경과 같은 PR에서 갱신한다. 과거 DMG·UI smoke 결과는 [1.0.0 릴리스 이력](releases/v1.0.0.md)에 보존하며, 새 코드·패키징 변경 뒤에는 같은 결과를 현재 증거로 재사용하지 않는다.

## 상태 정의

| 상태 | 의미 |
|---|---|
| 구현됨 | 현재 코드에 연결돼 있고 관련 테스트 또는 앱 검증 근거가 있다. |
| 외부 설정 필요 | 구현은 존재하지만 사용자 credential, 계좌, 허용 IP, 서명 인증서 같은 외부 준비가 필요하다. |
| 부분 구현 | 핵심 경로는 동작하지만 목표 UX나 데이터 품질이 아직 완성되지 않았다. |
| HTML 시안 | 브라우저에서 상호작용만 검토하며 SwiftUI와 엔진에는 연결되지 않았다. |
| 명세만 존재 | 타입, 계산식과 안전 규칙만 문서화됐고 런타임 계약은 아직 변경되지 않았다. |
| 후속 | 구현·연결 작업이 시작되지 않았거나 명시적으로 다음 단계로 미뤘다. |

## 기능 요약

| 영역 | 기능 | 상태 | 조건·제한 | 주문 제출 |
|---|---|---|---|---|
| 앱 셸 | Finder/Dock에서 실행되는 SwiftUI 앱과 번들 sidecar | 구현됨 | 표시 이름과 아이콘은 `Yong'Desk`, 호환 번들 이름은 `StockAnalysis.app` | 없음 |
| 앱 셸 | 메뉴바 상태, 앱 점검, sidecar 로그, 배포 점검 | 구현됨 | 로컬 App Support와 번들 상태를 사용 | 없음 |
| 앱 셸 | Keychain 비대화식 시작, 명시적 권한 재설정, sidecar 부모 감시 | 구현됨 | 일반 시작은 Toss·코인 secret 0회, Reddit 최대 1회 읽기. 정식 서명 설치본에서만 ACL 재등록 | 없음 |
| 앱 셸 | 차트 중심 사이드바와 단순화된 beginner-first 레이아웃 | 구현됨 | `BeginnerFirstRootView`가 승인된 `beginner-first-v3.html` 정보 구조를 적용하며 최소 크기는 1024×720 | 없음 |
| 시장 비교 | 한국·미국 섹터 강도 히트맵과 순위봉 | 구현됨 | 대표 섹터 ETF의 1일·1주·1개월 수익률을 SPY·KODEX 200 대비 초과수익률로 정렬. 1일은 장중 잠정값을 포함하며 Yahoo 부분 실패·stale 상태를 표시 | 없음 |
| 앱 셸 | 개인 관심종목 목록과 한국·미국 주식·코인 요약 | 구현됨 | 최대 20개를 이 Mac의 sidecar 저장소에 보관하며, 현재가·등락·출처·갱신 상태만 비교 | 없음 |
| 온보딩 | 삼성전자 예제, 설정 내 인라인 API 연결과 나중에 연결 경로 | 구현됨 | API 키 없이 Yahoo fallback 분석·Upbit 공개 분석·모의투자로 시작 가능 | 없음 |
| 시장 데이터 | US·KOSPI·KOSDAQ·CRYPTO 종목 검색과 수동 티커 입력 | 구현됨 | 종목 마스터 캐시가 없으면 seed/fallback 사용 | 없음 |
| 차트 | 일봉 기반 분석 차트와 지표·신호 표시 | 구현됨 | 데이터 공급자 품질과 거래일 지연 영향 | 없음 |
| 차트 | macOS의 `5분·15분·30분·1시간·4시간·일봉·주봉` 선택 | 구현됨 | 선택한 주기 데이터를 다시 조회하며, 주식은 Yahoo 보조 시세·코인은 Upbit 공개 캔들을 사용 | 없음 |
| 시장 데이터 | 주식 1시간·일봉 분석 workspace | 구현됨 | Toss 연결 시 1분봉을 장 마감에 맞춘 1시간봉으로 집계하고 부분 봉은 계산에서 제외, 일봉은 공식 캔들 사용, 미연결·자동 fallback은 Yahoo | 없음 |
| 시장 데이터 | Upbit 공개 1시간·4시간·일봉 분석 workspace | 구현됨 | API 키 없이 KRW 마켓 REST 캔들 사용, 형성 중 봉과 최근 거래 공백은 신규 진입 계산에서 보수적으로 처리 | 없음 |
| 차트 | Toss·Upbit WebSocket 실시간 차트 | 후속 | 현재 멀티타임프레임 분석은 REST 기반이며 streaming이 아님 | 없음 |
| 분석 | 단건 종목 분석, 지지·저항, `tradeSetup`, 돌파 상태 | 구현됨 | 분석은 주문 추천이나 수익 보장이 아님 | 없음 |
| 분석 | 신호 신뢰도, 유사 표본, 최대 상승·하락과 손익비 | 구현됨 | 표본 부족 시 `insufficient-data` | 없음 |
| 분석 | 시장·통화·출처·주기·기준 시각·지연 metadata | 구현됨 | `market`, `currency`, `dataSource`, `timeframe`, `quoteAt`, `stale`을 응답과 UI에 표시 | 없음 |
| 분석 | 1~3일 단기·스윙·장기 익절·손절 계획 | 구현됨 | 필수 봉·지표가 없으면 고정 퍼센트 대신 `계산 불가` 또는 `조건 대기` 반환 | 없음 |
| 분석 | 주식 플레이북 v2 검증 계약 | 구현됨 | workspace `contractVersion: 2`, `tradeSignalSet`, 단건 `signalEvents`, 관심종목 `tradePlan`을 additive 제공. 섹터 ETF 상대강도와 curated 50일 leader는 기초 일봉 시각·age를 검증한다. 대표성 있는 point-in-time 시장 breadth 공급자는 아직 없어 market gate는 `unavailable`이며, 승인 calibration record가 없으면 `shadow` 유지 | 없음 |
| 분석 | 한국 주식 관심종목 장중 급락반등 감시 | 구현됨 | 검증된 Toss API·앱 실행·KRX 정규장 필요. 확정 5분봉과 직전 20거래일 동일 KST 구간 RVOL을 사용하고 최대 30세션을 로컬 누적. 표본 누적 전에는 `unavailable` | 없음 |
| 브리핑 | US·KR 시장 브리핑, 주도 후보, 진입 후보 큐 | 구현됨 | 시장 데이터 실패 시 safe fallback 사용 | 없음 |
| 뉴스 | 공식/RSS 뉴스 이벤트, 2분 polling과 신뢰도 표시 | 부분 구현 | streaming이 아니며 single-flight·소스별 오류 backoff를 사용 | 없음 |
| 민심 | 종목별 커뮤니티 공포·과열·분열 점수와 근거 링크 | 부분 구현 | 30분 캐시, 낮은 표본 우선 표시, Reddit OAuth는 앱 Keychain에서 선택 연결 | 없음 |
| 자산 | 웹 포트폴리오 등록·손익·오늘 할 일 | 구현됨 | 웹 fallback/admin 화면에서 제공 | 없음 |
| 자산 | Toss 보유 조회, 매수 가능 금액과 미체결 주문 조회 | 외부 설정 필요 | 검증된 Toss credential과 계좌 필요 | 없음 |
| 전략 | `ladder`, `percent-grid`, `loop-grid` 전략 계약 | 구현됨 | 저장, 시뮬레이션과 활성화 단계가 분리됨 | 직접 제출 안 함 |
| 전략 | 주식 고정 수량·코인 고정 주문금액과 실시간 주문 미리보기 | 구현됨 | `orderSizing`이 없는 기존 전략은 금액 기준을 유지하고 코인 수량은 최대 8자리 | 거래소별 precheck 필요 |
| 전략 | 추가매수 중단선·평단/진입가 손절·실패 재시도 | 구현됨 | 손절 성공 시 paper 전량 청산 후 전략을 disabled로 전환하고 시뮬레이션을 폐기 | 없음 |
| 전략 | 1% 반복과 분할차수 전략의 trigger·state 계산 | 구현됨 | 실제 체결가, 쿨다운과 위험 제한 사용 | 직접 제출 안 함 |
| 전략 | 문장형 블록, 동적 1~20차, 직접 만들기 | HTML 시안 | 실제 `RepeatPolicy`와 `custom` 계약 연결 전 | 없음 |
| 자동화 | 전략 CRUD, config hash 시뮬레이션, 활성화 | 구현됨 | 현재 시뮬레이션 통과 전 활성화 차단 | 없음 |
| 자동화 | 1회 실행, 연속 scheduler, worker pause | 구현됨 | scheduler 기본 OFF, 중복 cycle 방지. Toss 자동화 live는 수동 인수 5건·재시작 재조정·안전 증거 뒤 별도 OFF 토글 | 실 API 인수 필요 |
| 모의투자 | 페이퍼 주문·체결·보유·감사 로그 | 구현됨 | 로컬 저장소 사용, 실브로커 호출 없음 | 없음 |
| 주문 안전 | holdings, precheck, sync, `OrderIntent`, `RiskCheck` | 구현됨 | 10분 미리보기·제출 직전 재검증·typed confirmation·Toss KR/US 지정가 제출 | 실 API 인수 필요 |
| 안전장치 | 설치·계좌 바인딩, 수동/자동화 gate, worker control, kill switch | 구현됨 | sidecar fail-closed, KST 매수 한도, `unknown` 주문 전역 잠금 | 차단 경계 |
| Toss | credential 검증·저장, 계좌 선택, 공인 IP 확인 | 외부 설정 필요 | 엔진 오프라인이어도 저장 버튼 활성화. 저장 시 sidecar 자동 복구를 15초 기다리며 실패하면 입력 유지·POST/Keychain 저장 없음. 사용자 키와 Toss 허용 IP 등록 필요 | 없음 |
| Toss | 국내·미국 주식 지정가 주문 | 구현됨 | 단일 Mac·선택 계좌에서 수동 기본 OFF. 매수 건당 10만원·KST 일 30만원, USD 환율 fail-closed | 실 API 인수 필요 |
| 코인 | Upbit·Bithumb credential, 잔고·주문가능정보·현재가·최소금액 사전검증 | 외부 설정 필요 | 공통 sidecar 자동 복구·시작 진단 적용. 거래소별 API 키 필요. 조회·사전검증은 주문을 호출하지 않음 | 없음 |
| 자산 | Toss·Upbit·Bithumb 통합 실자산 | 구현됨 | 포지션 중심 보드에서 공급자 색상·상태, 종목 수 분포, 공급자·통화별 평가를 표시. 15초 메모리 캐시, 30초 UI 갱신, stale/부분 실패 유지. 통화 간 합산 안 함 | 실 API 인수 필요 |
| 코인 | Upbit·Bithumb KRW 수동 지정가 주문 | 구현됨 | 자동 readiness, 이용 동의, 거래소별 typed 토글, RiskCheck·잔고·호가 재검증, 주문 요약 재입력 필요 | 실 API 인수 필요 |
| 코인 | Upbit·Bithumb 지정가 자동매매 | 구현됨 | 거래소별 수동 5건·재시작 재조정·kill switch 증거 뒤 별도 OFF 토글. ladder 전략은 실제 체결 후 단계 반영 | mock 검증·실 API 읽기 전용 인수 필요 |
| 배포 안전 | 1.2.0-beta.2 무실주문 잠금 | 구현됨 | Toss·Upbit·Bithumb 실제 제출·취소는 HTTP 423 `PRE_RELEASE_LIVE_LOCK`, 자동화는 paper-only | 내부 베타 전용 |
| 코인 | Upbit 공식 주문 생성 테스트 | 구현됨 | `/v1/orders/test`만 호출하며 실제 주문·체결·수수료·원장 반영 없음 | 주문하기 권한 필요 |
| 코인 | 시장가·출금·다건 주문 제출 | 제외 | 사용자 확인형 미체결 일괄 취소만 별도 제공 | 차단 경계 |
| 배포 | arm64/x64 앱·DMG·ZIP·manifest 생성·설치 검증 | 구현됨 | 생성·검증 도구가 구현됨. 1.0.0 로컬 검증 기록은 릴리스 이력에 보존되며, 새 패키지는 아키텍처별로 다시 검증해야 함 | 없음 |
| 배포 | Gatekeeper 경고 없는 공개 배포 | 외부 설정 필요 | Developer ID, 앱·DMG notarization/stapling, Gatekeeper 평가, Apple Silicon·Intel 실기기 검증이 모두 필요 | 없음 |

## 현재 macOS 사용자 흐름

현재 기본 창은 승인된 `beginner-first-v3.html`의 정보 구조를 적용한 SwiftUI `BeginnerFirstRootView`다.

1. 앱이 번들된 TypeScript sidecar를 `127.0.0.1`에서 자동 시작한다.
2. 첫 실행에서는 `삼성전자 예제 분석 시작`, `내 API 연결하기`, `나중에 연결` 중 하나를 선택한다. `내 API 연결하기`는 설정 workspace의 인라인 연결 관리로 이동하며, API 연결은 메인 화면 진입 조건이 아니다.
3. 왼쪽의 차트·관심종목·내 자산·전략·자동화와 설정에서 필요한 화면을 열고, 상단에서 주식·코인과 종목을 선택한다.
4. 관심종목은 차트에서 현재 종목을 추가해 최대 20개까지 저장하며, 행을 선택하면 단건 차트·분석으로 돌아간다.
5. 주식은 Toss가 연결되지 않았으면 Yahoo fallback으로, 코인은 API 키 없이 Upbit 공개 REST로 분석한다.
6. 분석 화면은 최근 종가와 일봉 차트 뒤에 1~3일 단기·스윙·장기 계획, 신호, 뉴스·민심 근거를 점진적으로 표시한다.
7. 모의 주문은 사용자가 drawer를 연 뒤에만 기존 paper 흐름으로 진행하며 실브로커를 호출하지 않는다.
8. 전략 설정은 `초안 저장 → 조건 확인 → 시뮬레이션 → 활성화` 순서와 scheduler·자동화 일시중지·kill switch 동작을 유지한다.
9. `내 자산`은 Toss·Upbit·Bithumb 실자산 포트폴리오 보드만 제공한다. 모의계좌 전환은 사용자 자산 화면에서 제거했지만, 1.2.0-beta.2의 자동화와 안전 검증을 위한 paper 엔진은 내부 경로로 유지한다. 실주문과 취소는 전역 잠금되며 모든 토글은 시작 시 OFF로 초기화된다.

문장형 전략 조립기는 여전히 HTML 시안이다. Beginner-first 레이아웃 적용이 기존 전략 계약이나 자동화 순서를 변경한 것은 아니다.

## 시장 분석과 브리핑

### 구현된 분석 계약

- `/api/market/:symbol`과 local engine은 가격, 지표, 지지·저항, 패턴과 실행 참고 정보를 반환한다.
- `/api/local/analysis/workspace`는 주식의 `1h·1d`, 코인의 `1h·4h·1d` 분석과 보유기간별 계획을 한 응답으로 제공한다.
- 주식 1~3일 단기는 일봉 위험 필터와 확정 1시간봉 진입, 스윙은 일봉 방향과 확정 1시간봉 진입을 사용한다. 6.5시간 정규장의 부분 4시간봉은 핵심 조건으로 사용하지 않는다.
- 코인 1~3일 단기·스윙은 일봉 방향, 4시간봉 진입과 1시간봉 재확인을 조합한다.
- 데스크톱 코인 분석 입력은 현재 `KRW-*`만 허용한다. BTC·USDT 호가 시장을 KRW 데이터로 바꿔 표시하지 않고 명시적으로 거절한다.
- 장기 10개월 이동평균은 진행 중인 현재 달을 제외하고 완료된 월 종가만 사용한다.
- workspace의 각 주기 분석 응답은 시장, 통화, 데이터 출처, 주기, 기준 시각과 지연 상태를 함께 반환한다.
- `breakoutRule`은 신고가, 거래량, 손절 보조선과 추적 상태를 표현한다.
- `tradeSetup`은 핵심 기준선, 실패선, 유효·무효 조건과 진입 방식을 표현한다.
- `signalReliability`는 유사 신호 표본과 최대 상승·하락을 제공하며 매수 확정값으로 사용하지 않는다.
- 주식 workspace v2는 네 플레이북의 gate, 구조 손절, 청산 후보와 검증 상태를 `tradeSignalSet`으로 반환한다. runtime은 종목-섹터 ETF 상대강도와 curated 후보군의 50일 leader 순위를 조회하고 기초 확정 일봉의 `asOf`·`dataAgeSeconds`를 검증한다. curated 후보군 비율은 선택편향 때문에 실제 시장 breadth로 사용하지 않으며, 대표성 있는 point-in-time 전체 시장 공급자가 연결될 때까지 market gate를 fail-closed `unavailable`로 유지한다. runtime storage root의 `backtests/calibrations/registry.json`에 재실행 검증을 통과한 승인 record가 없으면 플레이북도 `shadow`다.
- 단건 분석의 `signalEvents`는 divergence의 발생 시각과 확인 시각을 분리한다. 관심종목의 `tradePlan`도 주문 미호출 플래그를 유지한다.
- 시장 리포트의 `entryCandidates`는 `tradable`, `probe`, `armed`, `watch`, `blocked` 상태로 자동화 준비도를 구분한다.
- 페이퍼 실행은 `entryCandidates`를 사용할 수 있지만 UI의 분석 결과가 실브로커를 직접 호출하지 않는다.

### 보유 기간별 익절·손절 계획

[보유 기간별 익절·손절 명세](ux-prototypes/macos-native/horizon-exit-plan-spec.md)는 분석 workspace와 SwiftUI에 연결돼 있다.

- 1~3일 단기: 주식은 일봉 위험 필터·1시간봉 진입, 코인은 4시간 위험 필터·1시간봉 진입
- 스윙: 주식은 일봉 방향·1시간봉 진입, 코인은 일봉 방향·4시간봉 진입·1시간봉 재확인
- 장기: 일봉·주봉 구조, SMA200과 종가 기준 무효선
- 계산 기준가: 최근 확정 종가를 기본으로 하며, 현재 종목·통화가 일치하는 보유 평단 또는 사용자가 입력한 양수 가격으로 다시 계산할 수 있다.
- 장기 보유 평단은 `position-management`로 계산한다. 무효선 이탈 보유는 빈 계획 대신 현재가·무효선·재진입선과 축소·청산·회복 행동을 표시하며, 평단도 무효선 이하이면 임의 익절 목표를 만들지 않는다.
- 손절·익절은 분석 참고값이며 broker stop으로 자동 제출하지 않는다.
- 필수 가격 지표가 없으면 `계산 불가`를 반환한다. 가격선은 계산됐지만 추세·거래량·신뢰도 조건이 부족하면 가격을 유지한 채 `조건 대기`로 신규 진입 판단만 보류한다.

## 전략과 자동화

### 현재 엔진

- `ladder`: 고정 가격 단계의 1회성 진입·청산 의도
- `percent-grid`: 기준가 대비 누적 하락 차수와 차수별 익절
- `loop-grid`: 기준가 대비 하락 매수, 실제 매수가 대비 상승 매도와 기준가 갱신
- `support-rebound`: 지지선·저항선과 종료 규칙을 사용하는 ladder preset

사용자 표시에는 `분할차수`를 사용한다. 저장 데이터 호환을 위한 기존 preset ID는 코드 계약에서만 유지하며 새 사용자 문구에 노출하지 않는다.

### 전략 조립기 상태

[전략 조립기 명세](automation-strategy-builder-spec.md)와 HTML 시안은 다음을 검증했지만 SwiftUI와 엔진에는 아직 적용되지 않았다.

- `1% 반복`, `분할차수`, `지지선 반등`, `직접 만들기` 네 템플릿
- 1~20차 동적 추가·삭제와 재번호 부여
- 상대가격 반복과 고정가격 1회 변환
- 제거할 수 없는 일일 횟수, 최대 보유, 손실, 시간과 쿨다운 제한
- 모의검증을 통과한 초안만 저장하고 주문·자동화는 시작하지 않는 흐름

향후 적용 시 기존 저장 전략에 반복 정책이 없으면 현재 동작을 보존하고, 새 전략의 기본 반복은 10회로 설정한다.

## 브로커와 주문 안전

Toss 실제 제출은 다음 순서를 바꿀 수 없다. 코인 제출은 계속 이 경계 전에 차단한다.

```text
전략 신호
→ OrderIntent
→ RiskCheck
→ 검증된 broker credential
→ 실행 계좌 선택
→ 운영자 live gate
→ 사용자 live gate
→ worker control
→ kill switch
→ broker adapter
```

- credential 저장 성공은 실거래 활성화가 아니다.
- 계좌 조회, holdings, precheck, sync와 dry-run은 주문 제출이 아니다.
- UI, 분석 코드와 뉴스 신호는 broker adapter를 직접 호출하지 않는다.
- 실거래가 켜져 있어도 `RiskCheck` 실패, worker pause 또는 kill switch가 제출을 차단한다.
- 모든 제출·차단·거절·실패는 로컬 audit trail에 기록한다.
- Toss는 1.1.0에서 QA 승인된 단일 Mac·선택 계좌의 KR/US 지정가 주문만 제출한다. `unknown` 주문은 추측 복구하지 않고 모든 live 제출을 잠근다. 자세한 운영 조건은 [1.1.0 Toss 실거래 운영 경계](live-trading-v1.1.md)를 따른다.
- Upbit·Bithumb은 1.1.0에서도 credential·잔고·주문가능정보·현재가 확인과 paper 자동화까지만 제공한다. 실제 코인 주문은 체결 동기화와 재시작 멱등성 검증 전까지 sidecar에서 차단한다.

## 배포 상태

`yarn mac:app`은 package version을 Info.plist와 sidecar에 일치시킨 `dist/macos/StockAnalysis.app`을 만들고, 고정된 Node 22.17.0 런타임과 sidecar를 포함한다. arm64/x64 DMG·ZIP·manifest의 1.0.0 생성·검증 결과는 [릴리스 이력](releases/v1.0.0.md)에 보존한다.

새 패키지를 배포 증거로 사용하려면 해당 패키지의 install verification에서 `sidecarVerified`, `sidecarEndpointVerified`, `appLaunchVerified`, `uiSmokeVerified=true`를 다시 확인한다. UI smoke는 1440×900과 최소 1024×720 콘텐츠 영역을 확인하고 실제 주문 제출 버튼을 누르지 않는다. 경고 없는 공개 배포 판정에는 다음이 추가로 필요하다.

- Developer ID Application 인증서
- hardened runtime 서명
- Apple notarization과 stapling
- 실제 Apple Silicon·Intel 대상 Mac 설치 확인
- 사용자별 Toss credential, 허용 IP와 계좌 준비

## 코드와 문서 근거

- [macOS 네이티브 앱](macos-native.md)
- [기능 확장 가이드](feature-extension-guide.md)
- [전략 V2](../STRATEGY_V2.md)
- [전략 조립기 명세](automation-strategy-builder-spec.md)
- [보유 기간별 익절·손절 명세](ux-prototypes/macos-native/horizon-exit-plan-spec.md)
- [신고가 돌파 룰](breakout-rule.md)
- `scripts/local_engine.mts`
- `apps/macos/StockAnalysisMac`
- `tests/automation_strategy.test.mts`
- `tests/local_engine.test.mts`
- `tests/toss_client.test.mts`

## 갱신 규칙

- 사용자 기능의 코드와 테스트가 추가된 PR에서 이 문서의 상태를 함께 변경한다.
- HTML 또는 명세만 추가한 경우 `구현됨`으로 표시하지 않는다.
- 외부 credential 없이는 사용할 수 없는 기능을 무조건 `구현됨`으로 표현하지 않는다.
- 주문 경계나 live gate가 바뀌면 이 문서, 네이티브 앱 문서와 관련 테스트를 함께 갱신한다.
