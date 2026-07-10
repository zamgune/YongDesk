# Trend-Following Threshold Notes

This document records the threshold assumptions for `add-trend-following-signals`. It is intentionally separate from implementation code so threshold tuning can be reviewed without changing the strategy contract casually.

## V2 Defaults

- Primary signal timeframe: 1D.
- Auxiliary timing timeframe: 4H.
- Minimum history: 50 completed candles.
- Trend stack: close > SMA20 > SMA50.
- SMA20 slope lookback: 3 bars.
- SMA50 slope lookback: 5 bars.
- Minimum SMA20 slope: 0.10%.
- Minimum SMA50 slope: 0.00%.
- Continuation volume ratio: 1.20x volume MA20.
- Breakout volume ratio: 1.35x volume MA20.
- Close strength: 0.60 close location inside the candle range.
- Breakout lookback: prior 20 bars.
- Structure stop lookback: recent 5 bars.
- Exit: initial structure stop or daily close below SMA50.
- 2R level: kept as a reference level, not a forced partial exit.

## Breakout Overlay Defaults

The breakout overlay is an advisory layer on top of the existing trend-following signal. It does not replace the SMA5/SMA20/volume/leader filters.

- API block name: `breakoutRule`.
- Status values: `breakout-ready`, `wait-pullback`, `profit-tracking`, `risk-off`, `avoid`.
- New-high reference: prior 120 bars when enough history exists; prior 252 bars is used when available.
- Traded value strength: latest 20-bar average of `close * volume`.
- Fixed stop reference: 10% below the breakout reference level.
- Profit tracking switch: 20% above the breakout reference level.
- Trailing line after profit switch: SMA20.
- Risk-off state: price threatens SMA20 or the fixed 10% stop reference.
- Scan ranking: 50-day relative strength remains primary; breakout-ready and profit-tracking add a small secondary bonus.
- UX language: show `breakout candidate`, `pullback/support check`, or `20-day trailing mode`; do not present the rule as an automatic buy command.

## Backtest Notes

- Baseline v1 SMA20-exit strategy over the NASDAQ/KOSPI basket produced 44.0% completed-trade win rate, 61.4% signal-success rate, and 37.2% average strategy return.
- SMA50 hold improved average strategy return to 42.7%, but completed-trade win rate remained low because strong trends stayed open and weak trends still chopped.
- The best simple validation rule was a relative-strength leader gate: only take entries when the symbol is top 3 in its market basket by 50-day return.
- With that gate, `v6-rs-top3-sma50` produced 70.6% signal-success rate and 41.6% average strategy return in the 2-year NASDAQ/KOSPI basket check.
- Completed-trade win rate did not reach 70%; treating 70% as profitable closed trades would require either overfitting, heavier indicators, or a much narrower universe.

## Validation Notes

- These defaults are conservative enough to avoid pure SMA5/SMA20 whipsaws, but leader filtering should be used when scanning multiple candidates.
- Large-cap stocks, growth stocks, Korean large caps, and crypto proxies should be reviewed separately before market-specific overrides are introduced.
- Do not tune per ticker until baseline backtest evidence shows a durable problem.
- Treat 4H output as timing assistance only; do not compare it directly with 1D results unless the periods are retuned.
