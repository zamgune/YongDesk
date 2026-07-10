import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type VerificationStep = {
  name: string;
  script: string;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const yarnCommand = process.platform === "win32" ? "yarn.cmd" : "yarn";

const deterministicSteps: VerificationStep[] = [
  { name: "ESLint", script: "lint" },
  { name: "Next.js production build", script: "build" },
  { name: "Local engine contract", script: "test:local-engine" },
  { name: "Multi-timeframe workspace contract", script: "test:market-workspace" },
  { name: "Toss client and contract", script: "test:toss" },
  { name: "Crypto exchange client", script: "test:crypto-exchanges" },
  { name: "Official candle providers", script: "test:market-candles" },
  { name: "Market analysis metadata contract", script: "test:market-analysis-contract" },
  { name: "Holding-horizon exit plans", script: "test:horizon-plans" },
  { name: "Paper automation safety", script: "test:automation" },
  { name: "Swift macOS executable build", script: "mac:build" },
  { name: "Swift core and app smoke", script: "mac:test" },
];

// mac:package:all creates the current app bundle and both release architectures.
// The following two explicit checks make the generated host app and Finder-style
// launch visible as their own readiness steps instead of relying only on nested output.
const macBundleSteps: VerificationStep[] = [
  { name: "macOS arm64/x64 package set", script: "mac:package:all" },
  { name: "Generated macOS app bundle", script: "mac:verify" },
  { name: "Finder-style macOS launch", script: "mac:verify:launch" },
];

const help = `YongStockDesk desktop readiness gate

Usage:
  node --experimental-strip-types scripts/verify_desktop_readiness.mts [--dry-run]

Options:
  --dry-run  Print the ordered verification plan without executing commands.
  --help     Show this help.

Environment:
  INCLUDE_MAC_BUNDLE=1
              After deterministic checks, build/package and verify the macOS app.
              This is intentionally disabled by default because it is expensive.

The gate runs each yarn script in order and stops at the first failure.
Credential values and authorization tokens are redacted from captured output.
`;

const sensitiveEnvironmentValues = Object.entries(process.env)
  .filter(([name, value]) => {
    if (!value || value.length < 8) return false;
    return /(?:SECRET|TOKEN|PASSWORD|PASSCODE|PRIVATE|CREDENTIAL|COOKIE|AUTH|API[_-]?KEY|ACCESS[_-]?KEY|APP[_-]?KEY|CLIENT[_-]?ID|NOTARY|TOSS|UPBIT|BITHUMB|SUPABASE|REDDIT)/i.test(name);
  })
  .map(([, value]) => value as string)
  .toSorted((left, right) => right.length - left.length);

const redact = (input: string) => {
  let output = input;
  for (const value of sensitiveEnvironmentValues) {
    output = output.split(value).join("<redacted>");
  }
  return output
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1<redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <redacted>")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<redacted-jwt>")
    .replace(
      /((?:client[_-]?(?:id|secret)|access[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|api[_-]?key|password|cookie)\s*["']?\s*[:=]\s*["']?)[^\s,"';}]+/gi,
      "$1<redacted>",
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1<redacted>@");
};

const writeSanitized = (value: string | null | undefined, target: NodeJS.WriteStream) => {
  if (!value) return;
  const sanitized = redact(value).trimEnd();
  if (sanitized) {
    target.write(`${sanitized}\n`);
  }
};

const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.round(milliseconds / 100) / 10);
  return `${seconds.toFixed(1)}s`;
};

const printSummary = ({
  status,
  passed,
  failed,
  skipped,
  durationMs,
}: {
  status: "PASS" | "FAIL" | "DRY-RUN";
  passed: number;
  failed: VerificationStep | null;
  skipped: number;
  durationMs: number;
}) => {
  process.stdout.write("\n[readiness] Final summary\n");
  process.stdout.write(`  status: ${status}\n`);
  process.stdout.write(`  passed: ${passed}\n`);
  process.stdout.write(`  failed: ${failed ? failed.script : 0}\n`);
  process.stdout.write(`  skipped: ${skipped}\n`);
  process.stdout.write(`  duration: ${formatDuration(durationMs)}\n`);
};

const parseArguments = () => {
  const arguments_ = new Set(process.argv.slice(2));
  const unknown = [...arguments_].filter((value) => !["--dry-run", "--help", "-h"].includes(value));
  if (unknown.length > 0) {
    throw new Error(`Unknown option: ${unknown.join(", ")}`);
  }
  return {
    help: arguments_.has("--help") || arguments_.has("-h"),
    dryRun: arguments_.has("--dry-run"),
  };
};

const main = () => {
  const options = parseArguments();
  if (options.help) {
    process.stdout.write(help);
    return;
  }

  const includeMacBundle = process.env.INCLUDE_MAC_BUNDLE === "1";
  const steps = includeMacBundle
    ? [...deterministicSteps, ...macBundleSteps]
    : deterministicSteps;
  const startedAt = Date.now();

  process.stdout.write(`[readiness] Repository: ${repoRoot}\n`);
  process.stdout.write(`[readiness] macOS bundle steps: ${includeMacBundle ? "included" : "skipped (set INCLUDE_MAC_BUNDLE=1)"}\n`);

  if (options.dryRun) {
    for (const [index, step] of steps.entries()) {
      process.stdout.write(`[readiness] ${index + 1}/${steps.length} yarn ${step.script} — ${step.name}\n`);
    }
    printSummary({
      status: "DRY-RUN",
      passed: 0,
      failed: null,
      skipped: includeMacBundle ? 0 : macBundleSteps.length,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  let passed = 0;
  for (const [index, step] of steps.entries()) {
    const stepStartedAt = Date.now();
    process.stdout.write(`\n[readiness] START ${index + 1}/${steps.length} yarn ${step.script} — ${step.name}\n`);
    const result = spawnSync(yarnCommand, [step.script], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        ENABLE_LIVE_TRADING: "false",
        ENABLE_CRYPTO_LIVE_TRADING: "false",
      },
      maxBuffer: 64 * 1024 * 1024,
      stdio: "pipe",
    });

    writeSanitized(result.stdout, process.stdout);
    writeSanitized(result.stderr, process.stderr);

    const succeeded = !result.error && result.status === 0;
    if (!succeeded) {
      if (result.error) {
        writeSanitized(`Unable to start yarn: ${result.error.message}`, process.stderr);
      }
      const detail = result.signal
        ? `signal ${result.signal}`
        : `exit ${result.status ?? 1}`;
      process.stderr.write(`[readiness] FAIL yarn ${step.script} (${detail}, ${formatDuration(Date.now() - stepStartedAt)})\n`);
      printSummary({
        status: "FAIL",
        passed,
        failed: step,
        skipped: steps.length - passed - 1 + (includeMacBundle ? 0 : macBundleSteps.length),
        durationMs: Date.now() - startedAt,
      });
      process.exitCode = result.status && result.status > 0 ? result.status : 1;
      return;
    }

    passed += 1;
    process.stdout.write(`[readiness] PASS yarn ${step.script} (${formatDuration(Date.now() - stepStartedAt)})\n`);
  }

  printSummary({
    status: "PASS",
    passed,
    failed: null,
    skipped: includeMacBundle ? 0 : macBundleSteps.length,
    durationMs: Date.now() - startedAt,
  });
};

try {
  main();
} catch (error) {
  writeSanitized(error instanceof Error ? error.message : String(error), process.stderr);
  process.stderr.write("\n");
  process.stderr.write(help);
  process.exitCode = 1;
}
