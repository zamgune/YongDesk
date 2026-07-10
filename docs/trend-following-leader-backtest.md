# Trend-Following Leader Backtest

This note records the 5-year leader-basket backtest for the trend-following signal work.

## Test Setup

- Period: 2021-05-20 to 2026-05-20.
- Data source: Yahoo Finance daily candles.
- Markets:
  - NASDAQ basket: 22 major large-cap and growth names.
  - KOSPI basket: 19 major large-cap names.
- Leader selection: rank each market basket by 50-day return and allow only the top 4 or top 5 symbols.
- Entry: close > SMA20 > SMA50, SMA50 non-falling, SMA20 rising, and either continuation volume/close strength or 20-day breakout volume.
- Exit: initial stop or SMA50 trend failure.
- Costs: 0.20% transaction cost/slippage per side.
- Success metric: signal-success rate means the trade reached at least +5% favorable movement after entry.

## Strategy Variants

- `leader-sma50`: base leader filter with SMA50 hold.
- `leader-risk-managed`: market breadth filter, 8% maximum initial risk, breakeven after +8%, profit-protect exit after +14%.
- `leader-defensive`: stricter market breadth, 6% maximum initial risk, lower exposure.
- `leader-wide-hold`: market filter with wider 10% stop and SMA50 hold.
- `leader-momentum-defensive`: stricter market filter, minimum 50-day leader return, 8% maximum initial risk, profit protection.

## Recommended Results

| Market | Recommended setup | Trades | Win rate | Signal success | Total return | CAGR | Max drawdown | Exposure |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| NASDAQ | Top 4, `leader-risk-managed` | 90 | 43.3% | 73.3% | 121.6% | 17.3% | -16.6% | 41.8% |
| KOSPI | Top 4, `leader-momentum-defensive` | 70 | 37.1% | 72.9% | 47.8% | 8.1% | -20.4% | 30.0% |

## Interpretation

- NASDAQ is tradable as a candidate-generation system. It does not beat equal-weight buy-and-hold over this period, but it uses lower exposure and materially reduces drawdown versus the raw SMA50 leader strategy.
- KOSPI is usable only with the stricter momentum-defensive filter. The raw leader strategy had weak returns and excessive drawdown, so KOSPI should not use the base SMA50 rule.
- Completed-trade win rate remains far below 70%. The practical edge is not a high closed-trade win rate; it is selecting leaders that often move at least +5% in favor while risk is capped.
- The system should be used for discretionary or semi-systematic candidate review before real capital automation.

## Trading Rules To Keep

- Use daily candles as the primary decision timeframe.
- Use 4H candles only for timing support after the daily setup is valid.
- Trade only symbols ranked in the top 4 of their market basket by 50-day return.
- For NASDAQ, prefer `leader-risk-managed`.
- For KOSPI, prefer `leader-momentum-defensive`.
- For KOSDAQ, use the same stricter `leader-momentum-defensive` profile until a separate 5-year KOSDAQ validation has enough reliable constituents.
- Do not take signals when the market breadth gate fails.
- Do not widen the stop after entry.
- Treat 2R as a reference level, not as a forced full exit.
- Keep the automated-trading readiness layer stricter than the scanner decision. `enter` is a candidate state, not an order command.
- Block or downgrade candidates when the stop distance exceeds the strategy risk cap, the 5-day move is too extended, or the signal comes only from pre-market/after-hours movement.

## Live Scanner Behavior

- The app exposes `/api/market/auto-leaders` for the main UI scanner.
- Supported markets are `US`, `KOSPI`, and `KOSDAQ`.
- The automatic scanner builds a daily candidate list, ranks it by 50-day return, and returns the current top candidates with one of four decisions:
  - `enter`: market filter, leader rank, momentum, and latest daily entry trigger all pass.
  - `hold`: a trend setup is already active; use the chart before chasing a late entry.
  - `watch`: the symbol is a valid leader with trend structure, but the current candle does not pass the entry trigger.
  - `avoid`: market breadth, leader rank, or momentum filter failed.
- The UI market scanner is the intended first step before loading an individual chart.
- `/api/market/leaders` remains available as a compatibility and explicit-symbol scanner. Use it when the caller already has a known symbol list.
- Daily market briefing derives `entryCandidates` from the same scanner output. This list separates strong stocks from trading-ready candidates with `tradable`, `armed`, `watch`, and `blocked` states.
- `tradable` and `armed` are preparation states only. They should not place live orders until a future execution layer verifies order type, position sizing, account limits, and real-time price constraints.

## Automatic Candidate Source

- US uses Yahoo screener results first and targets 50 daily candidates.
- KOSPI and KOSDAQ may fall back to the curated universe when Yahoo does not provide enough usable dynamic candidates.
- The API returns `candidateSource.status` so the UI can show whether the scan used `dynamic`, `mixed`, or `fallback` candidates.
- Daily market briefing uses the same automatic scanner:
  - `GET /api/briefing/daily-market?session=US`
  - `GET /api/briefing/daily-market?session=KR`

## Remaining Risks

- Results are sensitive to the selected universe and Yahoo adjusted data quality.
- Taxes, borrow constraints, exact order execution, and intraday gaps are not modeled.
- KOSPI performance is materially weaker than NASDAQ and should be paper-traded before using cash.
- KOSDAQ is more volatile than KOSPI large caps, so the scanner should be treated as a candidate filter rather than an automatic entry tool.
- Korea dynamic candidate quality depends on available Yahoo data; fallback scans are useful for review but should not be treated as full-market discovery.
- A 2022-like downtrend still requires strict market-breadth filtering.
