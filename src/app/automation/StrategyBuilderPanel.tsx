"use client";

import { useMemo, useState } from "react";

import type { AutomationMarket, AutomationMode, AutomationPriceAnchor, GridRung } from "@/domain/automation";
import type { SymbolSearchItem } from "@/lib/market/symbol-search";
import SymbolAutocomplete from "../SymbolAutocomplete";
import styles from "./automation.module.css";

type HeldInfo =
  | { state: "idle" | "loading" }
  | { state: "linked-off" }
  | { state: "none" }
  | { state: "held"; quantity: number; averagePurchasePrice: number };

/**
 * 분할 자동매매 전략 빌더.
 * 기준가에서 차수별로 정한 % 만큼 떨어지면 매수하고, 각 차수는 자기 매수가에서
 * 정한 % 만큼 오르면 개별 매도합니다. 프리셋 태그로 빠르게 세팅하고, 차수별
 * 가변 퍼센트로 미세 조정합니다.
 */

type SpacingMode = "even" | "variable";
type StrategyMode = Extract<AutomationMode, "percent-grid" | "loop-grid">;

type Preset = {
  id: string;
  label: string;
  desc: string;
  mode: SpacingMode;
  count: number;
  /** even: 등간격 하락%, variable: 차수별 누적 하락% 수열 */
  drop: number | number[];
  rise: number;
};

// 벤치마크(3commas/Zignaly 등): 프리셋 카드로 빠르게 시작 → 미세조정
const PRESETS: Preset[] = [
  { id: "safe", label: "안정 분할", desc: "등간격 -1.5% · 익절 +1.5% · 5차", mode: "even", count: 5, drop: 1.5, rise: 1.5 },
  { id: "box", label: "박스권 단타", desc: "등간격 -1% · 익절 +1% · 4차", mode: "even", count: 4, drop: 1, rise: 1 },
  { id: "aggressive", label: "공격 물타기", desc: "가변 -1/3/6/10/15% · 익절 +2%", mode: "variable", count: 5, drop: [1, 3, 6, 10, 15], rise: 2 },
  { id: "longterm", label: "장기 적립", desc: "등간격 -3% · 익절 +5% · 6차", mode: "even", count: 6, drop: 3, rise: 5 },
];

const buildRungs = (preset: Preset, notional: number): GridRung[] =>
  Array.from({ length: preset.count }, (_, i) => ({
    index: i + 1,
    buyDropPct: Array.isArray(preset.drop) ? (preset.drop[i] ?? preset.drop.at(-1)!) : Number((preset.drop * (i + 1)).toFixed(2)),
    sellRisePct: preset.rise,
    notional,
  }));

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

export default function StrategyBuilderPanel() {
  const [name, setName] = useState("내 분할 전략");
  const [symbol, setSymbol] = useState("005930");
  const [market, setMarket] = useState<AutomationMarket>("KR");
  const [strategyMode, setStrategyMode] = useState<StrategyMode>("percent-grid");
  const [basePrice, setBasePrice] = useState(72000);
  const [priceAnchor, setPriceAnchor] = useState<AutomationPriceAnchor>({
    source: "manual",
    price: 72000,
    capturedAt: null,
  });
  const [notional, setNotional] = useState(300000);
  const [loopBuyDropPct, setLoopBuyDropPct] = useState(1);
  const [loopSellRisePct, setLoopSellRisePct] = useState(1);
  const [loopCooldownMinutes, setLoopCooldownMinutes] = useState(5);
  const [presetId, setPresetId] = useState("safe");
  const [rungs, setRungs] = useState<GridRung[]>(() => buildRungs(PRESETS[0], 300000));
  const [maxDaily, setMaxDaily] = useState(10);
  const [maxLossPct, setMaxLossPct] = useState(15);
  const [held, setHeld] = useState<HeldInfo>({ state: "idle" });
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nativeCcy = market === "KR" ? "원" : "$";

  const applyPreset = (preset: Preset) => {
    setStrategyMode("percent-grid");
    setPresetId(preset.id);
    setRungs(buildRungs(preset, notional));
  };

  const applyLoopPreset = () => {
    setStrategyMode("loop-grid");
    setPresetId("loop-1pct");
    setName("1% 순환매매 전략");
    setLoopBuyDropPct(1);
    setLoopSellRisePct(1);
    setLoopCooldownMinutes(5);
  };

  const updateRung = (index: number, patch: Partial<GridRung>) => {
    setStrategyMode("percent-grid");
    setPresetId("custom");
    setRungs((cur) => cur.map((r) => (r.index === index ? { ...r, ...patch } : r)));
  };

  const setNotionalAll = (value: number) => {
    setNotional(value);
    setRungs((cur) => cur.map((r) => ({ ...r, notional: value })));
  };

  const setAnchoredBasePrice = (value: number, source: AutomationPriceAnchor["source"]) => {
    setBasePrice(value);
    setPriceAnchor({
      source,
      price: value,
      capturedAt: source === "manual" ? null : new Date().toISOString(),
    });
  };

  // best-effort 현재가 + 보유 여부 불러오기 (실패 시 수동 유지)
  const loadInfo = async (sym = symbol) => {
    setError(null);
    // 현재가
    try {
      const res = await fetch(`/api/market/${encodeURIComponent(sym)}?days=30&tf=1d`, { cache: "no-store" });
      const j = (await res.json()) as { candles?: { close: number }[]; lastPrice?: number; price?: number };
      const last = j.candles?.at(-1)?.close ?? j.lastPrice ?? j.price;
      if (typeof last === "number" && last > 0) {
        setAnchoredBasePrice(Math.round(last), "market");
      }
    } catch {
      setError("현재가 조회 실패. 기준가를 직접 입력하세요.");
    }
    // 보유 여부
    setHeld({ state: "loading" });
    try {
      const res = await fetch(`/api/automation/holdings?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) {
        setHeld({ state: "linked-off" });
      } else if (!j.linked) {
        setHeld({ state: "linked-off" });
      } else if (j.held) {
        setHeld({ state: "held", quantity: j.quantity, averagePurchasePrice: j.averagePurchasePrice });
      } else {
        setHeld({ state: "none" });
      }
    } catch {
      setHeld({ state: "idle" });
    }
  };

  const onSelectSymbol = (item: SymbolSearchItem) => {
    const mk: AutomationMarket = item.market === "US" ? "US" : "KR";
    const raw = item.displaySymbol || item.symbol;
    const sym = mk === "KR" ? (raw.match(/\d{6}/)?.[0] ?? raw) : raw.toUpperCase().replace(/\.[A-Z]+$/, "");
    setSymbol(sym);
    setMarket(mk);
    setName(`${item.name} ${strategyMode === "loop-grid" ? "1% 순환매매" : "분할 전략"}`);
    void loadInfo(sym);
  };

  const preview = useMemo(
    () =>
      [...rungs].sort((a, b) => a.index - b.index).map((r) => ({
        ...r,
        buyLevel: basePrice * (1 - r.buyDropPct / 100),
        sellLevel: basePrice * (1 - r.buyDropPct / 100) * (1 + r.sellRisePct / 100),
      })),
    [rungs, basePrice],
  );

  const totalNotional = rungs.reduce((s, r) => s + r.notional, 0);
  const lowestBuy = preview.length ? preview[preview.length - 1].buyLevel : basePrice;
  const loopBuyLevel = basePrice * (1 - loopBuyDropPct / 100);
  const loopSellLevel = loopBuyLevel * (1 + loopSellRisePct / 100);
  const formErrors = useMemo(() => {
    const errors: string[] = [];
    if (!name.trim()) errors.push("전략 이름을 입력하세요.");
    if (!symbol.trim()) errors.push("종목을 선택하세요.");
    if (!Number.isFinite(basePrice) || basePrice <= 0) errors.push("기준가는 0보다 커야 합니다.");
    if (!Number.isFinite(notional) || notional <= 0) errors.push("투입 금액은 0보다 커야 합니다.");
    if (!Number.isInteger(maxDaily) || maxDaily < 1 || maxDaily > 50) errors.push("일일 매매 한도는 1~50 사이 정수여야 합니다.");
    if (!Number.isFinite(maxLossPct) || maxLossPct <= 0 || maxLossPct > 80) errors.push("추가매수 중단선은 0~80% 범위여야 합니다.");
    if (strategyMode === "loop-grid") {
      if (!Number.isFinite(loopBuyDropPct) || loopBuyDropPct <= 0 || loopBuyDropPct > maxLossPct) {
        errors.push("순환 매수 하락률은 0보다 크고 추가매수 중단선 이하여야 합니다.");
      }
      if (!Number.isFinite(loopSellRisePct) || loopSellRisePct <= 0 || loopSellRisePct > 80) {
        errors.push("순환 매도 상승률은 0~80% 범위여야 합니다.");
      }
      if (!Number.isFinite(loopCooldownMinutes) || loopCooldownMinutes < 0 || loopCooldownMinutes > 1440) {
        errors.push("쿨다운은 0~1440분 범위여야 합니다.");
      }
      return errors;
    }
    for (const rung of rungs) {
      if (!Number.isFinite(rung.buyDropPct) || rung.buyDropPct <= 0 || rung.buyDropPct > 80) {
        errors.push(`${rung.index}차 매수 하락률을 확인하세요.`);
      }
      if (!Number.isFinite(rung.sellRisePct) || rung.sellRisePct <= 0 || rung.sellRisePct > 80) {
        errors.push(`${rung.index}차 매도 상승률을 확인하세요.`);
      }
      if (!Number.isFinite(rung.notional) || rung.notional <= 0) {
        errors.push(`${rung.index}차 투입 금액을 확인하세요.`);
      }
    }
    return errors;
  }, [basePrice, loopBuyDropPct, loopCooldownMinutes, loopSellRisePct, maxDaily, maxLossPct, name, notional, rungs, strategyMode, symbol]);

  const save = async () => {
    setWorking(true);
    setError(null);
    setMessage(null);
    if (formErrors.length) {
      setError(formErrors[0] ?? "전략 설정값을 확인하세요.");
      setWorking(false);
      return;
    }
    try {
      const isLoop = strategyMode === "loop-grid";
      const response = await fetch("/api/strategy-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          symbol,
          market,
          mode: strategyMode,
          status: "draft",
          currentPrice: basePrice,
          priceAnchor: {
            ...priceAnchor,
            price: basePrice,
          },
          grid: isLoop ? undefined : { basePrice, rungs },
          loop: isLoop
            ? {
              anchorPrice: basePrice,
              buyDropPct: loopBuyDropPct,
              sellRisePct: loopSellRisePct,
              notional,
              cooldownMinutes: loopCooldownMinutes,
            }
            : undefined,
          riskLimits: {
            maxDailyBuys: maxDaily,
            maxDailySells: maxDaily,
            maxPositionValue: isLoop ? notional : totalNotional,
            maxLossPct,
            maxHoldHours: 24 * 365,
          },
          exitRules: { takeProfitPct: 0, stopLossPct: 0, rescueMode: "disable-only" },
        }),
      });
      const payload = (await response.json()) as { config?: { id: string }; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "전략 저장에 실패했습니다.");
        return;
      }
      setMessage(isLoop ? "1% 순환매매 전략을 초안으로 저장했습니다. 시뮬레이션 후 활성화할 수 있습니다." : `전략 초안을 저장했습니다 (${rungs.length}차). 시뮬레이션 후 활성화할 수 있습니다.`);
      window.dispatchEvent(new Event("strategy-configs-refresh"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>Strategy</p>
          <h2>{strategyMode === "loop-grid" ? "1% 순환매매 전략" : "분할 자동매매 전략"}</h2>
        </div>
        <span>{strategyMode === "loop-grid" ? `순환 · ${fmt(notional)}` : `${rungs.length}차 · ${fmt(totalNotional)}`}</span>
      </div>

      <p className={styles.empty}>
        {strategyMode === "loop-grid"
          ? "기준가에서 정한 %만큼 떨어지면 1회 매수하고, 매수가에서 정한 %만큼 오르면 매도합니다. 매도 후 매도가를 새 기준가로 다시 대기합니다."
          : "프리셋을 고르면 차수별 매수·매도 가격이 자동으로 잡힙니다. 떨어질 때마다 분할 매수하고, 각 차수는 자기 매수가에서 정한 % 오르면 개별 익절합니다."}
      </p>

      {/* 프리셋 태그 */}
      <div className={styles.chips}>
        <button
          type="button"
          title="기준가 -1% 매수 · 매수가 +1% 매도 · 매도 후 매도가 기준으로 반복"
          className={presetId === "loop-1pct" ? `${styles.chip} ${styles.chipActive}` : styles.chip}
          onClick={applyLoopPreset}
        >
          1% 순환
        </button>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.desc}
            className={presetId === p.id ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            onClick={() => applyPreset(p)}
          >
            {p.label}
          </button>
        ))}
        {presetId === "custom" ? <span className={styles.chip}>직접 조정됨</span> : null}
      </div>

      <SymbolAutocomplete
        label="종목 검색"
        value={symbol}
        placeholder="삼성, 구글, AAPL…"
        markets={["KOSPI", "KOSDAQ", "US"]}
        onChange={setSymbol}
        onSelect={onSelectSymbol}
      />

      {/* 보유 여부 배지 */}
      {held.state === "held" ? (
        <p className={styles.notice}>
          🟢 보유중 {fmt(held.quantity)}주 · 평단 {fmt(held.averagePurchasePrice)} —
          {" "}
          <button type="button" className={`${styles.chip} ${styles.chipInline}`} onClick={() => setAnchoredBasePrice(Math.round(held.averagePurchasePrice), "holding-average")}>
            평단을 기준가로
          </button>
        </p>
      ) : held.state === "none" ? (
        <p className={styles.empty}>⚪ 미보유 종목입니다.</p>
      ) : held.state === "loading" ? (
        <p className={styles.empty}>보유 확인 중…</p>
      ) : held.state === "linked-off" ? (
        <p className={styles.empty}>보유 확인하려면 토스 API 연동이 필요합니다.</p>
      ) : null}

      <div className={styles.formGrid}>
        <label>
          전략 이름
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          시장
          <select value={market} onChange={(e) => setMarket(e.target.value as AutomationMarket)}>
            <option value="KR">국내 주식</option>
            <option value="US">미국 주식</option>
          </select>
        </label>
        <label>
          기준가
          <input inputMode="decimal" min="1" value={basePrice} onChange={(e) => setAnchoredBasePrice(Number(e.target.value), "manual")} />
        </label>
        <label>
          {strategyMode === "loop-grid" ? `1회 매수 금액 (${nativeCcy})` : `차수당 금액 (${nativeCcy})`}
          <input inputMode="decimal" min="1" value={notional} onChange={(e) => setNotionalAll(Number(e.target.value))} />
        </label>
        {strategyMode === "loop-grid" ? (
          <>
            <label>
              매수 하락률 (%)
              <input inputMode="decimal" min="0.1" max="80" value={loopBuyDropPct} onChange={(e) => setLoopBuyDropPct(Number(e.target.value))} />
            </label>
            <label>
              매도 상승률 (%)
              <input inputMode="decimal" min="0.1" max="80" value={loopSellRisePct} onChange={(e) => setLoopSellRisePct(Number(e.target.value))} />
            </label>
            <label>
              쿨다운 (분)
              <input inputMode="numeric" min="0" max="1440" value={loopCooldownMinutes} onChange={(e) => setLoopCooldownMinutes(Math.max(0, Number(e.target.value)))} />
            </label>
          </>
        ) : null}
        <label>
          일일 매매 한도
          <input inputMode="numeric" min="1" max="50" value={maxDaily} onChange={(e) => setMaxDaily(Number(e.target.value))} />
        </label>
        <label>
          추가매수 중단선 (%)
          <input inputMode="decimal" min="0.1" max="80" value={maxLossPct} onChange={(e) => setMaxLossPct(Number(e.target.value))} />
        </label>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.buttonSecondary} onClick={() => void loadInfo()} disabled={working}>
          현재가·보유 불러오기
        </button>
      </div>

      <div className={styles.summary}>
        {strategyMode === "loop-grid" ? (
          <>
            <div><span>1회 투입</span><strong>{fmt(notional)}{nativeCcy}</strong></div>
            <div><span>매수선</span><strong>{fmt(loopBuyLevel)}</strong></div>
            <div><span>익절선</span><strong>{fmt(loopSellLevel)}</strong></div>
            <div><span>쿨다운</span><strong>{loopCooldownMinutes}분</strong></div>
          </>
        ) : (
          <>
            <div><span>총 투입</span><strong>{fmt(totalNotional)}{nativeCcy}</strong></div>
            <div><span>차수</span><strong>{rungs.length}차</strong></div>
            <div><span>최저 매수가</span><strong>{fmt(lowestBuy)}</strong></div>
            <div><span>최대 하락</span><strong>−{(((basePrice - lowestBuy) / basePrice) * 100).toFixed(1)}%</strong></div>
          </>
        )}
      </div>

      {/* 차수별 미세조정 */}
      {strategyMode === "percent-grid"
        ? preview.map((r) => (
          <div key={r.index} className={styles.rungRow}>
            <b>{r.index}차</b>
            <span>매수 {fmt(r.buyLevel)} → 익절 {fmt(r.sellLevel)}</span>
            <label>−<input inputMode="decimal" min="0.1" max="80" style={{ width: 56 }} value={r.buyDropPct} onChange={(e) => updateRung(r.index, { buyDropPct: Number(e.target.value) })} />%</label>
            <label>+<input inputMode="decimal" min="0.1" max="80" style={{ width: 48 }} value={r.sellRisePct} onChange={(e) => updateRung(r.index, { sellRisePct: Number(e.target.value) })} />%</label>
            <em>{fmt(r.notional)}</em>
          </div>
        ))
        : (
          <div className={styles.exitBox}>
            <strong>순환 상태</strong>
            <p>매수 체결 전에는 기준가 {fmt(basePrice)}에서 -{loopBuyDropPct}%를 기다리고, 매수 후에는 체결가에서 +{loopSellRisePct}% 매도를 기다립니다. 매도 성공 후 기준가는 매도가로 갱신됩니다.</p>
          </div>
        )}

      <div className={styles.actions}>
        <button type="button" className={styles.buttonPrimary} onClick={() => void save()} disabled={working || formErrors.length > 0}>
          {working ? "저장 중" : "전략 저장"}
        </button>
      </div>

      {formErrors.length ? <p className={styles.error}>{formErrors[0]}</p> : null}
      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
