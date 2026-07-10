# YongStockDesk 문서 안내

이 디렉터리는 YongStockDesk의 제품 상태, macOS 앱 구조, 기능 명세와 과거 의사결정을 구분해 관리한다. 새 작업은 아래 순서로 읽고 시작한다.

## 처음 읽을 문서

1. [이어서 개발하기](continuation-guide.md) — 저장소, 실행 환경, 안전 경계와 다음 우선순위
2. [현재 기능](current-main-features.md) — 현재 코드에 들어간 기능과 사용 조건
3. [macOS 네이티브 앱](macos-native.md) — SwiftUI, sidecar, 패키징과 배포 구조
4. [기능 확장 가이드](feature-extension-guide.md) — 새 기능을 추가할 때 지켜야 할 계층과 검증 순서
5. [전략 V2](../STRATEGY_V2.md) — 분석 지표와 신호 로직의 기준 계약

## 제품·기능 명세

- [자동매매 플랫폼 목표](automation-platform-goals.md)
- [초보자용 전략 조립기](automation-strategy-builder-spec.md)
- [보유 기간별 익절·손절](ux-prototypes/macos-native/horizon-exit-plan-spec.md)
- [신고가 돌파 보조 룰](breakout-rule.md)
- [서비스형 신호·브리핑 로드맵](service-signal-briefing-roadmap.md)

명세와 로드맵은 현재 앱에 구현됐다는 뜻이 아니다. 실제 제공 여부는 현재 기능 문서의 상태를 우선한다.

## UX 시안

- [초보자 중심 macOS 시안](ux-prototypes/macos-native/beginner-first.html)
- [기존 macOS 터미널 시안](ux-prototypes/macos-native/terminal-dense-detail.html)
- [Toss 차트 트레이딩 시안](ux-prototypes/toss-chart-trading/index.html)

HTML 시안은 사용자 흐름을 검토하기 위한 독립 프로토타입이다. SwiftUI, sidecar 또는 실제 주문 엔진에 자동 반영되지 않는다.

## 전략·분석 참고자료

- [어스플러스식 브리핑 전략](us-plus-briefing-strategy.md)
- [추세추종 대장주 백테스트](trend-following-leader-backtest.md)
- [추세추종 임계값 메모](trend-following-threshold-notes.md)
- [커뮤니티 반응 소스 정책](community-pain-sources.md)
- [크립토 매수 신호 백테스트 사양](../crypto_buy_signal_backtest_spec.md)

이 자료들은 설계 근거와 실험 기록이다. 수익률 보장이나 현재 제품 기능 목록으로 사용하지 않는다.

## 문서 갱신 원칙

- 사용자에게 제공되는 기능이 바뀌면 현재 기능 문서를 먼저 갱신한다.
- 실행 명령, sidecar 경로 또는 패키징 계약이 바뀌면 macOS 네이티브 앱 문서와 이어서 개발하기 문서를 함께 갱신한다.
- HTML 시안을 실제 앱에 적용할 때는 상태를 `HTML 시안`에서 `부분 구현` 또는 `구현됨`으로 명시적으로 변경한다.
- 주문 기능은 `OrderIntent`, `RiskCheck`, 인증정보, 계좌, live gate와 kill switch 경계를 생략하지 않는다.
- 오래된 목표나 완료된 로드맵은 삭제하지 않고 기록 문서로 분류한다.
