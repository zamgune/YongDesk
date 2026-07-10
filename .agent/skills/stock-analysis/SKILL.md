---
name: FullStack_Stock_Specialist
description: Specialist combining expert Stock Analysis Strategy implementation with Vercel's Critical React/Next.js Performance Standards.
version: 2.0.0
---

# FullStack Stock Analysis & Engineering Specialist

This skill equips the agent with dual capabilities: precise execution of the StockAnalysis trading strategy and strict adherence to Vercel's React/Next.js performance guidelines.

## PART 1: Stock Analysis Domain (Logic & Strategy)

### Core Responsibilities
1.  **Indicator Implementation**: Accurate calculation of technical indicators including HMA, EMA, SMA, RSI, MACD, ATR, Bollinger Bands, Choppiness Index (CI), OBV, ADX, and MFI.
2.  **Signal Logic**: Strict adherence to buy/sell signal rules defined in `STRATEGY.md`.
3.  **Adaptive Thresholds**: Implementing dynamic RSI thresholds based on ATR% (volatility).

### Strategy Reference (Refer to `STRATEGY.md` for updates)
* **Trend Buy**: RSI > 50, HMA20 > HMA50, MACD > Signal. (Confirm with: Price > EMA200, CI < 38.2).
* **Reversal Buy**: RSI < adaptive oversold, Close > SMA20/recent high. (Requires ADX < 25 for strong signals).
* **Overheat Sell**: Profit taking when OBV < OBV_MA20, RSI > 70, or MFI > 80.
* **Stop Loss**: Exit when Close < EMA200 or HMA cross down (Trend Stop).

---

## PART 2: React/Next.js Engineering Standards (Performance)

**Directive:** Apply these rules strictly when writing or refactoring UI/Dashboard code.

### 1. Eliminating Waterfalls [CRITICAL]
* **1.1 Defer Await**: Do not block top-level scope. `const data = await fetch()` should happen *after* `if(skip) return`.
* **1.2 Parallelize**: Use `Promise.all()` for independent fetches. Use `better-all` for partial dependencies.
* **1.3 API Routes**: Start promises immediately, await them only when needed (non-blocking init).
* **1.4 Suspense**: Wrap slow components in `<Suspense>`. Do not block the entire page render.

### 2. Bundle Size Optimization [CRITICAL]
* **2.1 No Barrel Imports**: Avoid `import { Icon } from 'lib'`. Use `import Icon from 'lib/Icon'` or configure `optimizePackageImports`.
* **2.2 Conditional Loading**: Use `dynamic()` or `import()` for heavy modules (Charts, Editors) based on interaction/visibility.
* **2.3 Defer Third-Party**: Load Analytics/Logs after hydration or via `after()`.

### 3. Server-Side Performance [HIGH]
* **3.1 Cross-Request Caching**: Use `lru-cache` for data shared *between* users/requests.
* **3.2 RSC Serialization**: Pass ONLY used fields to Client Components (e.g., `<Comp name={user.name} />` not `<Comp user={user} />`).
* **3.3 Request Deduplication**: Use `React.cache()` for DB/Computation (Fetch is auto-deduped).
* **3.4 Non-Blocking**: Use `after()` for side effects (logging) to unblock responses.

### 4. Client-Side Data [MED-HIGH]
* **4.1 SWR/TanStack**: Use for auto-deduplication of client requests. Never use raw `useEffect` fetch.
* **4.2 Global Listeners**: Deduplicate window events (keyboard/socket) using `useSWRSubscription`.

### 5. Re-render Optimization [MED]
* **5.1 Read-on-Demand**: Don't subscribe to state/params if only used in callbacks.
* **5.2 Primitive Deps**: Use `useEffect(..., [user.id])` instead of `[user]`.
* **5.3 Functional Updates**: Use `setState(prev => ...)` to ensure stable callbacks.
* **5.4 Lazy Init**: `useState(() => heavy())` to run logic only once.

### 6. Rendering Performance [MED]
* **6.1 CSS Animation**: Animate a wrapper `<div>`, not the `<svg>` itself (Hardware Accel).
* **6.2 content-visibility**: Use `auto` for long lists (e.g., Stock ticker lists).
* **6.3 No-Flicker Hydration**: Use inline `<script>` for theme/localStorage generic classes.

### 7. JS & Micro-Optimizations [LOW]
* **7.1 Map Lookup**: Convert arrays to `Map` (O(1)) for repeated lookups vs `.find()` (O(n)).
* **7.2 Loop Optimization**: Combine multiple `.filter/.map` passes into one loop.
* **7.3 Length Check**: `if (a.length !== b.length)` before deep compare.
* **7.4 Immutable Sort**: Use `.toSorted()` instead of `.sort()` to avoid mutation bugs.