# YongStockDesk 기능 상태

이 문서는 `main`의 실제 코드와 검증 결과를 기준으로 유지하는 기능 목록이다. README나 UX 시안과 설명이 다르면 이 문서의 상태를 우선하고, 코드 변경과 같은 PR에서 갱신한다.

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
| 앱 셸 | Finder/Dock에서 실행되는 SwiftUI 앱과 번들 sidecar | 구현됨 | 현재 호환 이름은 `StockAnalysis.app` | 없음 |
| 앱 셸 | 메뉴바 상태, 앱 점검, sidecar 로그, 배포 점검 | 구현됨 | 로컬 App Support와 번들 상태를 사용 | 없음 |
| 앱 셸 | 차트 중심 사이드바와 단순화된 beginner-first 레이아웃 | HTML 시안 | `beginner-first.html`에만 존재 | 없음 |
| 온보딩 | 시작 안내와 Toss 설정 시트 | 부분 구현 | 현재 앱은 Toss 등록 전에도 대시보드 진입 가능 | 없음 |
| 온보딩 | Toss 등록을 완료해야 메인 화면을 여는 필수 게이트 | HTML 시안 | SwiftUI 인증 상태 라우팅 필요 | 없음 |
| 시장 데이터 | US·KOSPI·KOSDAQ·CRYPTO 종목 검색과 수동 티커 입력 | 구현됨 | 종목 마스터 캐시가 없으면 seed/fallback 사용 | 없음 |
| 차트 | 일봉 기반 분석 차트와 지표·신호 표시 | 구현됨 | 데이터 공급자 품질과 거래일 지연 영향 | 없음 |
| 차트 | macOS의 `1m·15m·1D` 선택 UI | 부분 구현 | 현재 실시간 스트리밍 캔들이 아니라 제한된 히스토리 표시 제어 | 없음 |
| 차트 | Toss 분봉과 Upbit/Bithumb WebSocket 실시간 차트 | 후속 | 15분봉 로컬 집계와 재연결 정책 필요 | 없음 |
| 분석 | 단건 종목 분석, 지지·저항, `tradeSetup`, 돌파 상태 | 구현됨 | 분석은 주문 추천이나 수익 보장이 아님 | 없음 |
| 분석 | 신호 신뢰도, 유사 표본, 최대 상승·하락과 손익비 | 구현됨 | 표본 부족 시 `insufficient-data` | 없음 |
| 분석 | 단타·스윙·장기 익절·손절 계획 | 명세만 존재 | HTML mock과 계산 명세만 있고 엔진 응답에는 미연결 | 없음 |
| 브리핑 | US·KR 시장 브리핑, 주도 후보, 진입 후보 큐 | 구현됨 | 시장 데이터 실패 시 safe fallback 사용 | 없음 |
| 뉴스 | 공식/RSS 뉴스 이벤트와 신뢰도 표시 | 구현됨 | best-effort이며 분석·자동화를 차단하지 않음 | 없음 |
| 자산 | 웹 포트폴리오 등록·손익·오늘 할 일 | 구현됨 | 웹 fallback/admin 화면에서 제공 | 없음 |
| 자산 | Toss 보유 조회, 매수 가능 금액과 미체결 주문 조회 | 외부 설정 필요 | 검증된 Toss credential과 계좌 필요 | 없음 |
| 전략 | `ladder`, `percent-grid`, `loop-grid` 전략 계약 | 구현됨 | 저장, 시뮬레이션과 활성화 단계가 분리됨 | 직접 제출 안 함 |
| 전략 | 1% 반복과 분할차수 전략의 trigger·state 계산 | 구현됨 | 실제 체결가, 쿨다운과 위험 제한 사용 | 직접 제출 안 함 |
| 전략 | 문장형 블록, 동적 1~20차, 직접 만들기 | HTML 시안 | 실제 `RepeatPolicy`와 `custom` 계약 연결 전 | 없음 |
| 자동화 | 전략 CRUD, config hash 시뮬레이션, 활성화 | 구현됨 | 현재 시뮬레이션 통과 전 활성화 차단 | 없음 |
| 자동화 | 1회 실행, 연속 scheduler, worker pause | 구현됨 | scheduler 기본 OFF, 중복 cycle 방지 | 조건부 |
| 모의투자 | 페이퍼 주문·체결·보유·감사 로그 | 구현됨 | 로컬 저장소 사용, 실브로커 호출 없음 | 없음 |
| 주문 안전 | holdings, precheck, sync, `OrderIntent`, `RiskCheck` | 구현됨 | precheck와 preview만으로 주문되지 않음 | 조건부 |
| 안전장치 | 운영자·사용자 live gate, worker control, kill switch | 구현됨 | 하나라도 닫히면 제출 차단 | 차단 경계 |
| Toss | credential 검증·저장, 계좌 선택, 공인 IP 확인 | 외부 설정 필요 | 사용자 키와 Toss 허용 IP 등록 필요 | 없음 |
| Toss | 국내·미국 주식 주문 어댑터 | 외부 설정 필요 | 모든 안전 경계를 통과한 limit 주문만 가능 | 조건부 |
| 코인 | Upbit·Bithumb credential 검증과 주문 사전검증 | 외부 설정 필요 | 거래소별 키와 별도 crypto live gate 필요 | 없음 |
| 코인 | Upbit·Bithumb limit 주문 어댑터 | 외부 설정 필요 | market buy는 차단, audit 기록 필수 | 조건부 |
| 배포 | arm64/x64 앱·DMG·ZIP·manifest 생성과 검증 | 구현됨 | 아키텍처별 Node 런타임 번들 | 없음 |
| 배포 | Gatekeeper 경고 없는 공개 배포 | 외부 설정 필요 | Developer ID, notarization과 stapling 필요 | 없음 |

## 현재 macOS 사용자 흐름

현재 SwiftUI는 `beginner-first.html`이 아니라 터미널형 대시보드다.

1. 앱이 번들된 TypeScript sidecar를 `127.0.0.1`에서 자동 시작한다.
2. 상단 검색에서 종목과 US/KR 세션을 선택하고 분석 또는 브리핑을 실행한다.
3. `Toss`, `코인`, `전략`, `점검`, `배포`, `로그` 시트에서 고급 기능을 연다.
4. Toss 또는 거래소 credential 등록은 선택 사항이며, 등록하지 않아도 로컬 분석과 모의투자를 사용할 수 있다.
5. 전략은 초안 저장, 시뮬레이션, 활성화 순서로 준비한다.
6. 자동화 dry-run과 사전검증은 broker submit을 호출하지 않는다.
7. 실거래는 모든 live gate와 위험 검사를 통과한 경우에만 adapter까지 도달한다.

차트 중심 사이드바, 필수 Toss 온보딩, 코인 차트 잠금, 주문 서랍과 문장형 전략 조립기는 [초보자 중심 HTML 시안](ux-prototypes/macos-native/beginner-first.html)에만 있다.

## 시장 분석과 브리핑

### 구현된 분석 계약

- `/api/market/:symbol`과 local engine은 가격, 지표, 지지·저항, 패턴과 실행 참고 정보를 반환한다.
- `breakoutRule`은 신고가, 거래량, 손절 보조선과 추적 상태를 표현한다.
- `tradeSetup`은 핵심 기준선, 실패선, 유효·무효 조건과 진입 방식을 표현한다.
- `signalReliability`는 유사 신호 표본과 최대 상승·하락을 제공하며 매수 확정값으로 사용하지 않는다.
- 시장 리포트의 `entryCandidates`는 `tradable`, `probe`, `armed`, `watch`, `blocked` 상태로 자동화 준비도를 구분한다.
- 페이퍼 실행은 `entryCandidates`를 사용할 수 있지만 UI의 분석 결과가 실브로커를 직접 호출하지 않는다.

### 아직 연결되지 않은 분석

[보유 기간별 익절·손절 명세](ux-prototypes/macos-native/horizon-exit-plan-spec.md)는 다음 계약을 정의하지만 현재 분석 엔진의 공개 응답에는 없다.

- 단타: 15분봉, VWAP, HMA20, ATR14와 최근 구조
- 스윙: 일봉·4시간봉, failure level, ATR14와 Chandelier
- 장기: SMA200, 주봉 추세와 종가 기준 무효선

필수 봉이나 지표가 없을 때 임의 퍼센트로 대체하지 않고 `계산 불가`를 반환하는 구현이 필요하다.

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

실제 제출 가능 경로는 다음 순서를 바꿀 수 없다.

```text
전략 신호
→ OrderIntent
→ RiskCheck
→ 검증된 broker credential
→ 실행 계좌 또는 거래소 선택
→ 운영자 live gate
→ 사용자 또는 crypto live gate
→ worker control
→ kill switch
→ broker adapter
```

- credential 저장 성공은 실거래 활성화가 아니다.
- 계좌 조회, holdings, precheck, sync와 dry-run은 주문 제출이 아니다.
- UI, 분석 코드와 뉴스 신호는 broker adapter를 직접 호출하지 않는다.
- 실거래가 켜져 있어도 `RiskCheck` 실패, worker pause 또는 kill switch가 제출을 차단한다.
- 모든 제출·차단·거절·실패는 로컬 audit trail에 기록한다.

## 배포 상태

`yarn mac:app`은 현재 Mac용 `dist/macos/StockAnalysis.app`을 만들고 번들 Node와 sidecar를 포함한다. `yarn mac:package:all`은 arm64와 x64용 DMG·ZIP·manifest를 각각 만든다.

로컬 ad-hoc 앱은 빌드·서명·sidecar·실행 검증을 통과했다. 다른 Mac에 일반 배포하기 전에는 다음이 추가로 필요하다.

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
