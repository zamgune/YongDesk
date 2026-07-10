#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildCryptoBacktestDataset } from "../src/lib/crypto-buy/service.mts";
import { normalizeCryptoSymbol } from "../src/lib/crypto-buy/provider.mts";
import {
  COST_CONFIGS,
  DEFAULT_BACKTEST_CONFIG,
  type CostScenario,
  type CryptoExecutionMode,
  type CryptoParentTimeframe,
  type SignalSide,
} from "../src/lib/crypto-buy/types.mts";
import { runCryptoBacktest } from "../src/lib/crypto-buy/backtest.mts";

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL"];
const DEFAULT_START = "2024-01-01";

const args = process.argv.slice(2);

const readArg = (name: string, fallback: string) => {
  const index = args.findIndex((arg) => arg === `--${name}`);
  if (index === -1 || index + 1 >= args.length) {
    return fallback;
  }
  return args[index + 1];
};

const parseDate = (value: string, fallbackDate: number) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallbackDate;
};

const parseCostScenario = (value: string): CostScenario | null => {
  if (value === "zero" || value === "normal" || value === "conservative") {
    return value;
  }
  return null;
};

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

const csvEscape = (value: string | number | boolean) => {
  const stringified = typeof value === "string" ? value : String(value);
  if (/[",\n]/.test(stringified)) {
    return `"${stringified.replace(/"/g, "\"\"")}"`;
  }
  return stringified;
};

const toJson = (data: unknown) => JSON.stringify(data, null, 2);

const startArg = readArg("start", DEFAULT_START);
const endArg = readArg("end", new Date().toISOString().slice(0, 10));
const outDirArg = readArg("out", "");
const timeframeArg = readArg("tf", "1d").toLowerCase();
const sideArg = readArg("side", "buy").toLowerCase();
const modeArg = readArg("mode", "both").toUpperCase();
const costArg = readArg("cost", "all").toLowerCase();
const symbolsArg = readArg("symbols", DEFAULT_SYMBOLS.join(","));

const selectedModes: CryptoExecutionMode[] =
  modeArg === "A" || modeArg === "B" ? [modeArg] : ["A", "B"];
const timeframe: CryptoParentTimeframe = timeframeArg === "4h" ? "4h" : "1d";
const side: SignalSide = sideArg === "sell" ? "sell" : "buy";
const selectedCostScenario = parseCostScenario(costArg);
const selectedCosts =
  costArg === "all"
    ? Object.values(COST_CONFIGS)
    : [COST_CONFIGS[selectedCostScenario ?? "normal"]];
const symbols = symbolsArg
  .split(",")
  .map((symbol) => symbol.trim())
  .filter(Boolean);

const startTimeMs = parseDate(startArg, Date.parse(DEFAULT_START));
const endTimeMs = parseDate(endArg, Date.now()) + 24 * 60 * 60 * 1000;

const createTradeCsv = (
  results: Array<Awaited<ReturnType<typeof runCryptoBacktest>>>,
) => {
  const headers = [
    "symbol",
    "side",
    "direction",
    "timeframe",
    "mode",
    "costScenario",
    "signalTime",
    "entryTime",
    "exitTime",
    "score",
    "entryPrice",
    "stopPrice",
    "tp1Price",
    "tp2Price",
    "exitReason",
    "quantity",
    "netPnl",
    "rMultiple",
    "holdBars",
    "tp1Hit",
    "maxAdverseExcursion",
    "maxFavorableExcursion",
    "reasons",
  ];
  const rows = [headers.join(",")];

  for (const result of results) {
    for (const trade of result.trades) {
      rows.push(
        [
          trade.symbol,
          trade.side,
          trade.direction,
          trade.timeframe,
          trade.mode,
          trade.costScenario,
          trade.signalTime,
          trade.entryTime,
          trade.exitTime,
          trade.score,
          trade.entryPrice,
          trade.stopPrice,
          trade.tp1Price,
          trade.tp2Price,
          trade.exitReason,
          trade.quantity,
          trade.netPnl,
          trade.rMultiple,
          trade.holdBars,
          trade.tp1Hit,
          trade.maxAdverseExcursion,
          trade.maxFavorableExcursion,
          trade.reasons.join(" | "),
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  }

  return rows.join("\n");
};

const createSignalsCsv = (
  resultGroups: Array<{
    symbol: string;
    mode: "A" | "B";
      signals: Array<{
      symbol: string;
      side: "buy" | "sell";
      direction: "long" | "short";
      timeframe: "1d" | "4h";
      mode: "A" | "B";
      signalTime: number;
      entryTime: number;
      entryIndex: number;
      score: number;
      stopLevel: number;
      confirmPassed: boolean;
      htfPassed: boolean;
      reasons: string[];
    }>;
  }>,
) => {
  const headers = [
    "symbol",
    "side",
    "direction",
    "timeframe",
    "mode",
    "signalTime",
    "entryTime",
    "entryIndex",
    "score",
    "stopLevel",
    "confirmPassed",
    "htfPassed",
    "reasons",
  ];
  const rows = [headers.join(",")];

  for (const result of resultGroups) {
    for (const signal of result.signals) {
      rows.push(
        [
          signal.symbol,
          signal.side,
          signal.direction,
          signal.timeframe,
          signal.mode,
          signal.signalTime,
          signal.entryTime,
          signal.entryIndex,
          signal.score,
          signal.stopLevel,
          signal.confirmPassed,
          signal.htfPassed,
          signal.reasons.join(" | "),
        ]
          .map(csvEscape)
          .join(","),
      );
    }
  }

  return rows.join("\n");
};

const printTable = (
  results: Array<Awaited<ReturnType<typeof runCryptoBacktest>>>,
) => {
  const header = [
    "Symbol".padEnd(10),
    "Side".padEnd(6),
    "TF".padEnd(4),
    "Mode".padEnd(4),
    "Cost".padEnd(13),
    "Trades".padStart(6),
    "Win".padStart(9),
    "PF".padStart(8),
    "Return".padStart(10),
    "MaxDD".padStart(10),
    "AvgHold".padStart(8),
    "Skipped".padStart(8),
  ].join(" ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const result of results) {
    const { summary } = result;
    const profitFactor =
      summary.profitFactor === null
        ? "-"
        : Number.isFinite(summary.profitFactor)
          ? summary.profitFactor.toFixed(2)
          : "inf";
    console.log(
      [
        summary.symbol.padEnd(10),
        summary.side.padEnd(6),
        summary.timeframe.padEnd(4),
        summary.mode.padEnd(4),
        summary.costScenario.padEnd(13),
        String(summary.trades).padStart(6),
        percent(summary.winRate).padStart(9),
        profitFactor.padStart(8),
        percent(summary.totalReturn).padStart(10),
        percent(summary.maxDrawdown).padStart(10),
        summary.averageHoldBars.toFixed(1).padStart(8),
        String(result.skippedSignals).padStart(8),
      ].join(" "),
    );
  }
};

const writeOutputs = async (
  outDir: string,
  results: Array<Awaited<ReturnType<typeof runCryptoBacktest>>>,
  signalGroups: Parameters<typeof createSignalsCsv>[0],
) => {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outDir, "summary.json"), toJson(results)),
    writeFile(path.join(outDir, "trades.csv"), createTradeCsv(results)),
    writeFile(path.join(outDir, "signals.csv"), createSignalsCsv(signalGroups)),
  ]);
};

const main = async () => {
  const results = [];
  const signalGroups = [];

  for (const rawSymbol of symbols) {
    const symbol = normalizeCryptoSymbol(rawSymbol);
    console.log(`Loading ${symbol}...`);
    const { bars, signalsByMode } = await buildCryptoBacktestDataset({
      symbol,
      side,
      timeframe,
      startTimeMs,
      endTimeMs,
    });

    for (const mode of selectedModes) {
      signalGroups.push({
        symbol,
        mode,
        signals: signalsByMode[mode],
      });

      for (const cost of selectedCosts) {
        const result = runCryptoBacktest({
          symbol,
          side,
          timeframe,
          mode,
          bars,
          signals: signalsByMode[mode],
          cost,
          config: DEFAULT_BACKTEST_CONFIG,
        });
        results.push(result);
      }
    }
  }

  printTable(results);

  if (outDirArg) {
    await writeOutputs(path.resolve(outDirArg), results, signalGroups);
    console.log(`\nSaved outputs to ${path.resolve(outDirArg)}`);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
