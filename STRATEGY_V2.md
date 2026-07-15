# Hybrid Kinetic Strategy (V2.2)

This document outlines the **Hybrid Kinetic** trading strategy version 2.2. This update integrates **Candlestick Pattern Analysis** to filter false signals and confirm entries with price action precision.

> Runtime Note (2026-03-06): The current production signal engine in `src/app/api/market/[symbol]/route.ts` is running in a **dual daily BUY mode** and **Swing Trap Plus-One mode** for SELL.  
> On `1d`, BUY uses either a `base panic` profile or a `growth reset` profile, depending on symbol volatility and market type.
>  
> Balanced tuning currently applied:
> - On `1d`, BUY setup still tracks `3/6` oversold conditions (`RSI`, `CCI`, `Stoch/Williams %R`, `BB lower`, `SMA20 deviation`, `5d return`) for diagnostics.
> - `Base panic` BUY emission is limited to three same-day archetypes: `Crash Reclaim`, `Balanced Panic`, and `Flush Panic`.
> - `Crash Reclaim` requires a hard down day with large range, heavy volume, and a strong close back off the lows.
> - `Balanced Panic` requires a full oversold setup with a mid-close panic candle and very oversold oscillators.
> - `Flush Panic` requires a full oversold setup with a close near the low and extreme momentum washout.
> - `Growth reset` BUY emission is only enabled for non-crypto 1D symbols with rolling `90-bar median ATR14/close >= 3.5%`, and it emits on a `+1~+2 bar` structure-reclaim trigger.
> - `Growth reset` reasons are classified as `Turn-Day Reset`, `Gap Snapback`, `Two-Step Flush`, or `Compression Reset`.
> - Volume is part of the exact-day template gate for `base panic`, while `growth reset` uses breakout quality on the trigger day.
> - Non-`1d` BUY/SELL still use wick/penetration-based Swing Trap reclaim logic.
> - Swing Trap cooldown uses `1d base panic=45`, `1d growth reset=8`, `4h=18`, `1h=24`, `1wk=4`.
> - Debug diagnostics expose `setup -> trigger candidate/pass -> exact-day archetype passes / growth profile passes -> exact-day suppressions -> emitted` under `debug=1`.
> - Bottom capture KPI, daily quality (`bottomLeg10/15/20`, `buyFailure10`, `recentFailedBuys`), and `dailyBottomStudy` (`setupCoverage`, `triggerCoverage<=3`, `failedTriggerBuys`) are returned when `debug=1&diag=1` on `1d`.
>
> Trend-following runtime note (2026-05-25): the main stock workflow now treats the legacy signal engine as a secondary reference and adds a price-first trend-following layer for daily trading decisions.
> - Primary stock workflow uses 1D as the main timeframe and 4H as timing assistance.
> - Entry review focuses on SMA5/SMA20 support, volume confirmation, market breadth, and leader filtering.
> - `breakoutRule` is an advisory overlay for new-high breakouts, -10% fixed stop reference, +20% profit-tracking switch, and SMA20 trailing exit review.
> - This overlay is not an automatic buy command; the UI should phrase it as `breakout candidate`, `support check`, `20-day trailing mode`, or `risk management`.
>
> Stock playbook shadow note (2026-07-15): the additive v2 contract separates `kr-intraday-crash-reversal`, `short-hold-trend`, `swing-mean-reversion`, and `swing-trend`.
> - The legacy daily `3/6` diagnostic remains for backward-compatible `signals`; it is not accepted by itself as calibrated playbook evidence. RSI, CCI, Stochastic, and Williams %R are one oscillator family in the new validation design.
> - Divergence markers are exposed only at their confirmation candle and carry separate `occurredAt` and `confirmedAt` values.
> - Structural invalidation levels are never clamped into an ATR policy band. An out-of-policy distance blocks a new entry.
> - Runtime loads mapped sector-relative-strength and curated 50-day leader evidence. The curated universe is not representative market breadth, so the market gate remains `unavailable` until a point-in-time full-market provider is connected. Missing, stale, or low-coverage evidence also remains `unavailable`.
> - A market/playbook is promoted only by one complete, explicitly reviewed calibration record; otherwise it stays shadow/fail-closed.

## 1. Monitor & Indicators

The system monitors specific technical indicators to generate signals.

### Trend Indicators
- **HMA (Hull Moving Average):**
  - **HMA 20:** Fast trend line.
  - **HMA 50:** Slow trend line (Baseline).
  - **Trend Check:** HMA 20 > HMA 50 = Bullish.
- **EMA 200:** Long-term trend filter (Price > EMA 200 = Bullish).
- **SMA 20/60/100:** Support/Resistance levels.
- **Chandelier Exit (ATR 3.0):** Trailing stop based on volatility.

### Momentum & Volatility
- **RSI (Relative Strength Index):**
  - **RSI 14:** General momentum (Adaptive bands based on ATR).
  - **RSI 2:** Fast momentum for "Panic" detection.
- **Fast Stochastic (5, 3, 3):** Early momentum shift detection.
- **Williams %R (14):** Overheat detection.
- **MACD (12, 26, 9):** Trend confirmation.
- **ADX (14):** Trend strength (ADX > 25 = Strong, < 20 = Weak/Range).
- **Bollinger Bands (20, 2):** Volatility bounds and mean reversion targets.
- **ATR (14):** Volatility-based Stop Loss calculation.

### Volume Analysis
- **Volume MA 20:** Baseline for volume surges.
- **Stopping Volume / Capitulation:**
  - **Capitulation:** Volume > 3.0x Average + RSI < 20 (Panic dump).
  - **Stopping Vol:** Volume > 2.0x Average + Small Candle Body.
- **OBV (On-Balance Volume):** Bullish Divergence check (Price Lower, OBV Higher/Flat).

---

## 2. Signal Types & Logic (V2.2 Integrated)

The strategy generates Buy and Sell signals with specific markers.

### 🔵 BUY SIGNALS (Entries)

| Signal Name | Marker | Logic | Candle Integration (V2.2) |
|:--- | :---: | :---| :---|
| **Lead Buy (Aggressive)** | ▲ (Purple) | **HMA Turn:** Price > EMA 200 + HMA 20 Turn.<br>**Stoch Launch:** Fast Stoch Bullish Cross.<br>*Requires Volume > MA20.* | **Breakout Quality Filter:**<br>Ignore if Signal Candle is **Doji**, **Shooting Star**, or has long upper wick.<br>Prefer **Marubozu** or Strong Close. |
| **Kinetic Reversal** | ◆ (Purple) | **Panic Rebound:** RSI(2) < 5 + Bounce.<br>**Divergence:** Bullish RSI Div.<br>**Confirm:** Stopping Vol / BB Trap. | **Pattern Confirmation:**<br>Require **Hammer**, **Inv. Hammer**, or **Bullish Engulfing** on/after signal.<br>If next candle is Bearish/Doji -> WAIT. |
| **Trend Buy (Classic)** | ▲ (Dk Purple)| **HMA Cross:** HMA 20 > 50.<br>**Confirmations:** MACD, RSI, EMA 200. | **Support Check:**<br>Most reliable if formed near Support (SMA/EMA) + Bullish Candle. |
| **Capitulation Buy** | ● (Cyan) | **Alert:** Volume > 3x Avg + RSI < 20 + Big Red Candle. | **Entry Trigger:**<br>Do NOT buy on `●`. Buy ONLY when a **Bullish Reversal Candle** (Hammer/Engulfing) forms *after* the alert. |
| **Weak Buy (Scout)** | ▲ (Light Pur)| **Cond:** Minor HMA Turn / Weak Bounce.<br>**Filter:** Ignore in Strong Downtrend. | **Pattern Upgrade:**<br>If accompanied by **Morning Star** or **Key Reversal Pattern**, upgrade confidence to **Moderate/Strong**. |

### 🔴 SELL SIGNALS (Exits)

| Signal Name | Marker | Logic | Candle Integration (V2.2) |
|:--- | :---: | :---| :---|
| **Overheat Warning** | ● (Orange) | **RSI > 70** + Williams %R Turn.<br>**Advisory:** Hold if ADX > 25. | **Topping Patterns:**<br>High confidence if **Shooting Star**, **Evening Star**, or **Bearish Engulfing** appears. |
| **Lead Stop Failure** | ◆ (Orange) | **Stop Hit:** Price < Entry - 2x ATR. | N/A (Hard Stop) |
| **Trend Stop** | ▼ (Dark Org) | **Breakdown:** HMA Death Cross + Price < EMA 200. | **Breakdown Quality:**<br>Watch for **Three Black Crows** or **Big Red Marubozu** confirming trend change. |

---

## 3. Position & Risk Management

Effective risk management is enforced via specific Stop Levels displayed on the UI.

### Stop Loss Rules
1.  **Lead/Kinetic Entry (Aggressive):**
    - **Stop Level:** `Entry Price - 2.0x ATR` OR `Low of Reversal Candle`.
    - **Reason:** Use the specific low of the **Hammer/Engulfing** candle for tighter, structure-based stops.

2.  **Confirmed Trend Entry (Conservative):**
    -   **Stop Level:** `HMA 50` or Breakeven.
    -   **Reason:** Trailing stop logic.

3.  **Profit Taking:**
    -   **Partial:** On "Overheat Warning" (unless ADX > 25).
    -   **Full:** On "Confirmed Trend Stop".

---

## 4. UI Legend Reference

-   **Buy Zone:**
    -   ● **Capitulation (Cyan):** Panic Bottom Alert (Wait for Candle).
    -   ◆ **Kinetic (Purple):** Strong Reversal (Confirmed).
    -   ▲ **Lead/Trend (Dk Purple):** Standard Entry.
    -   ▲ **Weak (Lt Purple):** Speculative / Scout.

-   **Sell Zone:**
    -   ● **Overheat (Orange):** Profit Warning.
    -   ◆ **Stop:** Urgent Exit.
    -   ▼ **Trend Stop:** Trend Change.

---

## 5. Signal Filtering (V2.1 & V2.2)

### A. Trend Filter (V2.1)
-   **Rule:** If `Price < EMA 200` AND `ADX > 25`, **IGNORE** all Weak Buy signals (unless Divergence present).

### B. Volume Filter (V2.1)
-   **Rule:** Breakout signals MUST have `Volume > MA20`.

### C. Candlestick Filter (V2.2)
-   **Rule:** **NO BUY** if the signal candle is a **Bearish Pinbar (Shooting Star)**, **Doji**, or **Black Crow** (Close < Open).
-   **Logic:** Indicators are lagging; Candle shape is real-time sentiment. If sentiment conflicts with indicator -> Sentiment wins (No trade).

---

## 6. Key Candlestick Patterns (Reference)

| Pattern | Type | Shape | Reliability |
| :--- | :--- | :--- | :--- |
| **Hammer** | Bullish Reversal | Small body top, long lower wick (>2x body). | Moderate (High at Support) |
| **Bullish Engulfing** | Bullish Reversal | Green body engulfs previous Red body. | High |
| **Morning Star** | Bullish Reversal | Big Red -> Doji/Spinning -> Big Green. | High (Strong Bottom) |
| **Shooting Star** | Bearish Reversal | Small body bottom, long upper wick (>2x body). | Moderate (High at Res) |
| **Bearish Engulfing** | Bearish Reversal | Red body engulfs previous Green body. | High |
| **Evening Star** | Bearish Reversal | Big Green -> Doji -> Big Red. | High (Strong Top) |

## 7. 관심종목 급락 반전 감시 (macOS)

이 신호는 기존 일봉 BUY 엔진과 분리된 장중 보조 분석이다. 검증된 Toss API의 확정 1분봉을 5분봉으로 집계하며 Yahoo fallback으로 알림을 내지 않는다. `급락 감지`는 매수 명령이 아니고, 반전봉 확인 뒤에도 UI 문구는 `매수 검토 가능`을 사용한다.

- `급락 감지`: 당일 `-4%` 이하이면서 일봉 ATR14 대비 `1.5 ATR` 이상 하락하거나 최근 15분 `-3%` 이하 하락, 직전 20거래일의 동일 KST 5분 구간 대비 거래량 `2배` 이상, RSI14 `25` 이하 또는 RSI2 `10` 이하를 모두 확인한다.
- `반전 확인`: 급락 저점 이후 확정 5분봉이 Hammer, Bullish Engulfing 또는 강한 양봉이고 급락봉 몸통 중간값을 회복하며 종가 위치가 봉 상단 35% 안, 동일 시간대 거래량이 `1.2배` 이상이어야 한다.
- 급락 저점을 다시 이탈하면 후보를 무효화한다. KOSPI가 `-1.5%` 이하이고 장중 저점 회복률이 35% 미만이면 신호를 차단하지 않고 신뢰도를 한 단계 낮춘다.
- 손절은 `min(급락 저점, 최근 20개 5분봉 저점) - 0.2 ATR5m` 구조선을 그대로 유지한다. 손실 거리가 `0.8~1.8 ATR5m` 밖이면 손절선을 이동하지 않고 신규 진입을 보류한다.
- 1차 익절은 가까운 저항이 `0.8R~1.5R`이면 그 저항, 아니면 `1R`에서 50%다. 2차는 `2R`에서 50%다. 가까운 저항이 `0.8R` 미만이면 `보상 부족`으로 표시한다.
- 손절·익절은 분석 기준가 기준의 설명 가능한 가격선이며 broker stop, OrderIntent 또는 주문 제출로 변환하지 않는다.

## 8. Beginner-first 자동화 계약 (macOS 1.0)

전략 설정은 `초안 저장 → 조건 확인 → paper 시뮬레이션 → 활성화` 순서를 지킨다. 데스크톱 앱은 실제 broker 제출을 하지 않으며, 자동화 탭은 `status == enabled` 전략만 단일 원본으로 표시한다.

- 주식은 `orderSizing: { mode: "quantity", quantity }`로 고정 주식 수를 사용한다.
- 코인은 `orderSizing: { mode: "notional", notional }`로 고정 원화 주문금액을 사용하고, 실행가격 기준 수량을 최대 8자리까지 계산한다. 거래소 최소금액·정밀도는 precheck에서 확인한다.
- `orderSizing`이 없는 기존 전략은 차수별 `notional` 수량 계산을 유지한다. 전략 백업은 schema v2를 사용하며 v1 가져오기는 금액 기준 draft로 변환하고 시뮬레이션을 폐기한다.
- 저장된 비균등 grid 차수는 사용자가 차수 수·첫 하락폭·차수 간격을 바꾸기 전까지 원본 배열을 보존한다.
- `현재가 새로고침`은 최근 확인 가격만 바꾸고 기준가는 바꾸지 않는다. 기준가 변경은 `현재가 적용` 또는 수동 입력으로만 가능하며 기존 시뮬레이션을 무효화한다.
- 추가매수 중단선은 신규 매수만 막는다. 손절은 ladder의 보유 평단, grid의 열린 lot 가중평단, loop의 실제 진입가를 기준으로 보유분 전량 paper 청산한다.
- 손절 청산이 실패하거나 live 차단에 걸리면 worker state에 `stop-loss-pending`을 남겨 가격이 회복돼도 신규 진입·익절을 만들지 않고 다음 cycle에 청산을 재시도한다. paper 청산이 완료되면 전략을 disabled로 바꾸고 시뮬레이션을 제거한다.
