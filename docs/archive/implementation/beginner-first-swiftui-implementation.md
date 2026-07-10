# Beginner-first SwiftUI UI/UX 전환 기준

> Archive · v3 정보 구조를 실제 SwiftUI에 적용할 때 사용한 완료된 구현 기록이다. 현재 제품 상태는 [현재 기능](../../features.md)과 [macOS 네이티브 앱](../../macos-native.md)을 우선한다.

이 문서는 승인된 [초보자 중심 HTML v3 시안](../../ux-prototypes/macos-native/beginner-first-v3.html)을 실제 YongStockDesk SwiftUI 앱에 적용하기 위한 구현 기준이었다. HTML을 그대로 복사하는 것이 아니라 현재 sidecar, 선택형 credential, 분석, 전략과 paper-only 안전 경계를 유지하면서 화면 구조를 교체했다.

관련 기준 문서:

- [현재 기능 상태](../../features.md)
- [macOS 네이티브 앱](../../macos-native.md)
- [전략 조립기 명세](../../automation-strategy-builder-spec.md)
- [보유 기간별 익절·손절 명세](../../ux-prototypes/macos-native/horizon-exit-plan-spec.md)
- [YongStockDesk 1.0.0 릴리스 범위](../../releases/v1.0.0.md)

## 1. 목표와 고정 원칙

현재 앱의 진단용 터미널 대시보드를 다음 흐름으로 바꾼다.

```text
삼성전자 예제 또는 내 종목 선택
→ 차트와 시장 상태 확인
→ 분석 근거 확인
→ 필요할 때 API 연결·주문 초안·전략·자동화 공개
```

고정 원칙은 다음과 같다.

1. 첫 실행은 API 키 없이 삼성전자 예제 분석으로 진입할 수 있다.
2. Toss 등록은 더 정확한 공식 주식 데이터와 계좌 조회를 위한 선택 기능이며 실거래 활성화를 의미하지 않는다.
3. Upbit 공개 캔들 분석은 credential 없이 동작한다. Upbit·Bithumb credential은 잔고와 주문 가능 정보가 필요할 때만 요구한다.
4. 차트, 현재가, 시장 상태와 선택 종목 분석을 첫 화면의 중심으로 둔다.
5. 진단, 배포, 로그, IP와 gate 상세는 `설정 > 연결 및 진단`으로 이동한다.
6. 전략·자동매매의 입력, 검증, 시뮬레이션, 저장·활성화 순서는 현재 동작을 유지하고 시각 스타일만 바꾼다.
7. 분석값을 주문에 적용해도 주문 초안만 채우며 자동 제출하지 않는다.
8. 데스크톱 1.0.0의 Toss·코인 broker submit 차단을 유지한다. UI 개편 작업에서 live 주문을 다시 열지 않는다.

## 2. 현재와 목표의 차이

| 영역 | 현재 SwiftUI | 목표 |
|---|---|---|
| 첫 실행 | 분석 전용·Toss·코인 경로 선택 가능 | 삼성전자 예제 CTA, API 연결은 선택 |
| 메인 | 상단 명령과 진단 버튼이 많은 터미널형 화면 | 차트 중심, 왼쪽 사이드바, 최소 상단 바 |
| 차트 | 일봉과 `30일·90일·1년` 표시 범위 | 1시간·4시간·일봉 분석과 실제 출처·기준 시각 표시 |
| 시장 상황 | 브리핑·대시보드 여러 영역에 분산 | 차트 위 한 줄 시장 pulse, 필요할 때 상세 펼침 |
| 분석 | 지표·RiskCheck·진단이 함께 노출 | 결론, 유효·무효 조건, 기간별 계획, 상세 근거 순서 |
| 주문 | 대시보드와 별도 시트에 분산 | 차트의 주문 버튼으로 우측 서랍만 열기 |
| 전략 | 설정 시트와 기존 preset 중심 | 현재 설정 시트의 동작은 유지하고 새 셸에서 진입 |
| 자동화 | 전략·worker·진단이 여러 시트에 분산 | 계좌·RiskCheck·scheduler를 단계형 준비 화면으로 통합 |
| 고급 기능 | 상단에 항상 노출 | 설정과 문맥형 상세로 점진적 공개 |

## 3. 정보 구조

### 왼쪽 사이드바

상단에는 제품 표시와 네 개의 주요 목적지만 둔다.

1. `차트`
2. `내 자산`
3. `전략`
4. `자동화`

하단에는 다음만 둔다.

- Toss·코인 연결 상태
- `API 연결 · 설정`
- 실제 또는 paper scheduler가 실행 중일 때만 `긴급 중지`

`점검`, `배포`, `로그`, `뉴스 갱신`, `엔진 시작`은 사이드바 주요 항목으로 만들지 않는다.

### 상단 바

상단에는 다음 세 그룹만 유지한다.

- `주식 / 코인` 자산 종류
- 종목명·한글명·티커 통합 검색
- 현재 데이터 provider 연결 상태

분석, 브리핑과 뉴스는 별도 상단 버튼이 아니라 선택 종목과 화면 상태가 바뀔 때 갱신한다. 사용자가 강제 갱신해야 하는 경우 연결 상태 메뉴 안에 `새로고침`을 제공한다.

### 메인 차트 영역

화면 위에서 아래 순서는 다음으로 고정한다.

1. 오늘의 시장 상황
2. 종목명, 현재가, 등락률, 차트 주기, 주문 버튼
3. 차트
4. `분석 / 신호 / 뉴스` 탭

차트보다 큰 상태 카드나 진단 카드를 위에 두지 않는다.

## 4. 화면별 동작

### 4.1 첫 실행과 선택형 API 연결

첫 실행에서는 다음 세 행동을 제공한다.

- `삼성전자 예제 분석 시작` — 기본 CTA
- `내 API 연결하기` — 선택 행동
- `나중에 연결` — 예제와 공개 데이터로 계속

예제 분석은 Yahoo fallback을 사용할 수 있으며 화면에 데이터 출처, 통화, 봉 주기와 기준 시각을 표시한다. Toss credential 삭제·만료가 메인 화면 전체를 잠그지 않는다.

사용자가 Toss 연결을 선택하면 다음을 표시한다.

- Client ID와 Client Secret 입력
- Keychain·암호화 저장 안내
- Toss 개발자 문서 링크
- `검증하고 시작하기`
- 검증 중, 실패, 성공 상태

성공 조건은 sidecar의 credential 검증과 계좌 endpoint 접근 가능 여부다. account 선택, 허용 IP, 운영자 gate와 사용자 gate는 이 단계의 성공 조건이 아니다.

실패 메시지는 다음 중 하나를 구체적으로 표시한다.

- 입력 누락
- credential 거절
- 네트워크 또는 timeout
- 허용 IP 확인 필요
- Toss API 계약 불일치
- sidecar 오프라인

기존 Keychain credential이 유효하면 연결 상태만 복원한다. 저장 credential이 거절되거나 삭제되면 Yahoo fallback과 설정의 재연결 행동을 제공한다.

### 4.2 주식 차트와 시간봉

- 기본 화면은 마지막 선택 종목 또는 안전한 기본 종목을 사용한다.
- Toss가 연결되면 공식 1분봉을 세션 기준으로 집계해 1시간봉을 만들고 공식 일봉을 함께 사용한다.
- Toss가 없으면 Yahoo 1시간봉·일봉으로 예제와 기본 분석을 제공한다.
- 주식 정규장은 6시간 30분이므로 4시간봉은 부분 세션 경고를 표시하고 핵심 단타·스윙 신호에 강제하지 않는다.
- 화면은 첫 릴리스에서 `1시간`, `4시간`, `일봉`의 분석 기준과 `30일·90일·1년` 표시 범위를 구분한다.
- 주기 변경 시 기존 series를 재사용하고 데이터만 교체한다.
- provider가 일시 중단되면 마지막 수신 시각과 stale 상태를 표시하고 실시간 표현을 제거한다.

Toss 공식 계약에서 지원 endpoint, 호출 한도와 지연 정책을 구현 직전에 다시 검증한다. 지원되지 않는 스트리밍을 있는 것처럼 표현하지 않는다.

### 4.3 시장 상황

차트 위에는 한 줄 요약만 기본 노출한다.

- 시장: KR 또는 US
- 상태: 강세, 중립, 약세
- 시장폭
- 주도 테마
- 기준 시각

클릭하면 시장 환경, 접근 기준과 주의 요소를 펼친다. 브리핑 전체 후보, 진단 로그와 API 원문은 이 영역에 넣지 않는다.

### 4.4 분석과 기간별 계획

분석 탭의 노출 순서는 다음과 같다.

1. `진입 가능 / 대기 / 계산 불가` 상태
2. 한 문장 결론
3. 유효 조건과 무효 조건
4. 신뢰도와 데이터 기준 시각
5. 단타·스윙·장기 계획 비교
6. `왜 이렇게 계산됐나요?` 상세

기간별 계획은 [계산 명세](../../ux-prototypes/macos-native/horizon-exit-plan-spec.md)를 따른다.

- 단타: 당일~3거래일
- 스윙: 2~8주
- 장기: 6개월 이상
기술적 손절가는 계좌 규모와 무관하게 계산한다. 수량과 허용 손실 예산은 주문 서랍의 기존 RiskCheck에서 별도로 확인한다. 필수 봉이나 지표가 없으면 임의 비율로 대체하지 않고 `계산 불가`와 누락 이유를 표시한다.

상세 근거에는 시장폭, 사용 봉, ATR, VWAP, 이동평균, 지지·저항, 계산식, 유사 신호 표본과 차단 조건을 표시한다.

### 4.5 코인 공개 분석과 계좌 연결

사용자가 `코인`을 선택하면 Upbit 공개 REST 60분·240분·일봉으로 분석할 수 있다. credential이 없어도 차트를 잠그지 않는다.

- Upbit 연결
- Bithumb 연결
- credential 검증 상태
- 연결 실패 이유

주식, 내 자산, 전략과 설정은 계속 사용할 수 있어야 한다. 둘 다 연결되면 마지막 사용 provider를 복원하고 차트 헤더에서 전환한다.

첫 릴리스는 닫힌 봉 기반 REST/polling 분석이며 `실시간`이라고 표시하지 않는다. WebSocket, heartbeat, 재연결 backoff와 형성봉 갱신은 후속 기능이다.

### 4.6 주문 서랍

차트의 `주문` 또는 분석의 `선택 계획을 주문에 적용`을 눌렀을 때만 우측에서 연다.

서랍에는 다음을 표시한다.

- 종목과 현재가
- 매수·매도 선택
- 지정가와 수량 또는 금액
- 1·2차 익절가
- 손절가 또는 종가 무효선
- 분석 스냅샷 시각
- holdings와 precheck 결과
- 예상 수수료·슬리피지·체결 주의

분석 적용은 값을 복사할 뿐 precheck나 주문을 자동 실행하지 않는다. 적용 시점의 최신 가격으로 다시 계산하고 값이 달라졌으면 변경 전후를 확인시킨다.

1.0.0에서는 `모의 주문 초안 저장`과 `사전검증`만 제공하고 broker submit 버튼은 노출하지 않는다. 장기 종가 무효선은 일반 stop 주문으로 변환하지 않고 알림 조건으로 저장한다.

### 4.7 내 자산

기본 화면은 총 평가액, 오늘 손익, 보유 종목과 미체결 요약만 표시한다.

- Toss credential 등록과 계좌 선택은 분리한다.
- 계좌 미선택이면 연결 준비 안내를 표시한다.
- 보유 종목 상세에서 오늘 할 일, 익절·손절과 분석 근거를 펼친다.
- 계좌번호, token과 credential 원문은 표시하지 않는다.

### 4.8 전략 설정

전략 화면은 현재 구현 순서를 유지한다.

```text
종목·기준가와 현재 입력
→ 전략 초안 저장
→ 조건 확인
→ 시뮬레이션
→ 활성화
```

문장형 조립기, 동적 20차와 새 반복 정책은 이번 UI 개편 범위가 아니다. 기존 preset, 백업, 시뮬레이션과 활성화 계약을 그대로 사용한다. 초안 저장은 전략 활성화, scheduler 시작 또는 주문 제출을 의미하지 않는다.

### 4.9 자동화

자동화 화면은 고급 기능을 단계별로 보여준다.

1. broker credential
2. 계좌 또는 거래소
3. 전략 시뮬레이션
4. RiskCheck
5. worker 상태
6. scheduler
7. kill switch

1.0.0에서는 paper scheduler만 켤 수 있고 Toss·코인 live submit은 차단 상태로 표시한다. `실거래 준비`와 `현재 버전에서 제출 가능`을 같은 상태로 합치지 않는다.

### 4.10 설정 > 연결 및 진단

다음 기능을 이곳으로 이동한다.

- Toss·Upbit·Bithumb credential
- 공인 IP 확인
- sidecar 상태와 재시작
- 앱 점검
- 로그
- 배포·서명·notarization 상태
- 저장소와 App Support 경로
- 안전한 운영 리포트 복사

기본 사용자는 설정을 열지 않아도 차트와 분석을 사용할 수 있어야 한다.

## 5. SwiftUI 구성

현재 거대한 `StockAnalysisMacApp.swift`에 새 화면을 계속 추가하지 않는다. App entry와 공통 `AppModel`은 유지하면서 View를 다음 단위로 분리한다.

```text
Sources/StockAnalysisMac/
  App/
    BeginnerFirstRootView.swift
    AppDestination.swift
  Onboarding/
    TossOnboardingView.swift
  Shell/
    SidebarView.swift
    WorkspaceTopBar.swift
  Chart/
    ChartWorkspaceView.swift
    MarketPulseView.swift
    RealtimeChartView.swift
    CryptoConnectionGateView.swift
  Analysis/
    AnalysisSummaryView.swift
    HorizonPlansView.swift
    AnalysisBasisView.swift
  Orders/
    OrderDrawerView.swift
  Strategies/
    StrategyBuilderView.swift
    StrategyBlockViews.swift
  Automation/
    AutomationReadinessView.swift
  Settings/
    ConnectionsAndDiagnosticsView.swift
```

파일명은 구현 중 현재 package 구조에 맞춰 조정할 수 있지만 다음 경계는 유지한다.

- View는 broker adapter를 직접 호출하지 않는다.
- View는 `EngineClient`의 명시적 method와 `AppModel` state만 사용한다.
- chart series와 향후 실시간 연결 객체는 View state가 아니라 전용 model/service가 소유한다.
- credential 값은 SwiftUI state에 필요한 시간보다 오래 남기지 않는다.
- sidecar 응답 타입은 `StockAnalysisMacCore/Models.swift`에 둔다.

## 6. 앱 상태 계약

최소 상태는 다음 형태로 분리한다.

```swift
enum AppDestination: String {
    case chart
    case assets
    case strategies
    case automation
    case settings
}

enum AssetClass: String {
    case stock
    case crypto
}

enum ChartInterval: String {
    case oneHour
    case fourHours
    case oneDay
    case oneWeek
}

enum ConnectionPhase: Equatable {
    case unknown
    case disconnected
    case validating
    case connected
    case expired(message: String)
    case failed(message: String)
}

struct WorkspaceState {
    var destination: AppDestination
    var assetClass: AssetClass
    var selectedSymbol: String
    var selectedCryptoProvider: String?
    var interval: ChartInterval
    var orderDrawerOpen: Bool
}
```

onboarding 여부를 단순 `credential 존재`로 판단하지 않는다. sidecar health, credential 검증 상태와 만료·삭제 이벤트를 함께 반영한다.

## 7. 데이터 흐름

```text
앱 시작
→ sidecar health
→ 선택형 credential 상태
→ 마지막 workspace 복원 또는 삼성전자 예제

종목 선택
→ 현재가·캔들 요청
→ chart 갱신
→ 분석 요청
→ 분석·신호·뉴스 탭 갱신

전략 값 변경
→ 로컬 순수 계산
→ validation
→ sidecar simulation
→ draft 저장

분석 계획 적용
→ 최신 가격 재계산
→ order drawer draft
→ 사용자 확인
→ paper precheck 또는 draft 저장
```

화면 전환 때문에 sidecar를 재시작하거나 동일 분석 요청을 중복 실행하지 않는다. 종목·주기 변경은 이전 요청을 취소하거나 최신 request ID만 반영한다.

## 8. 단계별 구현 순서

### Phase 1 — 상태 경계와 새 셸

- `AppDestination`, onboarding과 workspace state 분리
- sidebar와 최소 top bar 구현
- 기존 터미널 화면은 내부 fallback으로 유지
- credential 상태에 따른 root routing 테스트

완료 기준: 기존 분석·paper 기능을 잃지 않고 새 셸에서 차트, 자산, 전략, 자동화와 설정을 이동할 수 있다.

### Phase 2 — 예제 온보딩과 선택형 연결

- 삼성전자 예제, 나중에 연결, credential 입력·검증·저장·삭제·만료 처리
- 재실행 시 상태 복원
- 계좌 선택과 live gate는 자동으로 켜지지 않음
- 접근성 label과 구체적 오류 메시지

완료 기준: 미연결 사용자도 예제와 paper 기능을 사용할 수 있고, 연결 기능은 계좌 조회와 공식 데이터 출처를 추가한다.

### Phase 3 — 차트와 시장 상황

- 주식 1시간·일봉과 세션 집계 계약 연결
- 코인 Upbit 공개 1시간·4시간·일봉 provider 연결
- stale·재연결·데이터 부족 상태
- 시장 pulse와 통합 검색

완료 기준: 각 주기의 데이터 출처와 마지막 수신 시각이 실제 상태와 일치한다.

### Phase 4 — 분석과 주문 서랍

- 기존 `tradeSetup`, reliability와 시장폭을 새 분석 레이아웃에 연결
- 단타·스윙·장기 계산 엔진 추가
- 상세 근거와 차단 사유
- 분석 적용, 최신가 재계산과 paper-only 주문 서랍

완료 기준: 데이터가 부족한 계획은 `계산 불가`이며 주문 서랍에서 broker submit이 발생하지 않는다.

### Phase 5 — 기존 전략 UI 스타일 적용

- 기존 설정 입력과 검증 순서 보존
- 조건 확인, simulation, draft와 활성화 회귀 검증
- 백업과 기존 저장 전략 호환

완료 기준: 새 셸에서 기존 전략 시트를 열고 현재 작업 순서와 sidecar simulation이 그대로 통과한다.

### Phase 6 — 자동화·설정 통합

- readiness 단계, paper scheduler와 kill switch
- 연결·진단·로그·배포 화면 통합
- 기존 top command button 제거
- fallback 터미널 UI 제거

완료 기준: 일상 화면에는 차트·분석·자산·전략만 남고 진단 기능은 설정에서 모두 접근할 수 있다.

## 9. 호환성과 마이그레이션

- `com.stockanalysis.mac` App Support와 Keychain service를 그대로 사용한다.
- 저장된 credential, 계좌 선택, 전략, scheduler OFF/ON과 kill switch 상태를 보존한다.
- 기존 전략의 내부 preset ID와 mode를 변경하지 않고 사용자 표시명만 새 UI에서 변환한다.
- 새 반복 정책이 없는 기존 전략은 기존 동작을 유지한다.
- workspace 마지막 화면, 자산 종류, 종목, provider와 주기는 새 UI 전용 preference로 저장한다.
- UI 전환과 YongStockDesk bundle ID 변경을 같은 릴리스에서 수행하지 않는다.

## 10. 오류와 빈 상태

모든 주요 영역은 `loading / content / empty / stale / error`를 가져야 한다.

- sidecar offline: 재시작과 로그 열기 제공
- Toss 만료: onboarding으로 복귀, secret 재표시 금지
- 캔들 없음: 마지막 유효 데이터와 누락 이유 표시
- 코인 REST/polling 실패: 마지막 유효 봉, stale 상태와 다시 시도 표시
- 분석 데이터 부족: 계산 불가와 필요한 봉·지표 표시
- simulation 실패: blocker를 해당 블록에 연결
- precheck 실패: 주문 서랍을 유지하고 수정 가능한 필드 강조

오류가 발생해도 kill switch, 설정과 로그 접근은 막지 않는다.

## 11. 접근성과 macOS 동작

- 모든 입력에 보이는 label 또는 접근성 label을 제공한다.
- sidebar, 탭, template, block 입력, 주문 서랍과 설정을 키보드로 조작할 수 있어야 한다.
- 선택 상태는 색상만으로 표현하지 않고 label·아이콘·문구를 함께 사용한다.
- 로딩 중 같은 action을 중복 실행할 수 없게 한다.
- 비밀번호 입력은 복사·로그 노출을 막고 화면 전환 시 비운다.
- Reduce Motion에서는 drawer와 화면 전환 animation을 축소한다.
- macOS 최소 창 크기는 `1024×720`으로 두고, `1440×900`을 기준 레이아웃으로 사용한다.
- `1024px`에서는 sidebar 폭을 줄이고, 더 좁은 내부 개발 검증에서는 sidebar를 아이콘형으로 접는다.
- HTML의 736px·320px 검증은 레이아웃 회귀 참고이며 실제 macOS 배포 최소 창 크기로 사용하지 않는다.

## 12. 테스트와 수용 기준

### 상태 테스트

- Toss 미등록, 검증 중, 실패, 성공, 만료와 삭제
- 저장 credential 재실행 복원
- 코인 미연결, 한 거래소 연결, 두 거래소 연결과 provider 전환
- sidecar offline과 재시작
- stale quote와 polling 재시도

### 기능 테스트

- 종목 검색과 자산 종류 전환
- 1시간·4시간·일봉 변경, 세션 집계와 부분 봉 경고
- 시장 pulse 펼치기·접기
- 분석 계획 선택, 상세 근거와 주문 전 RiskCheck
- 주문 서랍 열기·닫기와 최신가 재계산
- 네 전략 템플릿, 1~20차 추가·삭제, 직접 만들기
- simulation 전후 저장 가능 상태
- paper scheduler와 kill switch

### 안전 테스트

- onboarding 성공이 account 선택이나 live gate를 켜지 않음
- 분석 적용이 precheck·주문을 자동 실행하지 않음
- 1.0.0에서 Toss·코인 submit endpoint가 계속 차단됨
- View와 signal code가 broker adapter를 직접 호출하지 않음
- secret, token과 raw account number가 로그·리포트·clipboard에 없음
- 장기 종가 무효선이 stop 주문으로 변환되지 않음

### UI 검증

- `1440×900`, `1024×720`에서 겹침·잘림·불필요한 가로 스크롤 없음
- keyboard tab 순서와 VoiceOver label
- Reduce Motion과 다크 테마
- 첫 실행, 주식 차트, 코인 공개 분석·계좌 연결, 분석 상세, 주문 서랍, 기존 전략 설정, 설정 화면 screenshot 비교

### 앱 검증

```bash
yarn lint
yarn build
yarn test:local-engine
yarn test:automation
yarn test:toss
yarn test:crypto-exchanges
yarn mac:test
yarn mac:app
yarn mac:verify
yarn mac:verify:launch
```

UI smoke는 실제 버튼 클릭으로 onboarding, 검색, 주기 변경, drawer, 전략 simulation, scheduler와 kill switch를 검증한다.

## 13. 완료 판정

다음 조건을 모두 충족해야 UI/UX 전환 완료로 본다.

- 앱 시작 후 사용자가 현재 단계와 다음 행동을 한 화면에서 이해한다.
- Toss 미연결 사용자는 왜 잠겨 있는지와 연결 방법을 알 수 있다.
- 차트 데이터 출처, 주기와 마지막 수신 시각이 실제 상태와 일치한다.
- 시장 상태와 선택 종목 분석을 차트에서 벗어나지 않고 확인할 수 있다.
- 고급 진단 버튼이 기본 화면에서 제거되고 설정에서 접근 가능하다.
- 전략 초안을 코드를 모르는 사용자가 문장 순서로 만들고 검증할 수 있다.
- 분석·simulation·precheck와 실제 주문의 차이가 명확하다.
- 기존 credential, 전략, paper 상태와 안전 경계가 보존된다.
- 필수 테스트와 macOS 앱 빌드·실행 검증이 통과한다.

구현 완료 후 [기능 상태](../../features.md)의 관련 항목을 `HTML 시안`·`명세만 존재`에서 `부분 구현` 또는 `구현됨`으로 갱신했다.
