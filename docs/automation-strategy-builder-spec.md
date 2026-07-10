# 초보자용 자동매매 전략 조립기 명세

## 목적과 범위

전략 조립기는 코딩 도구가 아니라 초보자가 자동매매 규칙을 문장 순서로 읽고 수정하는 설정 UI다. v1은 `조건 → 보유 확인 → 매수 → 청산 조건 → 매도 → 반복 또는 종료 → 안전 제한` 순서를 고정하며, 임의 분기, 중첩 반복, 사용자 스크립트와 AI 전략 생성은 지원하지 않는다.

이 문서는 향후 문장형 전략 기능의 설계 명세다. 현재 SwiftUI 전략 workspace와 엔진에는 아직 연결하지 않으며, 보관된 초기 mock 시안은 [Archive](archive/README.md#구형-ux-시안)에서만 참고한다. 외부 API, 전략 저장소, SwiftUI, `OrderIntent`, `RiskCheck`와 브로커 제출 경계는 이 명세만으로 변경하지 않는다.

## 사용자 흐름

1. 사용자는 `1% 반복`, `분할차수`, `지지선 반등`, `직접 만들기` 중 하나를 선택한다.
2. 종목과 기준가를 입력한다.
3. 고정된 문장형 블록 안의 숫자와 선택지만 변경한다.
4. UI는 자연어 요약, 발동 가격과 최대 필요 자금을 즉시 다시 계산한다.
5. 제거할 수 없는 안전 제한을 통과한 설정만 모의검증할 수 있다.
6. 모의검증을 통과한 설정만 전략 초안으로 저장할 수 있다.
7. 초안 저장은 주문이나 자동화 시작을 의미하지 않는다.

`계속 반복`은 사용자 표시 이름이며 `무한 반복`이라는 표현은 사용하지 않는다. 일일 주문 수, 최대 보유 금액, 최대 손실률, 최대 보유 시간과 쿨다운은 계속 적용된다.

## UI 상태

| 상태 | 동작 |
|---|---|
| 템플릿 선택 | 편집기 대신 4개 템플릿과 시작 안내를 표시한다. |
| 편집 중 | 값은 유효하지만 저장 전 모의검증이 필요하다. |
| 설정 오류 | 충돌한 안전 제한을 표시하고 모의검증과 저장을 차단한다. |
| 검증 중 | 가격 계산과 위험 제한 검사를 진행하며 중복 실행을 차단한다. |
| 모의검증 통과 | 주문의도 초안만 생성된다는 안내와 초안 저장 버튼을 표시한다. |
| 초안 저장 | 자동화가 시작되지 않았음을 상태와 알림으로 확인시킨다. |
| 반복 완료 | N번째 매도 체결 후 완료로 표시하고 다음 신규 매수를 차단한다. |

고급 설정은 접힌 상태가 기본이다. 일일 매수·매도 횟수, 최대 보유 금액, 최대 손실률, 최대 보유 시간, 쿨다운과 종료 시 처리를 포함한다. 접혀 있어도 현재 제한값은 안전 칩으로 항상 표시한다.

## 향후 공개 계약

```ts
export type StrategyTemplateId =
  | "one-percent-loop"
  | "magic-split"
  | "support-rebound"
  | "custom";

export type StrategyBlockKind =
  | "trigger"
  | "guard"
  | "entry"
  | "exit"
  | "repeat"
  | "risk";

export type RepeatPolicy =
  | { mode: "once"; maxCycles: 1 }
  | { mode: "count"; maxCycles: number }
  | { mode: "continuous"; maxCycles: null };

export const MAX_GRID_RUNGS = 20;

export type CustomEntryTrigger =
  | { kind: "relative-drop"; dropPct: number }
  | { kind: "fixed-price-at-or-below"; price: number };

export type CustomExitTrigger =
  | { kind: "entry-rise"; risePct: number }
  | { kind: "fixed-price-at-or-above"; price: number };

export type CustomStrategyDraft = {
  entryTrigger: CustomEntryTrigger;
  buyNotional: number;
  exitTrigger: CustomExitTrigger;
  sellPortionPct: 100;
  repeatPolicy: RepeatPolicy;
  compiledMode: "loop-grid" | "ladder";
};

export type StrategyBuilderValidation = {
  valid: boolean;
  blockers: string[];
  warnings: string[];
};

export type StrategyBuilderSimulationSnapshot = {
  configHash: string;
  passed: boolean;
  simulatedAt: string;
  summary: string;
};

export type StrategyBuilderDraft = {
  templateId: StrategyTemplateId;
  symbol: string;
  market: "KR" | "US" | "CRYPTO";
  blocks: Array<{
    kind: StrategyBlockKind;
    values: Record<string, string | number | boolean | null>;
  }>;
  repeatPolicy: RepeatPolicy | null;
  naturalLanguageSummary: string;
  validation: StrategyBuilderValidation;
  simulation: StrategyBuilderSimulationSnapshot | null;
};
```

실제 엔진 적용 단계에서는 기존 `LoopGridPlan`에 `repeatPolicy`를 추가한다. 저장된 기존 전략에 해당 필드가 없으면 현재 동작을 보존하기 위해 `{ mode: "continuous", maxCycles: null }`로 읽는다. 새 전략 UI의 기본값은 `{ mode: "count", maxCycles: 10 }`이다.

## 템플릿과 기존 엔진 매핑

### 1% 반복

- `AutomationPreset`: `one-percent-loop`
- `AutomationMode`: `loop-grid`
- 기준가, 매수 하락률, 매도 상승률, 회당 투입 금액과 쿨다운은 기존 `LoopGridPlan`을 재사용한다.
- `RepeatPolicy`만 향후 계약에 추가한다.

계산식은 다음과 같다.

```text
buyTrigger = anchorPrice * (1 - buyDropPct / 100)
sellTrigger = actualBuyFillPrice * (1 + sellRisePct / 100)
nextAnchor = actualSellFillPrice
```

사이클은 매수 주문 생성이나 매수 체결이 아니라 대응하는 매도 체결이 끝났을 때 1 증가한다. count 모드의 N번째 매도 체결 후 상태를 완료로 전환하고 신규 매수를 만들지 않는다. N번째 사이클 보유분의 매도는 반드시 허용한다.

### 분할차수

- `AutomationPreset`: `magic-split`
- `AutomationMode`: `percent-grid`
- 기준가와 차수별 누적 하락률, 실제 매수가 대비 상승률, 투입 금액은 기존 `GridPlan`과 `GridRung`을 재사용한다.

```text
rungBuyTrigger = basePrice * (1 - rung.buyDropPct / 100)
rungSellTrigger = actualRungBuyFillPrice * (1 + rung.sellRisePct / 100)
maximumCapital = sum(rung.notional)
```

차수 번호는 1부터 연속되어야 하고 누적 하락률은 차수가 올라갈수록 커야 한다. 전체 투입 금액은 최대 보유 금액을 넘을 수 없고 차수 수는 일일 최대 매수 횟수를 넘을 수 없다.

초기 시안은 3차로 시작하지만 사용자는 1~20차 범위에서 행을 추가하거나 삭제할 수 있다. 새 차수의 누적 하락률은 최근 두 차수의 간격을 이어서 계산하고, 차수가 하나뿐이면 해당 차수의 하락률을 다음 간격으로 사용한다. 매수 금액과 익절률은 직전 차수에서 복사한다. 삭제 후 차수 번호는 1부터 다시 부여한다.

### 지지선 반등

- `AutomationPreset`: `support-rebound`
- `AutomationMode`: `ladder`
- 지지선·저항선과 지정가 주문 단계는 기존 `LadderStep`을 재사용한다.
- 손절·종료 처리는 기존 `AutomationExitRules`의 `stopLossPct`와 `rescueMode`를 재사용한다.

지지선은 저항선보다 낮아야 한다. 지지선 이탈 조건이 발생하면 신규 매수를 차단하고 `disable-only` 또는 `cancel-and-liquidate` 의미의 주문의도 생성 경계로 전달한다. UI가 브로커를 직접 호출해서는 안 된다.

### 직접 만들기

- `AutomationPreset`: `custom`
- 상대 하락률 진입과 실제 매수가 대비 상승 청산은 `loop-grid`로 변환한다.
- 진입 또는 청산에 고정 가격을 사용하면 `ladder` 1회 실행으로 변환한다.
- 미보유 상태에서만 매수하고 보유 중일 때만 매도하는 guard는 자동 삽입하며 사용자가 제거할 수 없다.
- 매도는 v1에서 보유 수량 100%로 고정한다.
- 고정 가격이 포함된 조합은 repeat policy를 `once`로 강제한다.
- 상대가격 조합만 `once`, `count`, `continuous`를 선택할 수 있다.

고정 매도 가격은 예상 매수 발동 가격보다 높아야 한다. RSI, 이동평균, 거래량, OR 조건, 중첩 반복과 사용자 스크립트는 이 계약에 포함하지 않는다.

## 검증과 안전 경계

다음 조건 중 하나라도 실패하면 모의검증과 저장을 비활성화한다.

- 종목, 기준가와 템플릿별 필수 가격이 없다.
- 퍼센트 값이 0 이하 또는 합리적 상한 80%를 초과한다.
- 반복 횟수가 1~999 범위의 정수가 아니다.
- 일일 최대 매수 또는 매도 횟수가 1 미만이다.
- 최대 보유 금액이나 최대 보유 시간이 0 이하이다.
- 회당 매수 금액 또는 분할 매수 총액이 최대 보유 금액을 초과한다.
- 분할차수 누적 하락률이 차수 순서대로 증가하지 않는다.
- 분할차수가 1개 미만 또는 20개를 초과한다.
- 분할차수 수가 일일 최대 매수 횟수를 초과한다.
- 지지선이 저항선 이상이다.
- 직접 만들기의 고정 매도 가격이 예상 매수 가격 이하이다.
- 고정 가격 조건에 반복 실행이 설정되어 있다.

설정값이 변경되면 이전 모의검증 스냅샷과 저장 가능 상태를 즉시 무효화한다. 실제 앱은 저장 전에 config hash가 최신 모의검증 hash와 같은지 다시 확인해야 한다.

## 체결과 표시 원칙

- HTML 가격은 시안 데이터이며 호가 단위를 적용하지 않는다.
- 실제 국내 주식 가격은 Toss 주문 전 기존 호가 단위 정규화를 통과해야 한다.
- 매도 목표는 계산상의 매수 발동가가 아니라 실제 매수 체결가를 사용한다.
- 수수료, 세금, 슬리피지, 부분 체결과 미체결 가능성을 별도로 반영한다.
- 백테스트와 실시간 체결 결과가 같다고 표현하거나 예상 수익을 보장하지 않는다.
- `cancel-and-liquidate`는 즉시 청산을 직접 실행한다는 뜻이 아니라 `미체결 취소 + 보유 수량 청산 OrderIntent + 전략 비활성화` 요청을 만든다는 뜻이다.
- 실거래 제출은 기존 `OrderIntent → RiskCheck → credential/account/live gate/kill switch` 경계를 모두 통과한 경우에만 가능하다.

참고:

- [Blockly field validators](https://developers.google.com/blockly/guides/create-custom-blocks/fields/validators)
- [TradingView strategy risk controls](https://www.tradingview.com/pine-script-docs/concepts/strategies/)
- [TradingView strategy properties and fill assumptions](https://www.tradingview.com/support/solutions/43000628599-strategy-properties/)

## 수용 테스트

- 네 템플릿을 전환하면 블록, 자연어 설명, 가격표와 필요 자금이 함께 바뀐다.
- 분할차수를 1차부터 20차까지 추가하고 21차 추가가 차단되는지 확인한다.
- 중간 차수 삭제 후 번호가 다시 매겨지고 마지막 1차는 삭제할 수 없는지 확인한다.
- 새 차수의 하락 간격, 매수 금액과 익절률이 직전 차수 기준으로 생성되는지 확인한다.
- 차수 추가·삭제 후 이전 모의검증과 저장 가능 상태가 무효화되는지 확인한다.
- 직접 만들기의 상대가격 반복과 고정가격 1회 변환을 확인한다.
- 고정 가격 조건을 선택하면 반복이 1회로 바뀌고 다른 반복 옵션이 노출되지 않는지 확인한다.
- 숫자를 수정하면 계산 결과가 즉시 갱신되고 이전 모의검증은 무효화된다.
- count와 continuous 반복을 전환할 수 있고 continuous에도 안전 제한이 유지된다.
- 10번째 매도 체결 상태는 완료로 표시되고 다음 매수는 만들지 않는다.
- 최대 보유 금액보다 큰 주문은 오류로 표시되고 모의검증과 저장이 비활성화된다.
- 모의검증 통과 전에는 초안을 저장할 수 없다.
- 초안 저장 후에도 주문, 자동화 스케줄러와 실거래 게이트 상태는 변하지 않는다.
- 1440×900, 1024px, 736px와 320px에서 가로 스크롤 없이 사용할 수 있다.
- 템플릿, 블록 입력, 고급 설정, 검증과 저장을 키보드만으로 조작할 수 있다.
