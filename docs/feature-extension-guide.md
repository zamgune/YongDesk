# 기능 확장 가이드

새 기능은 `page.tsx`나 API Route에 바로 누적하지 않고, 아래 순서로 추가한다.

## 기본 순서

1. `src/domain/*`에 핵심 타입을 먼저 정의한다.
2. 외부 API, 저장소, 증권사, 알림처럼 교체 가능한 의존성이 있으면 `src/ports/*`에 인터페이스를 둔다.
3. 사용자 행동 단위 로직은 `src/use-cases/*`에 둔다.
4. API Route는 요청 파싱, `getRequestUserContext(request)`, use-case 호출, `Response.json(...)`만 담당한다.
5. UI는 새 기능부터 `src/features/*` 하위 component/hook으로 분리한다.
6. 테스트와 문서를 같이 갱신한다.

## API Route 기준

```ts
import { getRequestUserContext } from "@/use-cases/security/request-context";
import { runFeatureUseCase } from "@/use-cases/example/run-feature";

export async function POST(request: Request) {
  const userContext = getRequestUserContext(request);
  const input = await request.json();

  const result = await runFeatureUseCase({
    userContext,
    input,
  });

  return Response.json(result);
}
```

Route 안에서 지표 계산, 전략 판단, 저장소 직접 처리, 증권사 호출을 하지 않는다.

## Use Case 기준

Use case는 사용자 행동 하나를 기준으로 만든다.

```ts
export async function runFeatureUseCase({
  userContext,
  input,
  repository,
}: {
  userContext: UserContext;
  input: FeatureInput;
  repository: FeatureRepository;
}) {
  // 권한 확인, 도메인 계산, port 호출을 여기에서 조합한다.
}
```

- 입력은 DTO로 받고 내부 도메인 타입으로 변환한다.
- 저장소나 외부 API는 port 인터페이스를 통해 호출한다.
- API 응답에 노출하면 안 되는 토큰, 계좌 비밀번호, 내부 식별자는 DTO에서 제거한다.

## 기능별 위치

| 기능 | 위치 |
| --- | --- |
| 단건 분석, 시장 스캔 | `src/use-cases/market` |
| 데일리 브리핑 | `src/use-cases/briefing` |
| 회원/세션/권한 | `src/domain/user`, `src/use-cases/security` |
| 포트폴리오 서버 저장 | `src/domain/portfolio`, `src/ports/portfolio-repository` |
| 전략 저장/불러오기 | `src/domain/strategy`, `src/ports/strategy-repository` |
| 주문 후보/리스크 체크 | `src/domain/trading`, `src/use-cases/trading` |
| 체결/자동매매 로그 | `src/domain/execution`, `src/ports/execution-repository` |
| 증권사 API | `src/ports/broker`, future `src/adapters/broker/*` |

## UI 분리 기준

`src/app/page.tsx`는 현재 워크벤치 entry 역할을 유지한다. 새 UI 로직은 아래 feature 폴더로 분리한다.

```text
src/features/portfolio
src/features/analysis
src/features/daily-briefing
src/features/market-scan
src/features/watchlist
```

새 기능에서 추가되는 상태, fetch, 저장소 접근, 렌더링 helper는 feature hook 또는 component에 둔다. `page.tsx`에는 탭 조립과 큰 화면 배치만 남기는 방향으로 정리한다.

## 자동매매 관련 규칙

- `SignalResult`는 주문이 아니다.
- 신호는 반드시 `OrderIntent`로 변환하고 `RiskPolicy` 또는 `RiskCheckResult`를 통과해야 한다.
- 실거래는 기본 OFF다.
- 증권사 API key, access token, refresh token은 client component, localStorage, API 응답에 노출하지 않는다.
- 주문 실행 전 서버에서 userId, 계좌 소유권, 수량, 주문 가능 금액, 중복 주문을 다시 검증한다.
- 체결과 자동매매 판단은 `ExecutionRepository`와 `AutoTradeLog`에 기록 가능한 형태로 남긴다.
- 실계좌 연결 전 단계는 `페이퍼 자동운용`으로 검증한다.
- 페이퍼 자동운용은 `BrokerPort`를 호출하지 않고 모의 계좌, 페이퍼 주문, 페이퍼 체결 로그만 생성한다.
- 페이퍼 자동운용 상태는 `.cache/stock-analysis/paper-trading/state.json` 파일 저장소를 기본으로 사용한다.
- Codex App 자동화는 `npm run paper:run -- --session=KR|US` runner를 호출하는 방식으로 등록하고, 자동화 prompt는 실행 요약, 체결 수, probe 체결 수, 제외 사유, 저장 파일 경로만 보고한다.
- v1 페이퍼 전략은 `paper-breakout-v1`로 고정하며 자동 미세조정이나 임계값 자동 변경을 하지 않는다.

## 피해야 할 것

- API Route에 비즈니스 로직 직접 추가
- `page.tsx`에 새 기능 상태와 렌더링 계속 누적
- 전략 계산 중 외부 API 직접 호출
- 신호 결과에서 증권사 주문 직접 호출
- 브라우저 localStorage에 민감정보 저장
- 공통 `AnalysisService` 하나에 모든 기능을 몰아넣기

## 문서 갱신 기준

- 사용자에게 보이는 기능이 바뀌면 `docs/current-main-features.md`를 갱신한다.
- 구조나 확장 규칙이 바뀌면 이 문서와 `docs/security-server-refactor.md`를 갱신한다.
- 전략 판단 로직이 바뀌면 관련 전략 문서도 갱신한다.
- README의 명령어와 문서 목록은 실제 파일과 맞춘다.
