# 보유 기간별 익절·손절 계산 명세

## 1. 목적과 경계

이 문서는 최근 확정 종가, 일치하는 보유 평단 또는 사용자가 입력한 가격에 진입했다고 가정할 때 1~3일 단기·스윙·장기 계획을 설명 가능한 방식으로 계산하기 위한 UI/엔진 계약이다.

- 결과는 분석 참고값이며 수익률이나 체결가를 보장하지 않는다.
- 분석 생성만으로 주문 또는 자동화 설정을 변경하지 않는다.
- 사용자가 `주문에 적용`을 누르면 최신 데이터로 다시 계산한 뒤 주문 초안에 복사한다.
- `wait` 또는 `unavailable` 계획은 주문에 적용할 수 없다.
- 장기 무효선은 종가 조건이며 일반 시장가 stop 주문으로 자동 변환하지 않는다.

## 2. 공개 타입 초안

```ts
type HoldingHorizon = "day" | "swing" | "long";
type HoldingPlanMode = "new-entry" | "position-management";
type PlanStatus = "actionable" | "wait" | "unavailable";
type ExitTrigger = "hourly-close" | "daily-close" | "monthly-close";

type AnalysisBasis = {
  generatedAt: string;
  quoteAt: string;
  symbol: string;
  market: string;
  dataSource: string;
  timeframeLabel: string;
  currency: "KRW" | "USD";
  entryPrice: number;
  atr14: number | null;
  support: number | null;
  resistance: number | null;
  sma20: number | null;
  sma200: number | null;
  tenMonthAverage: number | null;
  weeklySma20: number | null;
  weeklySma60: number | null;
  chandelierLong: number | null;
  reliabilityGrade: "high" | "medium" | "low" | "insufficient-data";
};

type HorizonExitPlan = {
  horizon: HoldingHorizon;
  planMode: HoldingPlanMode;
  status: PlanStatus;
  entryPrice: number;
  currentPrice: number;
  managementState: null | {
    state: "active" | "invalidation-breached" | "recovery-watch";
    currentPrice: number;
    averagePrice: number;
    invalidationPrice: number;
    reentryConfirmationPrice: number;
    actions: string[];
  };
  stop: {
    price: number | null;
    trigger: ExitTrigger;
    isBrokerStopEligible: boolean;
    reason: string;
  };
  takeProfits: Array<{
    price: number;
    allocationPct: number;
    basis: string;
  }>;
  trailingExit: {
    price: number | null;
    allocationPct: number;
    basis: string;
  } | null;
  riskPerShare: number | null;
  stopPct: number | null;
  rewardRisk: number | null;
  basis: AnalysisBasis;
  formulaSteps: string[];
  reasons: string[];
  blockers: string[];
};
```

## 3. 공통 규칙

- 신규 진입은 `R = entryPrice - stopPrice`이며 `R <= 0`이면 `unavailable`이다.
- 최근 종가와 직접 입력은 `new-entry`, 현재 종목·통화와 일치하는 실제 보유 평단은 `position-management`로 요청한다.
- 보유관리에서 평단이 무효선 위면 평단 기준 기존 목표를 유지한다. 현재가가 무효선 아래면 `managementState.state=invalidation-breached`로 신규매수 금지, 축소·청산 검토와 회복 확인을 가격 목표보다 우선 표시한다.
- 보유 평단도 무효선 이하라 양의 R을 만들 수 없으면 임의 익절 목표를 만들지 않는다. 이 경우에도 현재가, 무효선, 재진입 확인선과 관리 행동은 항상 반환한다.
- 가격선은 기술 데이터로 결정하며 계좌 규모와 주문 수량으로 임의 조정하지 않는다.
- 이 계산기는 가격 계획만 만든다. 계좌 위험 예산과 권장 수량 계산은 주문 서랍의 별도 RiskCheck가 담당한다.
- 국내 주식은 표시와 주문 적용 직전에 `normalizeKrLimitPrice`를 사용한다. 손절은 `down`, 익절은 `up` 방향으로 정규화한다.
- 필수 데이터가 없으면 고정 퍼센트로 대체하지 않고 `unavailable`과 누락 필드를 반환한다.
- 구조선과 ATR 등 가격 계산 입력이 있으면 추세·거래량·신뢰도 조건이 실패해도 가격선을 반환하고 `wait`으로 신규 진입만 보류한다. UI는 `가격 계산 완료`와 `진입 대기`를 별도 상태로 표시한다.
- 기준가 직접 입력은 0보다 큰 유한 숫자만 허용한다. 보유 평단은 현재 종목과 통화가 일치할 때만 선택할 수 있다.
- `주문에 적용` 시 최신 데이터로 계획을 재계산한다. 이전 스냅샷과 가격선이 달라지면 변경 전후를 확인받는다.

## 4. 기간별 계산

### 1~3일 단기

진입과 손절 계산의 주 봉은 1시간봉이다. 필수 데이터는 1시간봉 HMA20/50, ADX14, Choppiness14, 거래량 비율, ATR14, 최근 20개 봉의 저점과 저항이다.

- 코인은 4시간봉을 방향 필터로 사용한다.
- 주식은 정규장이 6시간 30분이라 4시간봉이 `4시간 + 2시간 30분`으로 갈리는 문제를 피하기 위해 일봉을 위험 방향 필터로만 사용한다. 실제 진입·손절 판단은 1시간봉으로 한다.
- 형성 중인 1시간봉은 확정 신호로 사용하지 않는다.

```text
structureStop = recentLow20 - 0.2 * ATR1h
distance = entry - structureStop
stop = structureStop
R = entry - stop
takeProfit1 = resistance가 entry+0.8R~entry+1.5R이면 resistance, 아니면 entry+1R
takeProfit2 = entry + 2R
```

- 1차·2차 익절 비중은 각각 50%다.
- `distance`가 `0.8~1.8 ATR1h` 밖이면 구조선을 이동하지 않고 `wait`으로 신규 진입을 보류한다.
- 상위 방향 필터 실패, HMA 추세 실패, ADX·Choppiness 품질 실패, 거래량 확인 실패 또는 가까운 저항까지 0.8R 미만이면 `wait`다.
- 손절은 1시간봉 종가 기준이다. 분석 화면에서 바로 broker stop으로 변환하지 않는다.

### 스윙 — 2~8주

필수 데이터는 일봉 ATR14, `tradeSetup.failureLevel`, 저항선, SMA20, 22봉 Chandelier 3ATR과 신호 신뢰도다.

- 코인은 `일봉 방향 → 4시간봉 진입 → 1시간봉 재확인`을 사용한다.
- 주식은 `일봉 방향 → 1시간봉 진입`을 사용한다. 세션 길이가 다른 4시간봉을 코인과 동일한 신호로 취급하지 않는다.

```text
distance = entry - failureLevel
stop = failureLevel
R = entry - stop
takeProfit1 = resistance가 entry+1R~entry+2R이면 resistance, 아니면 entry+1R
takeProfit2 = entry + 2R
trailingExit = max(SMA20, ChandelierLong)
```

- 1차 30%, 2차 30%, 추적 보유 40%다.
- `distance`가 `1.5~2.5 ATR1d` 밖이면 구조 무효선을 이동하지 않고 `wait`으로 신규 진입을 보류한다.
- 종목 일봉 위험 게이트 실패, 진입 봉 추세 실패, 코인의 1시간 재확인 실패, 신뢰도 `low`, 또는 무효선이 진입가 이상이면 `wait`다.
- 손절과 추적선은 일봉 종가 기준으로 평가한다.

### 장기 — 6개월 이상

가격 계산 필수 데이터는 SMA200, 완료된 월만 사용하는 10개월 이동평균과 주봉 SMA20이다. 주봉 SMA60과 장기 종목 일봉 위험 게이트는 신규 진입 판단 입력이며, 표본이 부족해도 가격선은 계산하고 `wait`으로 표시한다.

```text
stop = max(SMA200, tenMonthAverage)
R = entry - stop
takeProfit1 = entry + 2R
takeProfit2 = entry + 4R
trailingExit = weeklySMA20
```

- 2R에서 20%, 4R에서 20%만 부분 익절하고 잔여 60%는 추세를 추적한다.
- 주봉 SMA20이 SMA60 이하이거나 장기 종목 일봉 위험 게이트가 실패하면 `wait`다.
- 무효선은 월말 종가 기준이며 `isBrokerStopEligible=false`다.
- 보유관리의 재진입 확인선은 `max(무효선, 주봉 SMA20)`이다. 무효선 이탈 상태의 기존 목표는 즉시 매수 신호가 아니라 최초 평단 계획의 참고선으로 표시한다.

## 5. 데이터 공급자와 현재 구현

- Toss: 공식 1분봉을 정규장 마감에 정렬한 1시간봉으로 집계하고 일봉·주봉을 함께 사용한다. 장 초반 30분 부분 봉은 snapshot에만 남기고 지표에서는 제외하며, 현재 market week 주봉은 다음 주가 시작되기 전까지 형성 중으로 둔다. 캐시, 동일 요청 single-flight, 페이지 중복 제거와 비진전 cursor 차단을 적용한다. `source=auto`에서 확정 1시간봉 20개 또는 ATR14·최근 저점이 부족하면 해당 시간봉만 Yahoo로 보완한다. 장기 필수 SMA200·10개월 평균·주봉 SMA20/60이 부족하면 일봉만 보완하고 혼합 출처를 표시한다.
- Upbit: 현재는 `KRW-*` 시장만 허용하고 공개 REST의 60분·240분·일봉·주봉을 직접 사용한다. 시세 분석은 Upbit API 키가 없어도 가능하며 계좌 조회와 분리한다. 최근 캔들 간 무거래 공백이 있으면 시간 압축 왜곡을 경고하고 신규 진입을 대기한다.
- Yahoo: Toss credential이 없는 첫 사용자와 예제 분석을 위한 주식 fallback이다. 화면에는 실제 `dataSource`를 명시한다.
- 장기 분석은 일봉 730일을 요청해 SMA200, 완료 월 기준 10개월 평균과 주봉 SMA20/60의 최소 표본을 확보한다.
- 모든 응답은 `market`, `currency`, 기간별 실제 `dataSource`, `timeframe`, `quoteAt`, `generatedAt`과 데이터 부족 사유를 포함한다.
- 형성 중인 봉과 주식의 부분 세션 봉은 지표 계산에서 제외한다. 부분 봉은 경고에 명시하며 4시간봉을 핵심 주식 신호로 쓰지 않는다.
- 실시간 WebSocket 캔들은 이번 릴리스의 필수 조건이 아니다. 닫힌 봉 분석은 REST/polling으로 동작하고, 실시간 형성봉 갱신은 후속 기능이다.

## 6. 주문 적용 안전 규칙

- 적용 버튼은 `actionable` 상태에서만 활성화한다.
- 주문 서랍에는 진입가, 1·2차 익절가, 손절·무효선, 발동 기준과 분석 스냅샷을 복사한다. 수량은 별도 RiskCheck를 통과해야 한다.
- 복사는 `OrderIntent`를 생성하거나 broker 요청을 보내지 않는다.
- 일반 stop 주문은 발동 시 시장가로 바뀌어 급변·갭 상황에서 표시가와 다르게 체결될 수 있음을 표시한다.
- 장기 무효선은 알림 조건으로만 복사하고 stop 주문 필드에는 자동 제출 가능한 값으로 취급하지 않는다.

## 7. 근거 자료

- ATR 기반 변동성 손절: [Fidelity Average True Range](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr)
- 손절 규칙과 모멘텀 조건: [Kaminski & Lo, When Do Stop-Loss Rules Stop Losses?](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=968338)
- 장기 이동평균 기반 위험 관리: [Faber, A Quantitative Approach to Tactical Asset Allocation](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=962461)
- 추세 필터와 구현 품질: [Levine & Pedersen, Which Trend Is Your Friend?](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2603731)
- stop 주문 체결 특성: [SEC Stop Order](https://www.sec.gov/answers/stopord.htm)
