# AGENTS.md
# Guidance for agentic coding assistants in this repo.

## Project Overview
- Next.js App Router project with TypeScript and CSS Modules.
- Main app lives in `src/app` with API routes under `src/app/api`.
- Strategy and domain rules live in `STRATEGY_V2.md` and `.agent/skills/stock-analysis/SKILL.md`.
- Performance rules for React/Next.js live in `.agent/rules/react-code-guide.md`.
- No Cursor rules (`.cursor/rules` or `.cursorrules`) found.
- No Copilot rules (`.github/copilot-instructions.md`) found.

## Commands (Build/Lint/Test)
Use `npm` (repo includes `package-lock.json`).

- Install deps: `npm install`
- Dev server: `npm run dev` (Next.js dev server)
- Build: `npm run build`
- Start (prod): `npm run start`
- Lint: `npm run lint`
- Refresh symbol master cache: `npm run refresh:symbol-master`

Testing
- There is no aggregate `test` script yet; use the focused Node test scripts below.
- Crypto buy signal: `npm run test:crypto-buy`
- Community pain signal: `npm run test:community-pain`
- Market briefing: `npm run test:market-briefing`
- Portfolio daily action: `npm run test:portfolio-daily-action`
- Signal reliability: `npm run test:signal-reliability`
- Symbol autocomplete: `npm run test:symbol-search`
- Trading risk policy: `npm run test:trading`

## Repo Layout
- `src/app` contains routes and pages (App Router).
- `src/app/api/**/route.ts` contains serverless API handlers.
- `src/domain` contains service-ready domain types such as market, portfolio, strategy, execution, user, and trading.
- `src/ports` contains external boundary interfaces for repositories, broker APIs, market data, and notifications.
- `src/ports/symbol-master-repository.ts` defines the future DB-backed boundary for symbol autocomplete.
- `src/use-cases` contains application flows called by thin API route controllers.
- `src/app/**/*.module.css` contains CSS Modules for pages.
- `src/app/globals.css` defines global CSS variables and base styles.
- `public/` contains static assets.

## Tooling & Config
- TypeScript config: `tsconfig.json` uses `strict: true` and `moduleResolution: "bundler"`.
- Path alias: `@/*` maps to `src/*` (prefer `@/` for local imports when helpful).
- ESLint: `eslint.config.mjs` uses Next.js core-web-vitals + TypeScript presets.
- Next config: `next.config.ts` is minimal/default.
- No Prettier config; rely on ESLint and existing file formatting.

## Code Style Guidelines

### General TypeScript / React
- TypeScript is `strict: true`; avoid `any` and prefer explicit types.
- Use `type` aliases for shapes (preferred in this repo).
- Use double quotes for strings and include semicolons.
- Keep formatting consistent within the file you edit (indentation is not uniform across files).
- Use `use client` at the top of files that use hooks or browser APIs.
- Prefer functional components and hooks; avoid class components.
- Avoid unnecessary comments; only add comments for non-obvious logic.

### Formatting & Structure
- Prefer `const` and `readonly` props where it matches existing patterns.
- Use trailing commas in multiline objects/arrays where already present.
- Keep helper functions near usage unless shared across files.
- Avoid large refactors of formatting; minimize diff noise.
- Preserve existing line wrap and indentation style per file.

### Imports
- Group imports in this order when editing:
  1) External libraries
  2) React and Next.js
  3) Local files and CSS modules
- Use `type` imports when only types are needed.
- Avoid barrel imports for large libraries (see performance rules below).

### Naming Conventions
- Components: `PascalCase` (e.g. `SentimentPage`).
- Hooks: `useX`.
- Types: `PascalCase` (e.g. `MarketResponse`).
- Files: follow Next.js routing and existing casing (`page.tsx`, `route.ts`).

### State, Effects, and Events
- Clean up subscriptions (`ResizeObserver`, `addEventListener`) in `useEffect`.
- Use passive listeners for scroll/resize when possible.
- Keep `useEffect` dependencies minimal and stable (prefer primitive deps).
- Use `useMemo` for derived data and `useRef` for mutable non-state values.

### Data Fetching & Error Handling
- API routes return `Response.json(...)` or `NextResponse.json(...)` with status codes.
- Use `try/catch` around external fetches; return safe fallbacks on error.
- For client fetches, store `error` in state and render a user-visible message.
- Prefer `Promise.all` for parallel fetches in both server and client (see rules below).
- Check `response.ok` before parsing JSON; surface friendly messages.
- Use `encodeURIComponent` for user-provided URL params.

### Next.js App Router Patterns
- Keep API routes in `src/app/api/<name>/route.ts`.
- Use `GET` handlers as `export async function GET(...)`.
- For caching, use `next: { revalidate: <seconds> }` on fetches.
- Prefer `Response.json` in handlers unless NextResponse is needed.
- Add explicit status codes for 4xx/5xx cases.
- Use `Cache-Control` headers for aggregated endpoints when appropriate.

### CSS / Styling
- Styles are handled with CSS Modules (`*.module.css`) and `globals.css`.
- Use the existing design tokens in `:root` (e.g. `--bg-*`, `--ink-*`, `--accent-*`).
- Keep component-specific styles in the corresponding module file.
- Preserve the established visual language (warm neutrals, teal/orange accents).

### Localization & Content
- UI strings include Korean text; keep existing language unless asked to change.
- When formatting dates, prefer locale-safe methods and avoid brittle string slicing.

## Performance and Architecture Rules (from `.agent/rules/react-code-guide.md`)
Follow these strictly when editing UI or data fetching:

- Eliminate waterfalls: start async work early and await later; use `Promise.all`.
- Add Suspense boundaries for slow or independent UI chunks.
- Avoid barrel imports for large libraries (e.g. lodash, date-fns, lucide-react).
- Lazy-load heavy components and non-critical third-party scripts.
- Minimize data passed from Server Components to Client Components.
- Use `React.cache()` for expensive server computations when appropriate.
- Avoid extra re-renders: memoize expensive subtrees and use primitive deps.
- Prefer immutable operations (e.g. `toSorted()` rather than `sort()`).

## Data Shapes & Time Handling
- Candle data uses UNIX timestamps (seconds) in API responses.
- Normalize user-entered tickers before API calls.
- Symbol autocomplete uses `/api/symbol-search` and the server-side symbol master cache in `.cache/stock-analysis/symbol-master`; keep manual ticker entry as a fallback.
- Keep numeric precision consistent with UI formatting (e.g. price ticks).

## Charting & UI Conventions
- Charts are rendered with `lightweight-charts` in client components.
- Store chart/series instances in refs; avoid re-creating on every render.
- Use `useMemo` for derived stats and `Map` lookups for signal mapping.
- When adding new signals, update legends and `chartColors` in `src/app/page.tsx`.
- Keep chart interactions (click/resize) cleaned up to avoid leaks.

## Stock Analysis Domain Rules (from `.agent/skills/stock-analysis/SKILL.md`)
These rules govern indicator logic and signal generation:

- Follow strategy rules in `STRATEGY_V2.md` (signals, filters, and markers).
- Implement indicators precisely (HMA, RSI, MACD, ATR, BBands, CI, OBV, ADX, MFI).
- Use adaptive RSI thresholds based on ATR% when specified.
- Ensure signal labels and markers align with UI legends in `src/app/page.tsx`.
- Do not change signal logic casually; update strategy docs if logic changes.

## Existing Conventions Worth Following
- `Response.json` payloads match UI expectations in `src/app/page.tsx` and `src/app/sentiment/page.tsx`.
- API routes often use `Promise.all` for parallel external calls.
- Charts and derived stats use `useMemo` and `useRef` to avoid re-renders.
- New feature logic should follow `domain -> ports -> use-cases -> API/UI -> tests/docs`.
- Keep API routes thin: parse input, get `UserContext`, call a use case, return `Response.json`.
- Security, broker, and order-related features must go through `OrderIntent` and `RiskCheck`; never call a broker directly from signal code or client UI.

## Practical Editing Notes
- This repo mixes 2-space and 4-space indentation; keep the existing style per file.
- Keep long files readable by extracting helpers only if needed and consistent.
- Avoid adding new dependencies unless absolutely necessary.
- Update docs if you change strategy logic or user-facing behavior.
