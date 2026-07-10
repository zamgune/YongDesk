# YongStockDesk

YongStockDesk는 관심종목, 차트 분석, 시장 브리핑, 전략 설계와 모의 자동화를 한곳에서 다루는 macOS 트레이딩 워크벤치입니다.

이 앱은 자동 매수·매도 지시나 수익 보장 도구가 아닙니다. 가격, 거래량, 시장 상태와 개인 리스크 한도를 함께 판단해야 합니다.

## 현재 안전 범위

- 첫 실행은 삼성전자 예제 분석과 공개 데이터로 시작할 수 있으며 API 연결은 선택 사항입니다.
- Toss·Upbit·Bithumb 연결은 조회와 주문 사전검증을 위한 준비 기능입니다.
- 데스크톱 1.0.0은 모든 브로커의 실제 주문 제출을 차단하고 주식·코인 모두 paper 자동화만 지원합니다.
- 신호, 뉴스·민심, 전략 시뮬레이션과 주문 사전검증은 broker submit을 직접 호출하지 않습니다.

현재 구현 범위와 외부 설정 필요 여부는 [기능 상태](docs/features.md)를 기준으로 확인합니다. `v1.0.0` 패키지의 과거 검증 기록은 [릴리스 이력](docs/releases/v1.0.0.md)에서 확인합니다.

## 빠른 시작

```bash
yarn install --frozen-lockfile
yarn lint
yarn build
```

웹 fallback/admin 화면은 `yarn dev`로 실행합니다. macOS 앱을 빌드·검증하려면 다음 순서를 사용합니다.

```bash
yarn mac:test
yarn mac:app
yarn mac:verify
yarn mac:verify:launch
```

## 문서

- [문서 허브](docs/README.md) — 현재 기준, 활성 명세, 참고자료와 이력
- [이어서 개발하기](docs/continuation-guide.md) — 개발 환경, 안전 경계와 다음 우선순위
- [현재 기능](docs/features.md) — 실제 구현·외부 설정·후속 상태
- [macOS 네이티브 앱](docs/macos-native.md) — SwiftUI, sidecar, 패키징과 배포
- [실 API 인수 QA](docs/desktop-live-api-qa.md) — Toss·Upbit 읽기 전용 인수 절차

## 문서 검증

```bash
yarn docs:check
```

`docs:check`는 루트 README와 `docs/` 아래 Markdown의 상대 링크를 검사합니다. 외부 URL과 문서 내부 앵커는 검사 대상이 아닙니다.
