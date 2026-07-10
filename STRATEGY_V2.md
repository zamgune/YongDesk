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
