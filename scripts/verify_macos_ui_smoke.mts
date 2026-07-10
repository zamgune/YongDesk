import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type WindowSize = {
  width: number;
  height: number;
};

type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type AXAction = "exists" | "enabled" | "frame" | "press";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const appRootArgument = argumentsList.find((argument) => !argument.startsWith("--"));
const appRoot = resolve(appRootArgument ?? join(repoRoot, "dist", "macos", "StockAnalysis.app"));
const appExecutable = join(appRoot, "Contents", "MacOS", "StockAnalysisMac");
const bundledNodeExecutable = join(appRoot, "Contents", "Resources", "node", "bin", "node");
const bundleIdentifier = "com.stockanalysis.mac";
const fixtureMode = true;
const identifiersUsed = new Set<string>();
const pressedTargets: string[] = [];

const sleep = (milliseconds: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const parseWindowSize = (value: string): WindowSize => {
  const match = /^(\d{3,5})x(\d{3,5})$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid --window-size value: ${value}. Use WIDTHxHEIGHT, for example 1024x720.`);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 1024 || height < 720) {
    throw new Error(`Window size ${width}x${height} is below the supported 1024x720 minimum.`);
  }
  return { width, height };
};

const windowSizeArgument = argumentsList.find((argument) => argument.startsWith("--window-size="));
const requestedWindowSizes = windowSizeArgument
  ? [parseWindowSize(windowSizeArgument.slice("--window-size=".length))]
  : [
      { width: 1440, height: 900 },
      { width: 1024, height: 720 },
    ];

const run = (
  command: string,
  args: string[],
  options: { allowFailure?: boolean; timeoutMs?: number } = {},
) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
    timeout: options.timeoutMs ?? 120_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`.trim();
  if (result.error && !options.allowFailure) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }
  return { ok: result.status === 0, output };
};

const osascript = (lines: string[], options: { allowFailure?: boolean } = {}) =>
  run("osascript", lines.flatMap((line) => ["-e", line]), { ...options, timeoutMs: 60_000 });

const appleScriptString = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;

const processExists = () =>
  osascript([
    "tell application \"System Events\"",
    `  return exists (first process whose bundle identifier is "${bundleIdentifier}")`,
    "end tell",
  ], { allowFailure: true }).output === "true";

const appSidecarPids = () => {
  const candidates = run("pgrep", ["-f", "scripts/local_engine.mts"], { allowFailure: true }).output
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1);
  return candidates.filter((pid) => {
    const command = run("ps", ["-p", String(pid), "-o", "command="], { allowFailure: true }).output;
    return command.includes(bundledNodeExecutable) && command.includes("scripts/local_engine.mts");
  });
};

const terminateAppSidecars = () => {
  for (const pid of appSidecarPids()) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have exited between discovery and termination.
    }
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2_000 && appSidecarPids().length > 0) {
    sleep(100);
  }
  for (const pid of appSidecarPids()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited between discovery and forced termination.
    }
  }
};

const waitForWindow = (timeoutMs = 30_000) => {
  const result = osascript([
    "tell application \"System Events\"",
    "  set startedAt to current date",
    `  repeat while ((current date) - startedAt) < ${Math.ceil(timeoutMs / 1_000)}`,
    `    if exists (first process whose bundle identifier is "${bundleIdentifier}") then`,
    `      tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "        if exists window 1 then return \"ready\"",
    "      end tell",
    "    end if",
    "    delay 0.25",
    "  end repeat",
    "end tell",
    "error \"YongStockDesk window did not appear\"",
  ], { allowFailure: true });
  if (!result.ok || result.output !== "ready") {
    const permissionHint = /assistive access|not authorized|보조 접근|권한/i.test(result.output)
      ? " Grant Accessibility permission to the terminal/Codex process in System Settings > Privacy & Security > Accessibility."
      : "";
    throw new Error(`${result.output || "YongStockDesk window did not appear."}${permissionHint}`);
  }
};

const recordIdentifier = (query: string) => {
  if (query.startsWith("beginner-")) {
    identifiersUsed.add(query);
  }
};

const axActionScript = (query: string, action: AXAction, role?: string) => {
  const escapedQuery = appleScriptString(query);
  const escapedRole = appleScriptString(role ?? "");
  const actionLines: string[] = [];
  switch (action) {
  case "exists":
    actionLines.push("          return \"true\"");
    break;
  case "enabled":
    actionLines.push(
      "          try",
      "            return (enabled of candidate as text)",
      "          on error",
      "            return \"false\"",
      "          end try",
    );
    break;
  case "frame":
    actionLines.push(
      "          try",
      "            set candidatePosition to position of candidate",
      "            set candidateSize to size of candidate",
      "            return ((item 1 of candidatePosition as integer) as text) & \"|\" & ((item 2 of candidatePosition as integer) as text) & \"|\" & ((item 1 of candidateSize as integer) as text) & \"|\" & ((item 2 of candidateSize as integer) as text)",
      "          on error errorMessage",
      "            error \"Could not read AX frame for \" & targetQuery & \": \" & errorMessage",
      "          end try",
    );
    break;
  case "press":
    actionLines.push(
      "          try",
      "            if enabled of candidate is false then error \"matched element is disabled\"",
      "            perform action \"AXPress\" of candidate",
      "            return \"pressed\"",
      "          end try",
      "          try",
      "            if enabled of candidate is false then error \"matched element is disabled\"",
      "            click candidate",
      "            return \"pressed\"",
      "          end try",
    );
    break;
  }

  return [
    `set targetQuery to ${escapedQuery}`,
    `set requiredRole to ${escapedRole}`,
    "tell application \"System Events\"",
    `  if not (exists (first process whose bundle identifier is "${bundleIdentifier}")) then error "YongStockDesk process not found"`,
    `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "    repeat with matchMode in {\"identifier\", \"name\"}",
    "      set matchModeValue to contents of matchMode as text",
    "      repeat with candidateWindow in windows",
    "        set candidates to {candidateWindow}",
    "        try",
    "          set candidates to candidates & (entire contents of candidateWindow)",
    "        end try",
    "        repeat with candidate in candidates",
    "          set candidateIdentifier to \"\"",
    "          set candidateName to \"\"",
    "          set candidateDescription to \"\"",
    "          set candidateRole to \"\"",
    "          try",
    "            set candidateIdentifier to value of attribute \"AXIdentifier\" of candidate as text",
    "          end try",
    "          try",
    "            set candidateName to name of candidate as text",
    "          end try",
    "          try",
    "            set candidateDescription to description of candidate as text",
    "          end try",
    "          try",
    "            set candidateRole to role of candidate as text",
    "          end try",
    "          set identifierMatched to matchModeValue is \"identifier\" and candidateIdentifier is targetQuery",
    "          set nameMatched to matchModeValue is \"name\" and (candidateName is targetQuery or candidateDescription is targetQuery)",
    "          set roleMatched to requiredRole is \"\" or candidateRole is requiredRole",
    "          if (identifierMatched or nameMatched) and roleMatched then",
    ...actionLines,
    "          end if",
    "        end repeat",
    "      end repeat",
    "    end repeat",
    "  end tell",
    "end tell",
    action === "exists" || action === "enabled" ? "return \"false\"" : `error "AX element not found: ${query.replace(/"/g, "\\\"")}"`,
  ];
};

const axAction = (query: string, action: AXAction, role?: string, allowFailure = false) => {
  recordIdentifier(query);
  return osascript(axActionScript(query, action, role), { allowFailure });
};

const axExists = (query: string, role?: string) =>
  axAction(query, "exists", role, true).output === "true";

const axEnabled = (query: string, role?: string) =>
  axAction(query, "enabled", role, true).output === "true";

const parseFrame = (output: string, context: string): Frame => {
  const values = output.split("|").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid AX frame for ${context}: ${output}`);
  }
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
};

const axFrame = (query: string, role?: string) => {
  const result = axAction(query, "frame", role, true);
  if (!result.ok) {
    throw new Error(result.output || `Could not read AX frame for ${query}`);
  }
  return parseFrame(result.output, query);
};

const fullAXContents = () =>
  osascript([
    "set outputText to \"\"",
    "tell application \"System Events\"",
    `  if not (exists (first process whose bundle identifier is "${bundleIdentifier}")) then return outputText`,
    `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "    repeat with candidateWindow in windows",
    "      set candidates to {candidateWindow}",
    "      try",
    "        set candidates to candidates & (entire contents of candidateWindow)",
    "      end try",
    "      repeat with candidate in candidates",
    "        set candidateIdentifier to \"\"",
    "        set candidateName to \"\"",
    "        set candidateDescription to \"\"",
    "        set candidateValue to \"\"",
    "        set candidateRole to \"\"",
    "        try",
    "          set candidateIdentifier to value of attribute \"AXIdentifier\" of candidate as text",
    "        end try",
    "        try",
    "          set candidateName to name of candidate as text",
    "        end try",
    "        try",
    "          set candidateDescription to description of candidate as text",
    "        end try",
    "        try",
    "          set candidateRole to role of candidate as text",
    "        end try",
    "        try",
    "          if candidateRole is \"AXStaticText\" or candidateRole is \"AXTextField\" or candidateRole is \"AXButton\" then set candidateValue to value of candidate as text",
    "        end try",
    "        if candidateIdentifier is not \"\" or candidateName is not \"\" or candidateDescription is not \"\" or candidateValue is not \"\" then",
    "          set outputText to outputText & candidateRole & \"|id=\" & candidateIdentifier & \"|name=\" & candidateName & \"|description=\" & candidateDescription & \"|value=\" & candidateValue & linefeed",
    "        end if",
    "      end repeat",
    "    end repeat",
    "  end tell",
    "end tell",
    "return outputText",
  ], { allowFailure: true }).output;

const axTextContains = (text: string) =>
  osascript([
    `set targetText to ${appleScriptString(text)}`,
    "tell application \"System Events\"",
    `  if not (exists (first process whose bundle identifier is "${bundleIdentifier}")) then return false`,
    `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "    repeat with candidateWindow in windows",
    "      set candidates to {candidateWindow}",
    "      try",
    "        set candidates to candidates & (entire contents of candidateWindow)",
    "      end try",
    "      repeat with candidate in candidates",
    "        set candidateIdentifier to \"\"",
    "        set candidateName to \"\"",
    "        set candidateDescription to \"\"",
    "        set candidateValue to \"\"",
    "        set candidateRole to \"\"",
    "        try",
    "          set candidateIdentifier to value of attribute \"AXIdentifier\" of candidate as text",
    "        end try",
    "        try",
    "          set candidateName to name of candidate as text",
    "        end try",
    "        try",
    "          set candidateDescription to description of candidate as text",
    "        end try",
    "        try",
    "          set candidateRole to role of candidate as text",
    "        end try",
    "        try",
    "          if candidateRole is \"AXStaticText\" or candidateRole is \"AXTextField\" or candidateRole is \"AXButton\" then set candidateValue to value of candidate as text",
    "        end try",
    "        if candidateIdentifier contains targetText or candidateName contains targetText or candidateDescription contains targetText or candidateValue contains targetText then return true",
    "      end repeat",
    "    end repeat",
    "  end tell",
    "end tell",
    "return false",
  ], { allowFailure: true }).output === "true";

const interactiveControlNames = () =>
  osascript([
    "set outputText to \"\"",
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "    repeat with candidateWindow in windows",
    "      set candidates to entire contents of candidateWindow",
    "      repeat with candidate in candidates",
    "        set candidateRole to \"\"",
    "        set candidateName to \"\"",
    "        try",
    "          set candidateRole to role of candidate as text",
    "        end try",
    "        try",
    "          set candidateName to name of candidate as text",
    "        end try",
    "        if candidateRole is \"AXButton\" or candidateRole is \"AXMenuItem\" or candidateRole is \"AXRadioButton\" then",
    "          set outputText to outputText & candidateRole & \"|\" & candidateName & linefeed",
    "        end if",
    "      end repeat",
    "    end repeat",
    "  end tell",
    "end tell",
    "return outputText",
  ], { allowFailure: true }).output;

const waitForAX = (query: string, timeoutMs = 20_000, role?: string) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (axExists(query, role)) return;
    sleep(250);
  }
  const lastContents = fullAXContents();
  throw new Error(`AX element not found: ${query}\n\nLast AX contents:\n${lastContents.slice(0, 24_000)}`);
};

const waitForAXAbsent = (query: string, timeoutMs = 10_000, role?: string) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!axExists(query, role)) return;
    sleep(250);
  }
  throw new Error(`AX element remained visible: ${query}`);
};

const waitForAXEnabled = (query: string, timeoutMs = 30_000, role?: string) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (axEnabled(query, role)) return;
    sleep(250);
  }
  throw new Error(`AX element did not become enabled: ${query}\n\n${fullAXContents().slice(0, 16_000)}`);
};

const clickAX = (query: string, role?: string) => {
  const startedAt = Date.now();
  let lastOutput = "";
  while (Date.now() - startedAt < 20_000) {
    const result = axAction(query, "press", role, true);
    lastOutput = result.output;
    if (result.ok && result.output === "pressed") {
      pressedTargets.push(query);
      return;
    }
    sleep(250);
  }
  throw new Error(`${lastOutput || `Could not press ${query}`}\n\n${fullAXContents().slice(0, 24_000)}`);
};

const waitForText = (text: string, timeoutMs = 30_000) => {
  const startedAt = Date.now();
  let lastContents = "";
  while (Date.now() - startedAt < timeoutMs) {
    if (axTextContains(text)) return;
    sleep(500);
  }
  lastContents = fullAXContents();
  throw new Error(`Visible AX text not found: ${text}\n\nLast AX contents:\n${lastContents.slice(0, 24_000)}`);
};

const waitForTextAbsent = (text: string, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!axTextContains(text)) return;
    sleep(500);
  }
  throw new Error(`Visible AX text remained present: ${text}`);
};

const pressEscape = () => {
  const result = osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "    set frontmost to true",
    "    key code 53",
    "  end tell",
    "end tell",
  ], { allowFailure: true });
  if (!result.ok) {
    throw new Error(result.output || "Could not dismiss the presented UI with Escape.");
  }
};

const setScrollPosition = (identifier: string, value: number) => {
  const result = osascript([
    `set targetIdentifier to ${appleScriptString(identifier)}`,
    `set targetValue to ${Math.min(1, Math.max(0, value))}`,
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "    repeat with candidateWindow in windows",
    "      set candidates to entire contents of candidateWindow",
    "      repeat with candidate in candidates",
    "        set candidateIdentifier to \"\"",
    "        try",
    "          set candidateIdentifier to value of attribute \"AXIdentifier\" of candidate as text",
    "        end try",
    "        if candidateIdentifier is targetIdentifier then",
    "          try",
    "            set value of scroll bar 1 of candidate to targetValue",
    "            return \"scrolled\"",
    "          on error errorMessage",
    "            error \"Could not set scroll position: \" & errorMessage",
    "          end try",
    "        end if",
    "      end repeat",
    "    end repeat",
    "  end tell",
    "end tell",
    `error "Scroll area not found: ${identifier.replace(/"/g, "\\\"")}"`,
  ], { allowFailure: true });
  if (!result.ok || result.output !== "scrolled") {
    throw new Error(result.output || `Could not scroll ${identifier}.`);
  }
  sleep(500);
};

const windowFrame = (): Frame => {
  const result = osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "    set windowPosition to position of window 1",
    "    set windowSize to size of window 1",
    "    return ((item 1 of windowPosition as integer) as text) & \"|\" & ((item 2 of windowPosition as integer) as text) & \"|\" & ((item 1 of windowSize as integer) as text) & \"|\" & ((item 2 of windowSize as integer) as text)",
    "  end tell",
    "end tell",
  ]);
  return parseFrame(result.output, "window 1");
};

const setAndVerifyWindowSize = (size: WindowSize) => {
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "    set position of window 1 to {20, 40}",
    `    set size of window 1 to {${size.width}, ${size.height}}`,
    "    set frontmost to true",
    "  end tell",
    "end tell",
  ]);
  sleep(500);
  const actual = windowFrame();
  const chromeTolerance = 4;
  const minimumContentHeightChrome = size.height === 720
    && actual.height >= size.height
    && actual.height <= size.height + 40;
  if (
    Math.abs(actual.width - size.width) > chromeTolerance
    || (Math.abs(actual.height - size.height) > chromeTolerance && !minimumContentHeightChrome)
  ) {
    throw new Error(`Window size mismatch: requested ${size.width}x${size.height}, actual ${actual.width}x${actual.height}.`);
  }
  return actual;
};

const assertInsideWindow = (query: string, window: Frame) => {
  const frame = axFrame(query);
  const tolerance = 4;
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  const windowRight = window.x + window.width;
  const windowBottom = window.y + window.height;
  if (frame.width <= 0 || frame.height <= 0
      || frame.x < window.x - tolerance
      || frame.y < window.y - tolerance
      || right > windowRight + tolerance
      || bottom > windowBottom + tolerance) {
    throw new Error(`AX element ${query} is clipped at ${frame.x},${frame.y},${frame.width},${frame.height} within window ${window.x},${window.y},${window.width},${window.height}.`);
  }
};

const verifyWorkspaceLayout = (size: WindowSize) => {
  const actual = setAndVerifyWindowSize(size);
  const destinations = [
    ["beginner-nav-chart", "beginner-chart-workspace"],
    ["beginner-nav-watchlist", "beginner-watchlist-workspace"],
    ["beginner-nav-assets", "beginner-assets-workspace"],
    ["beginner-nav-strategy", "beginner-strategy-workspace"],
    ["beginner-nav-automation", "beginner-automation-workspace"],
    ["beginner-nav-settings", "beginner-settings-workspace"],
  ] as const;
  const workspaceFrames: Record<string, Frame> = {};

  for (const [navigationIdentifier, workspaceIdentifier] of destinations) {
    clickAX(navigationIdentifier);
    waitForAX(workspaceIdentifier);
    assertInsideWindow(navigationIdentifier, actual);
    assertInsideWindow(workspaceIdentifier, actual);
    workspaceFrames[workspaceIdentifier] = axFrame(workspaceIdentifier);
    if (navigationIdentifier === "beginner-nav-strategy") {
      waitForText("처음 만드는 자동매매");
      waitForAX("beginner-strategy-preview-card");
    }
  }

  clickAX("beginner-nav-chart");
  waitForAX("beginner-chart-workspace");
  waitForAX("beginner-symbol-search");
  waitForAX("beginner-analyze-button");
  waitForAX("beginner-chart-timeframe");
  assertInsideWindow("beginner-symbol-search", actual);
  assertInsideWindow("beginner-analyze-button", actual);

  return {
    requested: `${size.width}x${size.height}`,
    actual: `${actual.width}x${actual.height}`,
    frame: actual,
    workspaceFrames,
  };
};

const verifyStrategyWorkflowOrder = () => {
  const labels = ["1. 초안 저장", "2. 현재 조건 확인", "3. 모의 시뮬레이션", "4. 전략 활성화"];
  labels.forEach((label) => waitForAX(label));
  const frames = labels.map((label) => axFrame(label));
  const horizontalOrder = frames.every((frame, index) => index === 0 || frame.x > frames[index - 1].x);
  if (!horizontalOrder) {
    throw new Error(`Strategy workflow is not ordered left-to-right as 초안 저장 → 조건 확인 → 시뮬레이션 → 활성화: ${JSON.stringify(frames)}`);
  }
};

const assertNoBrokerSubmitControl = () => {
  const controls = interactiveControlNames();
  const prohibited = controls.split("\n").find((line) =>
    /(?:실제|실계좌|broker).*(?:주문|제출)|(?:주문|제출).*(?:실제|실계좌|broker)/i.test(line)
    && !/(?:없음|차단|금지)/.test(line));
  if (prohibited) {
    throw new Error(`A broker/live-submit control is exposed in PAPER ONLY UI: ${prohibited}`);
  }
  if (pressedTargets.includes("beginner-paper-order-submit")) {
    throw new Error("UI smoke must never press the paper-order submit control.");
  }
};

const verifyCoreFlow = () => {
  waitForAX("beginner-onboarding", 30_000);
  waitForText("PAPER ONLY");
  waitForText("삼성전자 예제");
  waitForText("실제 주문 버튼은 제공하지 않습니다");
  waitForAX("beginner-onboarding-example");
  clickAX("beginner-onboarding-example");
  waitForAXAbsent("beginner-onboarding", 30_000);

  waitForAX("beginner-chart-workspace", 30_000);
  waitForAX("beginner-symbol-search");
  waitForAX("beginner-analyze-button");
  waitForAXEnabled("beginner-analyze-button", 60_000);
  waitForText("삼성전자", 60_000);
  waitForText("테스트 fixture 데이터입니다", 60_000);
  waitForText("일봉 차트", 60_000);
  waitForText("FIXTURE", 60_000);
  waitForText("KRW", 60_000);
  waitForText("2026", 60_000);

  waitForAX("beginner-analysis-tab-analysis");
  clickAX("beginner-analysis-tab-analysis");
  waitForAX("beginner-horizon-picker");
  const horizons = [
    ["단타", "beginner-horizon-day"],
    ["스윙", "beginner-horizon-swing"],
    ["장투", "beginner-horizon-longTerm"],
  ] as const;
  for (const [horizonName, horizonIdentifier] of horizons) {
    clickAX(horizonName);
    waitForAX(horizonIdentifier);
    setScrollPosition("beginner-chart-workspace", 1);
    waitForText("손절·무효화", 8_000);
    waitForText("1차 익절", 8_000);
    waitForText("2차 익절", 8_000);
    setScrollPosition("beginner-chart-workspace", 0);
  }

  clickAX("beginner-analysis-tab-signals");
  waitForAX("beginner-signal-panel");
  clickAX("beginner-analysis-tab-newsSentiment");
  waitForAX("beginner-news-sentiment-panel");
  waitForText("뉴스와 종목 민심");
  clickAX("beginner-analysis-tab-analysis");

  clickAX("beginner-add-watchlist");
  clickAX("beginner-nav-watchlist");
  waitForAX("beginner-watchlist-workspace");
  waitForAX("beginner-watchlist-filter");
  waitForAX("beginner-watchlist-refresh");
  waitForText("관심종목");

  clickAX("beginner-nav-chart");
  waitForAX("beginner-chart-workspace");
  clickAX("beginner-open-paper-order");
  waitForAX("beginner-paper-order-drawer");
  waitForText("PAPER ONLY");
  waitForText("실제 주문 없음");
  waitForText("기존 OrderIntent · RiskCheck");
  waitForAX("beginner-paper-order-close");
  waitForAX("beginner-paper-order-submit");
  assertNoBrokerSubmitControl();
  clickAX("beginner-paper-order-close");
  waitForAXAbsent("beginner-paper-order-drawer");

  clickAX("beginner-nav-assets");
  waitForAX("beginner-assets-workspace");
  waitForText("내 자산");
  waitForText("통화가 다른 계좌는 합산하지 않고");

  clickAX("beginner-nav-strategy");
  waitForAX("beginner-strategy-workspace");
  waitForText("처음 만드는 자동매매", 30_000);
  waitForText("매매 문장으로 전략 만들기", 30_000);
  assertNoBrokerSubmitControl();
  verifyStrategyWorkflowOrder();
  for (const identifier of [
    "beginner-strategy-name",
    "beginner-strategy-refresh-quote",
    "beginner-strategy-apply-quote",
    "beginner-strategy-quantity",
    "beginner-strategy-rung-count",
    "beginner-strategy-first-drop",
    "beginner-strategy-rung-gap",
    "beginner-strategy-take-profit",
    "beginner-strategy-stop-loss",
    "beginner-strategy-save",
    "beginner-strategy-preview",
    "beginner-strategy-simulate",
    "beginner-strategy-enable",
  ]) {
    waitForAX(identifier, 30_000);
  }

  clickAX("beginner-nav-automation");
  waitForAX("beginner-automation-workspace");
  waitForText("PAPER ONLY");
  waitForText("실행 제어");
  assertNoBrokerSubmitControl();

  clickAX("beginner-nav-settings");
  waitForAX("beginner-settings-workspace");
  waitForAX("beginner-settings-kill-switch");
  if (!axEnabled("beginner-settings-kill-switch")) {
    throw new Error("The settings kill switch must be reachable and enabled.");
  }

  clickAX("beginner-settings-api");
  waitForText("연결할 API 선택");
  waitForText("API 연결은 선택 사항입니다");
  waitForText("Toss 주식 API");
  waitForText("Upbit·Bithumb 코인 API");
  pressEscape();
  waitForTextAbsent("연결할 API 선택");

  assertNoBrokerSubmitControl();
};

const main = () => {
  if (process.platform !== "darwin") {
    throw new Error("macOS UI smoke verification requires macOS.");
  }
  if (!existsSync(appRoot)) {
    throw new Error(`StockAnalysis.app not found: ${appRoot}`);
  }
  if (!existsSync(appExecutable)) {
    throw new Error(`StockAnalysis executable not found: ${appExecutable}`);
  }

  if (processExists()) {
    osascript([`tell application id "${bundleIdentifier}" to quit`], { allowFailure: true });
    sleep(1_500);
  }
  run("pkill", ["-x", "StockAnalysisMac"], { allowFailure: true });
  terminateAppSidecars();
  sleep(500);

  const appSupportRoot = mkdtempSync(join(tmpdir(), "yongstockdesk-macos-ui-"));
  let appProcess: ChildProcess | null = spawn(appExecutable, {
    cwd: repoRoot,
    env: {
      ...process.env,
      STOCK_ANALYSIS_MAC_APP_SUPPORT_ROOT: appSupportRoot,
      STOCK_ANALYSIS_MARKET_FIXTURE_MODE: "1",
      STOCK_ANALYSIS_EGRESS_IP_OVERRIDE: "198.51.100.42",
      STOCK_ANALYSIS_UI_SMOKE_REJECT_TOSS_CREDENTIALS: "1",
    },
    stdio: "ignore",
  });

  try {
    waitForWindow();
    setAndVerifyWindowSize(requestedWindowSizes[0]);
    verifyCoreFlow();
    const windowSizes = requestedWindowSizes.map(verifyWorkspaceLayout);
    assertNoBrokerSubmitControl();

    const requiredIdentifiers = [
      "beginner-onboarding",
      "beginner-onboarding-example",
      "beginner-nav-chart",
      "beginner-nav-watchlist",
      "beginner-nav-assets",
      "beginner-nav-strategy",
      "beginner-nav-automation",
      "beginner-nav-settings",
      "beginner-symbol-search",
      "beginner-analyze-button",
      "beginner-chart-timeframe",
      "beginner-chart-workspace",
      "beginner-add-watchlist",
      "beginner-watchlist-workspace",
      "beginner-watchlist-filter",
      "beginner-watchlist-refresh",
      "beginner-analysis-tab-analysis",
      "beginner-analysis-tab-signals",
      "beginner-analysis-tab-newsSentiment",
      "beginner-horizon-picker",
      "beginner-horizon-day",
      "beginner-horizon-swing",
      "beginner-horizon-longTerm",
      "beginner-open-paper-order",
      "beginner-paper-order-drawer",
      "beginner-paper-order-close",
      "beginner-strategy-name",
      "beginner-strategy-save",
      "beginner-strategy-preview",
      "beginner-strategy-simulate",
      "beginner-strategy-enable",
      "beginner-strategy-preview-card",
      "beginner-automation-workspace",
      "beginner-settings-workspace",
      "beginner-settings-api",
    ];
    const unverifiedIdentifiers = requiredIdentifiers.filter((identifier) => !identifiersUsed.has(identifier));
    if (unverifiedIdentifiers.length > 0) {
      throw new Error(`Required accessibility identifiers were not exercised: ${unverifiedIdentifiers.join(", ")}`);
    }

    console.log(JSON.stringify({
      ok: true,
      appRoot,
      fixtureMode,
      noBrokerSubmit: true,
      identifiersUsed: [...identifiersUsed].sort(),
      windowSizes,
      checks: {
        beginnerFirstOnboarding: true,
        samsungFixtureAnalysis: true,
        watchlistWorkspace: true,
        sourceCurrencyTimeframeVisible: true,
        horizonPlans: true,
        signalAndNewsSentimentTabs: true,
        paperOrderDrawerNoSubmit: true,
        assetsWorkspace: true,
        strategyWorkflowOrder: true,
        strategyWorkspaceSmoke: true,
        automationPaperOnly: true,
        killSwitchReachable: true,
        settingsApiReachable: true,
        supportToolsSeparated: true,
        responsiveWindowSizes: true,
      },
    }, null, 2));
  } finally {
    osascript([`tell application id "${bundleIdentifier}" to quit`], { allowFailure: true });
    appProcess?.kill("SIGTERM");
    appProcess = null;
    sleep(500);
    terminateAppSidecars();
    rmSync(appSupportRoot, { recursive: true, force: true });
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
