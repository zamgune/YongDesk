import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRootArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const appRoot = resolve(appRootArgument ?? join(repoRoot, "dist", "macos", "StockAnalysis.app"));
const appExecutable = join(appRoot, "Contents", "MacOS", "StockAnalysisMac");
const bundleIdentifier = "com.stockanalysis.mac";
const verifyReleaseChecksumCopy = !process.argv.includes("--installed-copy");

const run = (command: string, args: string[], options: { allowFailure?: boolean } = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }
  return { ok: result.status === 0, output };
};

const osascript = (lines: string[], options: { allowFailure?: boolean } = {}) =>
  run("osascript", lines.flatMap((line) => ["-e", line]), options);

const appleScriptString = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;

const processExists = () =>
  osascript([
    "tell application \"System Events\"",
    `  return exists (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    "end tell",
  ], { allowFailure: true }).output === "true";

const waitForWindow = () => {
  const result = osascript([
    "tell application \"System Events\"",
    "  set startedAt to current date",
    "  repeat while ((current date) - startedAt) < 20",
    `    if exists (first process whose bundle identifier is \"${bundleIdentifier}\") then`,
    `      tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    "        if exists window 1 then return \"ready\"",
    "      end tell",
    "    end if",
    "    delay 0.25",
    "  end repeat",
    "end tell",
    "error \"StockAnalysis window did not appear\"",
  ]);
  return result.output === "ready";
};

const windowContents = () =>
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    "    return entire contents of window 1",
    "  end tell",
    "end tell",
  ]).output;

const openMenuBarExtra = () => {
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    "    click menu bar item 1 of menu bar 2",
    "  end tell",
    "end tell",
  ]);
};

const closeMenuBarExtra = () => {
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    "    click menu bar item 1 of menu bar 2",
    "  end tell",
    "  delay 0.25",
    "  key code 53",
    "end tell",
  ], { allowFailure: true });
};

const menuBarExtraTexts = () =>
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    "    set output to {}",
    "    if exists window 1 then",
    "      tell group 1 of window 1",
    "        repeat with textItem in static texts",
    "          try",
    "            set end of output to (value of textItem as text)",
    "          end try",
    "        end repeat",
    "      end tell",
    "    end if",
    "    return output as text",
    "  end tell",
    "end tell",
  ]).output;

const sheetWindowScript = (body: string[]) => [
  "tell application \"System Events\"",
  `  tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
  "    set targetWindow to missing value",
  "    repeat with candidate in windows",
  "      if exists sheet 1 of candidate then",
  "        set targetWindow to candidate",
  "        exit repeat",
  "      end if",
  "    end repeat",
  "    if targetWindow is missing value then error \"StockAnalysis sheet not found\"",
  ...body,
  "  end tell",
  "end tell",
];

const sheetTexts = () =>
  osascript(sheetWindowScript([
    "    return entire contents of sheet 1 of targetWindow",
  ])).output;

const clickMenuBarExtraButton = (index: number) => {
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    `    click button ${index} of group 1 of window 1`,
    "  end tell",
    "end tell",
  ]);
};

const clickWindowButton = (index: number) => {
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    `    click button ${index} of group 1 of window 1`,
    "  end tell",
    "end tell",
  ]);
};

const typeIntoSymbolSearch = (query: string) => {
  const result = osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "    set frontmost to true",
    "    set focused of text field 1 of group 1 of window 1 to true",
    "    delay 0.15",
    "    keystroke \"a\" using command down",
    `    keystroke ${appleScriptString(query)}`,
    "    delay 0.5",
    "  end tell",
    "end tell",
  ], { allowFailure: true });
  if (!result.ok) {
    throw new Error(result.output || "Could not type into symbol search field.");
  }
};

const waitForSymbolSuggestion = (timeoutMs = 20_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const contents = windowContents();
    if (contents.includes("pop over 1 of text field 1") && contents.includes("button 1 of UI element 1 of scroll area 1")) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error("Symbol search suggestion did not appear.");
};

const openSymbolSuggestionWithRetry = (query: string, attempts = 3) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    typeIntoSymbolSearch(query);
    try {
      waitForSymbolSuggestion();
      return;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Symbol search suggestion did not appear after retry.");
};

const clickFirstSymbolSuggestion = () => {
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
    "    set frontmost to true",
    "    key code 36",
    "  end tell",
    "end tell",
  ]);
};

const waitForSymbolSearchValue = (expected: string, timeoutMs = 20_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = osascript([
      "tell application \"System Events\"",
      `  tell (first process whose bundle identifier is "${bundleIdentifier}")`,
      "    return value of text field 1 of group 1 of window 1",
      "  end tell",
      "end tell",
    ], { allowFailure: true });
    if (result.output === expected) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`Symbol search field did not become: ${expected}`);
};

const windowButtonEnabled = (index: number) =>
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    `    return enabled of button ${index} of group 1 of window 1`,
    "  end tell",
    "end tell",
  ]).output === "true";

const clickWindowScrollButton = (scrollAreaIndex: number, buttonIndex: number) => {
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    `    click button ${buttonIndex} of scroll area ${scrollAreaIndex} of group 1 of window 1`,
    "  end tell",
    "end tell",
  ]);
};

const windowScrollButtonEnabled = (scrollAreaIndex: number, buttonIndex: number) =>
  osascript([
    "tell application \"System Events\"",
    `  tell (first process whose bundle identifier is \"${bundleIdentifier}\")`,
    `    return enabled of button ${buttonIndex} of scroll area ${scrollAreaIndex} of group 1 of window 1`,
    "  end tell",
    "end tell",
  ]).output === "true";

const clickSheetButton = (index: number) => {
  osascript(sheetWindowScript([
    `    click button ${index} of group 1 of sheet 1 of targetWindow`,
  ]));
};

const clickConfirmationButton = (index: number) => {
  osascript(sheetWindowScript([
    `    click button ${index} of sheet 1 of targetWindow`,
  ]));
};

const sheetButtonEnabled = (index: number) =>
  osascript(sheetWindowScript([
    `    return enabled of button ${index} of group 1 of sheet 1 of targetWindow`,
  ])).output === "true";

const sheetTextFieldValue = (index: number) =>
  osascript(sheetWindowScript([
    `    return value of text field ${index} of group 1 of sheet 1 of targetWindow`,
  ]), { allowFailure: true }).output;

const typeIntoTossCredentialFields = (clientId: string, clientSecret: string) => {
  const result = osascript(sheetWindowScript([
    "    set frontmost to true",
    "    tell group 1 of sheet 1 of targetWindow",
    "      set focused of text field 1 to true",
    "    delay 0.15",
    "    keystroke \"a\" using command down",
    `    keystroke ${appleScriptString(clientId)}`,
    "    delay 0.15",
    "      set focused of text field 2 to true",
    "    delay 0.15",
    "    keystroke \"a\" using command down",
    `    keystroke ${appleScriptString(clientSecret)}`,
    "    delay 0.25",
    "    end tell",
  ]), { allowFailure: true });
  if (!result.ok) {
    throw new Error(result.output || "Could not type Toss credentials into sheet.");
  }
};

const clickSheetScrollButton = (index: number) => {
  osascript(sheetWindowScript([
    `    click button ${index} of scroll area 1 of group 1 of sheet 1 of targetWindow`,
  ]));
};

const clickReleaseChecksumButton = () => {
  const countOutput = osascript(sheetWindowScript([
    "    tell scroll area 1 of group 1 of sheet 1 of targetWindow",
    "      return count of buttons",
    "    end tell",
  ])).output;
  const buttonCount = Number(countOutput);
  if (!Number.isInteger(buttonCount) || buttonCount <= 0) {
    throw new Error(`Invalid release sheet button count: ${countOutput}`);
  }
  osascript(["set the clipboard to \"\""], { allowFailure: true });
  for (let index = buttonCount; index >= 1; index -= 1) {
    osascript(sheetWindowScript([
      `    click button ${index} of scroll area 1 of group 1 of sheet 1 of targetWindow`,
    ]), { allowFailure: true });
    const checksum = run("pbpaste", []).output.trim();
    if (/^[a-f0-9]{64}$/i.test(checksum)) {
      return checksum;
    }
  }
  throw new Error(`Release checksum button not found among ${buttonCount} sheet buttons.`);
};

const clickStrategySaveButton = () => {
  osascript(sheetWindowScript([
    "    click button 2 of scroll area 1 of group 1 of sheet 1 of targetWindow",
  ]));
};

const clickStrategyCardButton = (index: number) => {
  osascript(sheetWindowScript([
    "    set actionGroup to missing value",
    "    repeat with candidate in UI elements of scroll area 2 of group 1 of sheet 1 of targetWindow",
    "      try",
    "        if (count of buttons of candidate) = 6 and actionGroup is missing value then set actionGroup to candidate",
    "      end try",
    "    end repeat",
    "    if actionGroup is missing value then",
    "      repeat with candidate in UI elements of scroll area 2 of group 1 of sheet 1 of targetWindow",
    "        try",
    "          if (count of buttons of candidate) >= 5 and actionGroup is missing value then set actionGroup to candidate",
    "        end try",
    "      end repeat",
    "    end if",
    "    if actionGroup is missing value then error \"strategy action group not found\"",
    `    if ${index} > (count of buttons of actionGroup) then error "strategy action button ${index} not found"`,
    `    if enabled of button ${index} of actionGroup is false then error "strategy action button ${index} is disabled"`,
    `    click button ${index} of actionGroup`,
  ]));
};

const waitForStrategyCardButtonEnabled = (index: number, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = osascript(sheetWindowScript([
      "    set actionGroup to missing value",
      "    repeat with candidate in UI elements of scroll area 2 of group 1 of sheet 1 of targetWindow",
      "      try",
      "        if (count of buttons of candidate) = 6 and actionGroup is missing value then set actionGroup to candidate",
      "      end try",
      "    end repeat",
      "    if actionGroup is missing value then return false",
      `    if ${index} > (count of buttons of actionGroup) then return false`,
      `    return enabled of button ${index} of actionGroup`,
    ]), { allowFailure: true });
    if (result.output === "true") {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`Strategy card button ${index} did not become enabled`);
};

const waitForWindowText = (label: string, timeoutMs = 15_000) => {
  const startedAt = Date.now();
  let lastContents = "";
  while (Date.now() - startedAt < timeoutMs) {
    lastContents = windowContents();
    if (lastContents.includes(label)) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`Window text not found: ${label}\n\nLast contents:\n${lastContents.slice(0, 20_000)}`);
};

const waitForSheetText = (label: string, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  let lastContents = "";
  while (Date.now() - startedAt < timeoutMs) {
    const result = osascript(sheetWindowScript([
      "    return entire contents of sheet 1 of targetWindow",
    ]), { allowFailure: true });
    lastContents = result.output;
    if (lastContents.includes(label)) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`Sheet text not found: ${label}\n\nLast contents:\n${lastContents.slice(0, 2000)}`);
};

const waitForSheetButtonEnabled = (index: number, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = osascript(sheetWindowScript([
      `    return enabled of button ${index} of group 1 of sheet 1 of targetWindow`,
    ]), { allowFailure: true });
    if (result.output === "true") {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  const debug = osascript(sheetWindowScript([
    "    tell group 1 of sheet 1 of targetWindow",
    "      set buttonStates to {}",
    "      repeat with buttonIndex from 1 to count of buttons",
    "        try",
    "          set end of buttonStates to ((buttonIndex as text) & \":\" & (enabled of button buttonIndex as text))",
    "        end try",
    "      end repeat",
    "      set fieldValues to {}",
    "      repeat with fieldIndex from 1 to count of text fields",
    "        try",
    "          set end of fieldValues to ((fieldIndex as text) & \":\" & (value of text field fieldIndex as text))",
    "        end try",
    "      end repeat",
    "      return \"buttons=\" & (buttonStates as text) & \" fields=\" & (fieldValues as text)",
    "    end tell",
  ]), { allowFailure: true }).output;
  throw new Error(`Sheet button ${index} did not become enabled\n${debug}`);
};

const waitForMenuBarExtraText = (label: string, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  let lastContents = "";
  while (Date.now() - startedAt < timeoutMs) {
    lastContents = menuBarExtraTexts();
    if (lastContents.includes(label)) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`Menu bar extra text not found: ${label}\n\nLast contents:\n${lastContents.slice(0, 2000)}`);
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
    osascript([
      `tell application id \"${bundleIdentifier}\" to quit`,
    ], { allowFailure: true });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_500);
  }
  run("pkill", ["-x", "StockAnalysisMac"], { allowFailure: true });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  const appSupportRoot = mkdtempSync(join(tmpdir(), "stockanalysis-macos-ui-"));
  let appProcess: ChildProcess | null = spawn(appExecutable, {
    cwd: repoRoot,
    env: {
      ...process.env,
      STOCK_ANALYSIS_MAC_APP_SUPPORT_ROOT: appSupportRoot,
      STOCK_ANALYSIS_EGRESS_IP_OVERRIDE: "198.51.100.42",
      STOCK_ANALYSIS_UI_SMOKE_REJECT_TOSS_CREDENTIALS: "1",
    },
    stdio: "ignore",
  });

  try {
    waitForWindow();
    waitForWindowText("StockAnalysis Terminal");
    waitForWindowText("시장 인텔리전스");
    waitForWindowText("판단 패널");
    waitForWindowText("Sidecar 정상", 30_000);

    openSymbolSuggestionWithRetry("NVDA");
    clickFirstSymbolSuggestion();
    waitForSymbolSearchValue("엔비디아 · NVIDIA Corporation · NVDA");

    openMenuBarExtra();
    waitForMenuBarExtraText("Sidecar 정상", 20_000);
    waitForMenuBarExtraText("실거래 게이트 OFF", 20_000);
    clickMenuBarExtraButton(3);
    waitForMenuBarExtraText("news refreshed", 30_000);
    closeMenuBarExtra();
    waitForWindowText("StockAnalysis Terminal");

    clickWindowButton(11);
    waitForSheetText("코인 거래소 연결", 20_000);
    waitForSheetText("Upbit·Bithumb 연결을 점검", 20_000);
    waitForSheetText("코인 자동거래 게이트", 20_000);
    waitForSheetText("paper 자동화 전용", 20_000);
    waitForSheetText("이 두 점검 버튼은 실제 주문을 생성하지 않습니다", 20_000);
    clickSheetButton(1);

    clickWindowButton(3);
    waitForWindowText("상태 갱신 요약", 30_000);
    clickWindowButton(4);
    waitForWindowText("뉴스/RSS 갱신 요약", 30_000);
    clickWindowButton(1);
    waitForWindowText("분석 요약", 45_000);
    clickWindowButton(2);
    waitForWindowText("시장 브리핑 요약", 60_000);

    clickWindowButton(19);
    waitForWindowText("OrderIntent 계획을 플레이북에 저장했습니다", 30_000);
    clickWindowButton(20);
    waitForWindowText("전략 초안", 30_000);
    clickWindowButton(18);
    waitForWindowText("모의 주문 실행 요약", 30_000);
    clickWindowButton(21);
    waitForSheetText("모의 계좌 초기화", 20_000);
    waitForSheetText("실거래 broker 주문은 제출하지 않습니다", 20_000);
    clickConfirmationButton(1);
    waitForWindowText("모의 계좌를 초기화했습니다", 30_000);
    waitForWindowText("US $10000.00", 30_000);

    clickWindowButton(5);
    waitForSheetText("첫 실행 설정");
    waitForSheetText("Toss API 키");
    clickSheetButton(3);
    waitForSheetText("Toss API 연결", 20_000);
    waitForSheetText("등록된 Toss API 키가 없습니다.", 20_000);
    clickSheetButton(3);
    clickWindowButton(5);
    waitForSheetText("첫 실행 설정");
    clickSheetButton(4);
    waitForSheetText("자동매매 전략", 20_000);
    waitForSheetText("순환분할", 20_000);
    clickSheetButton(2);
    clickWindowButton(5);
    waitForSheetText("첫 실행 설정");
    clickSheetButton(5);
    waitForSheetText("앱 점검", 20_000);
    clickSheetButton(2);
    clickWindowButton(5);
    waitForSheetText("첫 실행 설정");
    clickSheetButton(6);
    waitForSheetText("앱 배포", 20_000);
    waitForSheetText("새 Mac 설치 후 점검", 20_000);
    clickSheetButton(1);

    clickWindowButton(14);
    waitForWindowText("주문·리스크");
    waitForWindowText("OrderIntent 감사 로그");
    clickWindowScrollButton(2, 1);
    waitForWindowText("주문·리스크 운영 리포트를 클립보드에 복사했습니다", 20_000);
    const orderRiskReport = run("pbpaste", []).output;
    if (!orderRiskReport.includes("주문·리스크 운영 리포트") || !orderRiskReport.includes("broker 주문 제출 기록이 아닙니다")) {
      throw new Error("Order risk report should include order readiness context and no-submit wording.");
    }
    clickWindowScrollButton(2, 3);
    waitForWindowText("자동화 점검 요약", 30_000);
    waitForWindowText("주문 제출 없음", 30_000);
    clickWindowScrollButton(2, 4);
    waitForWindowText("체결 동기화 요약", 30_000);
    waitForWindowText("이 동기화는 주문 제출을 수행하지 않습니다", 30_000);
    clickWindowScrollButton(2, 5);
    waitForWindowText("실계좌 보유 조회 요약", 30_000);
    waitForWindowText("Toss credential 미연동", 30_000);
    clickWindowScrollButton(2, 6);
    waitForWindowText("주문 전 사전검증 실패", 30_000);
    clickWindowScrollButton(2, 2);
    waitForWindowText("모의 주문 실행 요약", 30_000);

    clickWindowButton(15);
    waitForWindowText("뉴스·알림");
    clickWindowScrollButton(2, 1);
    waitForWindowText("뉴스·알림 갱신 요약", 30_000);

    clickWindowButton(16);
    waitForWindowText("리플레이");
    clickWindowScrollButton(2, 1);
    waitForWindowText("리플레이 갱신 요약", 30_000);

    clickWindowButton(17);
    waitForWindowText("플레이북");
    clickWindowScrollButton(2, 1);
    waitForWindowText("플레이북을 저장했습니다", 30_000);

    clickWindowButton(6);
    waitForSheetText("Toss API 연결");
    const tossTexts = sheetTexts();
    if (!tossTexts.includes("등록된 Toss API 키가 없습니다.") || !tossTexts.includes("실거래 게이트 OFF")) {
      throw new Error("Toss sheet did not expose the expected no-credential safety state.");
    }
    if (sheetTextFieldValue(1) !== "" || sheetTextFieldValue(2) !== "") {
      throw new Error("Toss credential fields should open empty in isolated UI verification storage.");
    }
    if (sheetButtonEnabled(5) || sheetButtonEnabled(6) || sheetButtonEnabled(7)) {
      throw new Error("Toss restore/save/delete buttons should be disabled before credential input.");
    }
    waitForSheetText("Toss 운영 준비", 20_000);
    typeIntoTossCredentialFields("ui-smoke-client-id", "ui-smoke-client-secret");
    waitForSheetButtonEnabled(6, 20_000);
    clickSheetButton(6);
    waitForSheetText("Toss 등록 실패: 토스 검증 실패: UI smoke credential rejection", 20_000);
    waitForSheetText("credential 필요", 20_000);
    if (sheetButtonEnabled(6) || sheetButtonEnabled(7)) {
      throw new Error("Toss save/delete buttons should return to a blocked state after rejected credentials.");
    }
    clickSheetScrollButton(1);
    waitForSheetText("IP 확인", 20_000);
    waitForSheetText("198.51.100.42", 20_000);
    clickSheetScrollButton(2);
    waitForSheetText("복사한 IP를 Toss 개발자 콘솔", 20_000);
    const copiedPublicIP = run("pbpaste", []).output;
    if (copiedPublicIP.trim() !== "198.51.100.42") {
      throw new Error("Public IP copy button should copy the checked Toss allowlist IP.");
    }
    clickSheetButton(2);
    waitForSheetText("민감정보 없는 Toss 운영 리포트를 클립보드에 복사했습니다", 20_000);
    const tossReport = run("pbpaste", []).output;
    if (!tossReport.includes("Toss") || tossReport.includes("clientSecret")) {
      throw new Error("Toss operation report should be useful and must not expose secret field names.");
    }
    clickSheetButton(4);
    waitForSheetText("등록된 Toss API 키가 없습니다.", 20_000);
    waitForSheetText("Toss 운영 준비", 20_000);
    clickSheetScrollButton(3);
    waitForSheetText("credential 필요", 20_000);
    waitForSheetText("주문 호출 없음", 20_000);
    clickSheetButton(3);

    clickWindowButton(7);
    waitForSheetText("자동매매 전략");
    waitForSheetText("순환분할");
    waitForSheetText("전략 작성");
    clickSheetButton(1);
    waitForSheetText("자동거래 전략 운영 리포트를 클립보드에 복사했습니다", 20_000);
    const strategyReport = run("pbpaste", []).output;
    if (!strategyReport.includes("전략 운영 리포트") || !strategyReport.includes("live gate")) {
      throw new Error("Strategy operation report should include strategy readiness and live gate context.");
    }
    clickStrategySaveButton();
    waitForSheetText("초안을 저장했습니다", 20_000);
    waitForSheetText("전략 관리", 20_000);
    clickSheetButton(3);
    waitForSheetText("백업 JSON을 클립보드에 복사했습니다", 20_000);
    clickSheetButton(4);
    waitForSheetText("초안으로 가져왔습니다", 20_000);
    clickStrategyCardButton(2);
    waitForSheetText("전략 tick 점검 요약", 20_000);
    waitForSheetText("시나리오: 현재 기준가", 20_000);
    waitForSheetText("실거래 게이트: 차단", 20_000);
    clickStrategyCardButton(3);
    waitForSheetText("시나리오: 다음 매수선 발동가", 20_000);
    waitForSheetText("주문 후보", 20_000);
    clickStrategyCardButton(4);
    waitForSheetText("전략 시뮬레이션을 통과했습니다", 30_000);
    waitForSheetText("실제 주문은 제출되지 않습니다", 30_000);
    waitForStrategyCardButtonEnabled(5, 20_000);
    clickStrategyCardButton(5);
    waitForSheetText("전략을 활성화했습니다", 30_000);
    waitForSheetText("1 활성", 30_000);
    waitForSheetText("실거래 제출 차단", 30_000);
    waitForSheetText("검증 완료된 Toss API 키가 없습니다.", 30_000);
    clickSheetButton(2);

    clickWindowButton(14);
    waitForWindowText("주문·리스크");
    clickWindowScrollButton(2, 7);
    waitForSheetText("자동화 1회 실행", 20_000);
    waitForSheetText("현재 실거래 게이트 OFF 상태", 20_000);
    waitForSheetText("OrderIntent, RiskCheck, Toss credential, 선택 계좌, kill switch", 20_000);
    clickConfirmationButton(2);
    waitForWindowText("자동화 1회 실행 요약", 30_000);
    waitForWindowText("상태: 실행 완료", 30_000);
    clickWindowScrollButton(2, 8);
    waitForSheetText("연속 자동 실행 시작", 20_000);
    waitForSheetText("실제 주문이 제출될 수 있으므로", 20_000);
    clickConfirmationButton(1);
    waitForWindowText("연속 자동 실행 ON", 20_000);
    clickWindowScrollButton(2, 8);
    waitForWindowText("연속 자동 실행 OFF", 20_000);

    clickWindowButton(8);
    waitForSheetText("앱 점검");
    clickSheetButton(3);
    waitForSheetText("실패 0", 20_000);
    waitForSheetButtonEnabled(1, 20_000);
    clickSheetButton(1);
    waitForSheetText("앱 점검 리포트를 클립보드에 복사했습니다", 20_000);
    const selfTestReport = run("pbpaste", []).output;
    if (!selfTestReport.includes("StockAnalysis 앱 점검 리포트") || !selfTestReport.includes("실패 0")) {
      throw new Error("Self-test report should include the app readiness summary.");
    }
    clickSheetButton(2);

    clickWindowButton(9);
    waitForSheetText("앱 배포");
    waitForSheetText("새 Mac 설치 후 점검", 20_000);
    clickSheetButton(2);
    waitForSheetText("릴리즈 아티팩트", 20_000);
    waitForSheetText("SHA-256", 20_000);
    if (verifyReleaseChecksumCopy) {
      const releaseChecksum = clickReleaseChecksumButton();
      if (!/^[a-f0-9]{64}$/i.test(releaseChecksum)) {
        throw new Error("Release checksum copy should put a SHA-256 hex digest on the clipboard.");
      }
    }
    clickSheetButton(3);
    waitForSheetText("실패 0", 30_000);
    waitForSheetButtonEnabled(4, 20_000);
    clickSheetButton(4);
    waitForSheetText("설치 점검 리포트를 클립보드에 복사했습니다", 20_000);
    clickSheetButton(1);

    clickWindowButton(10);
    waitForSheetText("Sidecar 로그");
    clickSheetButton(2);
    waitForSheetText("local-engine", 20_000);
    clickSheetButton(1);

    clickWindowButton(12);
    waitForWindowText("static text 긴급 중지", 20_000);
    if (windowButtonEnabled(18)) {
      throw new Error("Paper order button should be disabled while kill switch is engaged.");
    }
    clickWindowButton(14);
    waitForWindowText("주문·리스크");
    if (windowScrollButtonEnabled(2, 2) || windowScrollButtonEnabled(2, 7)) {
      throw new Error("Order risk paper/automation buttons should be disabled while kill switch is engaged.");
    }
    clickWindowButton(12);
    waitForWindowText("static text 실거래 게이트 OFF", 20_000);

    console.log(JSON.stringify({
      ok: true,
      appRoot,
      checks: {
        launchedWindow: true,
        sidecarVisible: true,
        koreanSymbolSearch: true,
        cryptoExchangeSheet: true,
        menuBarExtra: true,
        topCommandButtons: true,
        decisionPanelButtons: true,
        paperResetConfirmation: true,
        firstRunSetup: true,
        firstRunSetupActions: true,
        workspaceTabs: true,
        orderRiskButtons: true,
        orderRiskReportCopy: true,
        orderSyncButton: true,
        newsReplayPlaybookButtons: true,
        tossSheetNoCredentialState: true,
        publicIpCheckButton: true,
        publicIpCopyButton: true,
        tossCredentialControls: true,
        tossReadinessButton: true,
        strategyDraftCreation: true,
        strategyReportCopy: true,
        strategyBackupImport: true,
        strategyCardActions: true,
        automationRunConfirmation: true,
        continuousAutomationScheduler: true,
        selfTestSheet: true,
        selfTestReportCopy: true,
        distributionInstallReadiness: true,
        releaseChecksumCopy: verifyReleaseChecksumCopy ? true : undefined,
        sidecarLogSheet: true,
        killSwitchToggle: true,
        killSwitchButtonGuards: true,
      },
    }, null, 2));
  } finally {
    osascript([
      `tell application id \"${bundleIdentifier}\" to quit`,
    ], { allowFailure: true });
    appProcess?.kill("SIGTERM");
    appProcess = null;
    rmSync(appSupportRoot, { recursive: true, force: true });
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
