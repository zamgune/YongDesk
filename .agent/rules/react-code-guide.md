---
trigger: always_on
---

# React & Next.js Optimization Rules for Agents

> **Directive:** Follow these rules strictly when generating or refactoring React/Next.js code. prioritize CRITICAL and HIGH impact items.

## 1. Eliminate Waterfalls [CRITICAL]
*Performance Killer #1. Maximize concurrency.*

* **1.1 Defer Await (Branching):** Do not block top-level scope with data needed only in one branch.
    * *Bad:* `const data = await fetch(); if(skip) return;`
    * *Good:* `if(skip) return; const data = await fetch();`
* **1.2 Dependency Parallelism:** Use `better-all` or `Promise.all` for partial dependencies. Don't sequentialize independent fetches.
* **1.3 API Routes/Server Actions:** Start promises immediately, await later.
    * *Pattern:*
        ```ts
        const sessionP = auth(); // Start
        const configP = fetchConfig(); // Start
        const session = await sessionP; // Await when needed
        const [config, data] = await Promise.all([configP, fetchData(session.id)]);
        ```
* **1.4 Independent Ops:** Always use `Promise.all()` for queries with no interdependencies.
* **1.5 Suspense Boundaries:** Don't block entire page. Wrap slow components in `<Suspense>`.
    * *Pattern:* Parent renders layout -> Child fetches data.
    * *Alt:* Pass `Promise` as prop, unwrap with `use(promise)` in child.

## 2. Bundle Size [CRITICAL]
*Direct impact on TTI/LCP.*

* **2.1 No Barrel Imports:** Avoid `import { Icon } from 'lib'`.
    * *Action:* Use `import Icon from 'lib/Icon'` OR configure `optimizePackageImports` in `next.config.js`.
    * *Targets:* `lucide-react`, `@mui/*`, `lodash`, `date-fns`.
* **2.2 Conditional Loading:** Lazy load heavy logic/data only when needed.
    * *Pattern:* `if (enabled) import('./heavy').then(...)`
* **2.3 Defer Non-Criticals:** Load Analytics/Logs after hydration via `next/dynamic` (`ssr: false`) or `after()`.
* **2.4 Dynamic Components:** Lazy load heavy UI (Editors, Maps, Charts).
    * `const Editor = dynamic(() => import('./monaco'), { ssr: false })`
* **2.5 Intent Preloading:** Trigger `void import('./module')` on `onMouseEnter` or `onFocus`.

## 3. Server-Side Performance [HIGH]
* **3.1 Cross-Request Caching:** Use `lru-cache` for data shared *between* different requests/users (not per-request).
* **3.2 RSC Serialization:** Pass ONLY used fields to Client Components to minimize network payload.
    * *Bad:* `<ClientComp user={hugeUserObj} />` (where only `name` is used).
    * *Good:* `<ClientComp name={user.name} />`
* **3.3 Parallel Fetches via Composition:** Don't let parent await block child fetch. Render completely independent RSCs in parallel within a Layout or Parent.
* **3.4 Request Deduplication:** Use `React.cache()` for DB/Computation (fetch is auto-deduped in Next.js).
    * *Note:* Pass primitives or stable references to cached functions. Inline objects cause cache misses.
* **3.5 Non-Blocking Side Effects:** Use Next.js `after()` for logging/analytics to unblock response.
    * `after(() => logAnalytics(data))`

## 4. Client-Side Data [MED-HIGH]
* **4.1 Global Listeners:** Use `useSWRSubscription` for global events (keyboard/socket) to ensure 1 listener vs N components.
* **4.2 Passive Listeners:** `addEventListener(evt, fn, { passive: true })` for scroll/wheel/touch.
* **4.3 SWR/TanStack Query:** Use for auto-deduplication of client requests. Never raw `useEffect` fetch.
* **4.4 localStorage Versioning:** Use keys like `userConfig:v2`. Always wrap access in `try-catch`.

## 5. Re-render Optimization [MED]
* **5.1 Read-on-Demand:** Don't subscribe to params/storage if only used in handlers. Read directly in callback.
* **5.2 Memoization:** Use `memo()` for expensive sub-trees (unless React Compiler enabled).
* **5.3 Primitive Deps:** `useEffect(..., [user.id])` instead of `[user]`.
* **5.4 Derived State:** Subscribe to `isMobile` (boolean) not `windowWidth` (number).
* **5.5 Functional Updates:** Use `setState(prev => ...)` to avoid stale closures and reduce dependencies.
* **5.6 Lazy Init:** `useState(() => heavyComputation())` to run logic only once.
* **5.7 Transitions:** Wrap non-urgent updates (logging, analytics, prefetching) in `startTransition`.

## 6. Rendering Performance [MED]
* **6.1 CSS Animation:** Animate a wrapper `<div>`, not the `<svg>` itself (Hardware Acceleration).
* **6.2 content-visibility:** Use `content-visibility: auto` CSS for long lists/off-screen content.
* **6.3 Hoist Static JSX:** Define static SVGs/footers outside component (or let React Compiler handle it).
* **6.4 SVG Precision:** Reduce decimal precision in `viewBox`/`path` (use SVGO).
* **6.5 No-Flicker Hydration:** Use inline `<script>` to set generic classes (themes) before hydration to prevent layout shift.
* **6.6 Activity:** Use `<Activity mode="hidden">` (if available) or `display: none` for frequent toggles to preserve DOM state.
* **6.7 Explicit Conditionals:** Use `count > 0 ? <Badge/> : null`. Avoid `count && <Badge/>` (renders "0").

## 7. JS & Micro-Optimizations [LOW-MED]
* **7.1 Batch CSS:** Use classes or `style.cssText` instead of setting style props one by one.
* **7.2 Map Lookup:** Convert arrays to `Map` (O(1)) for repeated lookups vs `.find()` (O(n)).
* **7.3 Loop Cache:** Cache property access (`obj.config.value`) outside loops.
* **7.4 Function Cache:** Use module-level `Map` to cache expensive pure function results (slugify, formatters).
* **7.5 Storage Cache:** Cache `localStorage`/`cookie` reads in memory (Map) to avoid sync I/O. Invalidate on events.
* **7.6 Single Loop:** Combine multiple `.filter/.map` passes into one loop.
* **7.7 Length Check First:** `if (a.length !== b.length) return false` before deep compare/sort.
* **7.8 Early Return:** Fail fast in loops/functions.
* **7.9 Hoist RegExp:** Create `RegExp` outside render or `useMemo`.
* **7.10 Min/Max Loop:** Use a single loop O(n) to find min/max. Do NOT `sort()` O(n log n).
* **7.11 Set.has:** Use `Set` for inclusion checks (`allowed.has(id)`).
* **7.12 Immutable Sort:** Use `.toSorted()` instead of `.sort()` to avoid mutating props/state.

## 8. Advanced Patterns [LOW]
* **8.1 Event Refs:** Use `useEffectEvent` (or ref pattern) for event handlers inside effects to avoid re-subscription.
* **8.2 useLatest:** Use a ref to hold the latest callback/value to break dependency chains in `useEffect`.