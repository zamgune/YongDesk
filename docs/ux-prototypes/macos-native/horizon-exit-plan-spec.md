# 보유 기간별 익절·손절 계산 명세

## 1. 목적과 경계

이 문서는 현재가에 신규 매수한다고 가정했을 때 단타·스윙·장기 계획을 설명 가능한 방식으로 계산하기 위한 UI/엔진 계약이다.

- 결과는 분석 참고값이며 수익률이나 체결가를 보장하지 않는다.
- 분석 생성만으로 주문 또는 자동화 설정을 변경하지 않는다.
- 사용자가 `주문에 적용`을 누르면 최신 데이터로 다시 계산한 뒤 주문 초안에 복사한다.
- `wait` 또는 `unavailable` 계획은 주문에 적용할 수 없다.
- 장기 무효선은 종가 조건이며 일반 시장가 stop 주문으로 자동 변환하지 않는다.

## 2. 공개 타입 초안

```ts
type HoldingHorizon = "day" | "swing" | "long";
type RiskPreset = "conservative" | "balanced" | "aggressive";
type PlanStatus = "actionable" | "wait" | "unavailable";
type ExitTrigger = "intrabar" | "daily-close" | "monthly-close";

type AnalysisBasis = {
  generatedAt: string;
  quoteAt: string;
  horizon: HoldingHorizon;
  timeframeLabel: string;
  currency: "KRW" | "USD";
  entryPrice: number;
  atr14: number | null;
  vwap: number | null;
  support: number | null;
  resistance: number | null;
  sma20: number | null;
  sma200: number | null;
  tenMonthAverage: number | null;
  weeklySma20: number | null;
  weeklySma60: number | null;
  chandelierLong: number | null;
  marketBreadth: number | null;
  marketGatePassed: boolean | null;
  reliability: {
    grade: "high" | "medium" | "low" | "insufficient-data";
    sampleSize: number;
    successRate: number | null;
    averageMaxGainPct: number | null;
    averageMaxDrawdownPct: number | null;
  };
};

type HorizonExitPlan = {
  horizon: HoldingHorizon;
  status: PlanStatus;
  entryPrice: number;
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

- `R = entryPrice - stopPrice`이며 `R <= 0`이면 `unavailable`이다.
- 가격선은 기술 데이터로 결정한다. 위험 성향은 가격선을 바꾸지 않는다.
- 위험 예산은 보수형 0.5%, 균형형 1.0%, 공격형 1.5%다. 계좌 연결 후 `허용손실금액 / R`로 권장 수량을 계산한다.
- 국내 주식은 표시와 주문 적용 직전에 `normalizeKrLimitPrice`를 사용한다. 손절은 `down`, 익절은 `up` 방향으로 정규화한다.
- 필수 데이터가 없으면 고정 퍼센트로 대체하지 않고 `unavailable`과 누락 필드를 반환한다.
- `주문에 적용` 시 최신 데이터로 계획을 재계산한다. 이전 스냅샷과 가격선이 달라지면 변경 전후를 확인받는다.

## 4. 기간별 계산

### 단타 — 당일~3거래일

필수 데이터는 최근 5거래일 1분봉을 집계한 15분봉, 세션 VWAP, HMA20 기울기, ATR14, 최근 20개 15분봉의 저점과 저항이다.

```text
structureStop = recentLow20 - 0.1 * ATR15m
distance = clamp(entry - structureStop, 0.8 * ATR15m, 1.5 * ATR15m)
stop = entry - distance
R = entry - stop
takeProfit1 = resistance가 entry+0.8R~entry+1.5R이면 resistance, 아니면 entry+1R
takeProfit2 = entry + 2R
```

- 1차·2차 익절 비중은 각각 50%다.
- 시장 게이트 실패, 현재가가 VWAP 아래, HMA20 하락 또는 가까운 저항까지 0.8R 미만이면 `wait`다.
- 8개 15분봉 안에 +0.5R 진행이 없고 VWAP 아래라면 시간 기반 재검토를 표시한다.

### 스윙 — 2~8주

필수 데이터는 일봉 ATR14, 4시간봉 타이밍, `tradeSetup.failureLevel`, 저항선, SMA20, 22봉 Chandelier 3ATR과 신호 신뢰도다.

```text
distance = clamp(entry - failureLevel, 1.5 * ATR1d, 2.5 * ATR1d)
stop = entry - distance
R = entry - stop
takeProfit1 = resistance가 entry+1R~entry+2R이면 resistance, 아니면 entry+1R
takeProfit2 = entry + 2R
trailingExit = max(SMA20, ChandelierLong)
```

- 1차 30%, 2차 30%, 추적 보유 40%다.
- 시장 게이트 실패, 신뢰도 `low`, 또는 무효선이 진입가 이상이면 `wait`다.
- 손절과 추적선은 일봉 종가 기준으로 평가한다.

### 장기 — 6개월 이상

필수 데이터는 SMA200, 10개월 이동평균, 주봉 SMA20/60과 장기 시장 게이트다.

```text
stop = max(SMA200, tenMonthAverage)
R = entry - stop
takeProfit1 = entry + 2R
takeProfit2 = entry + 4R
trailingExit = weeklySMA20
```

- 2R에서 20%, 4R에서 20%만 부분 익절하고 잔여 60%는 추세를 추적한다.
- 주봉 SMA20이 SMA60 이하이거나 장기 시장 게이트가 실패하면 `wait`다.
- 무효선은 월말 종가 기준이며 `isBrokerStopEligible=false`다.

## 5. 현재 데이터와 추가 필요 데이터

- 단타: 현재 일반 시장 데이터 공급자는 `1h | 1d | 1wk`만 지원한다. 실제 적용 전 Toss 1분봉 수집, 15분 집계와 세션 VWAP 경계가 필요하다.
- 스윙: 기존 `tradeSetup`, `signalReliability`, `indicators.atrStops`, `indicators.chandelier`를 재사용한다. 원시 ATR14와 선택한 구조선도 응답에 명시한다.
- 장기: 분석 내부의 EMA200·주봉 추세 계산을 공개 계약으로 올리고 SMA200 또는 10개월 이동평균을 추가한다.
- 응답에는 각 값의 기준 시각, 봉 주기와 데이터 부족 사유를 포함한다.

## 6. 주문 적용 안전 규칙

- 적용 버튼은 `actionable` 상태에서만 활성화한다.
- 주문 서랍에는 진입가, 1·2차 익절가, 손절·무효선, 발동 기준, 분석 스냅샷과 위험 성향을 복사한다.
- 복사는 `OrderIntent`를 생성하거나 broker 요청을 보내지 않는다.
- 일반 stop 주문은 발동 시 시장가로 바뀌어 급변·갭 상황에서 표시가와 다르게 체결될 수 있음을 표시한다.
- 장기 무효선은 알림 조건으로만 복사하고 stop 주문 필드에는 자동 제출 가능한 값으로 취급하지 않는다.

## 7. 근거 자료

- ATR 기반 변동성 손절: [Fidelity Average True Range](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr)
- 손절 규칙과 모멘텀 조건: [Kaminski & Lo, When Do Stop-Loss Rules Stop Losses?](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=968338)
- 장기 이동평균 기반 위험 관리: [Faber, A Quantitative Approach to Tactical Asset Allocation](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=962461)
- 추세 필터와 구현 품질: [Levine & Pedersen, Which Trend Is Your Friend?](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2603731)
- stop 주문 체결 특성: [SEC Stop Order](https://www.sec.gov/answers/stopord.htm)
