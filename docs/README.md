# YongStockDesk 문서 허브

이 디렉터리는 현재 제품 기준, 활성 명세, 설계 참고와 이력을 분리한다. 현재 기능을 판단할 때는 시안·과거 계획보다 **현재 기능**과 **이어서 개발하기**를 우선한다.

## 현재 기준

1. [현재 기능](features.md) — 구현됨, 외부 설정 필요, 후속 상태의 단일 기준
2. [이어서 개발하기](continuation-guide.md) — 저장소, 실행 환경, 안전 경계와 다음 우선순위
3. [macOS 네이티브 앱](macos-native.md) — SwiftUI, sidecar, 패키징·배포 구조
4. [데스크톱 실 API 인수 QA](desktop-live-api-qa.md) — Toss·Upbit 읽기 전용 인수 절차
5. [기능 확장 가이드](feature-extension-guide.md) — 계층, 안전 경계와 검증 순서
6. [전략 V2](../STRATEGY_V2.md) — 분석 지표와 신호 로직 계약

## 활성 명세와 참고자료

- [보유 기간별 익절·손절](ux-prototypes/macos-native/horizon-exit-plan-spec.md) — 현재 분석 workspace와 연결된 계산 계약
- [초보자용 전략 조립기](automation-strategy-builder-spec.md) — 향후 문장형 전략 기능의 설계 명세
- [신고가 돌파 보조 룰](breakout-rule.md)
- [어스플러스식 브리핑 전략](us-plus-briefing-strategy.md)
- [추세추종 대장주 백테스트](trend-following-leader-backtest.md)
- [추세추종 임계값 메모](trend-following-threshold-notes.md)
- [커뮤니티 반응 소스 정책](community-pain-sources.md)
- [크립토 매수 신호 백테스트 사양](../crypto_buy_signal_backtest_spec.md)

명세와 참고자료는 현재 앱에 구현됐다는 뜻이 아니다. 제공 여부는 항상 [현재 기능](features.md)을 따른다.

## 활성 UX 참고

- [Beginner-first macOS v3 시안](ux-prototypes/macos-native/beginner-first-v3.html) — 현재 SwiftUI 정보 구조의 참고 시안
- [UX 시안 안내](ux-prototypes/README.md) — 활성 시안과 보관 시안의 구분

## 이력과 보관 자료

- [1.0.0 릴리스 이력](releases/v1.0.0.md) — 고정된 당시 배포·검증 기록이며 현재 기능의 기준이 아님
- [Archive](archive/README.md) — 완료된 계획, 구형 UX 시안, 과거 목표와 OpenSpec 보관 자료

## 갱신 원칙

- 사용자 기능이 바뀌면 `features.md`를 같은 변경에서 갱신한다.
- 실행 명령, sidecar 경로 또는 패키징 계약이 바뀌면 `macos-native.md`와 `continuation-guide.md`를 함께 갱신한다.
- 시안 또는 명세만 추가한 기능은 구현됨으로 표시하지 않는다.
- 패키지·UI smoke 결과는 대상 커밋과 검증 시점이 동일할 때만 현재 증거로 사용한다.
- 완료된 계획과 구형 UX는 삭제 대신 archive로 이동하고, archive에는 현재 대체 문서를 연결한다.
