import { spawnSync } from "node:child_process";

export type MacSigningToolCheck = {
  name: string;
  command: string;
  available: boolean;
  detail: string;
};

export type MacSigningIdentity = {
  hash: string;
  name: string;
};

export type MacSigningEnvironment = {
  platform: string;
  signingIdentity: string | null;
  notarizeRequested: boolean;
  notarytoolProfile: string | null;
  appleIdProvided: boolean;
  appleTeamIdProvided: boolean;
  appleAppPasswordProvided: boolean;
};

export type MacSigningReadinessReport = {
  ok: boolean;
  externalDistributionReady: boolean;
  status: "external-ready" | "local-test" | "unsupported";
  label: string;
  environment: MacSigningEnvironment;
  tools: MacSigningToolCheck[];
  identities: MacSigningIdentity[];
  developerIdIdentityFound: boolean;
  notaryCredentialsProvided: boolean;
  issues: string[];
  warnings: string[];
  nextSteps: string[];
};

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const commandAvailable = (command: string) => {
  const result = run("/usr/bin/which", [command]);
  return {
    available: result.status === 0,
    detail: (result.stdout || result.stderr).trim().split("\n")[0] ?? "",
  };
};

const xcrunToolAvailable = (tool: string) => {
  const result = run("xcrun", ["--find", tool]);
  return {
    available: result.status === 0,
    detail: (result.stdout || result.stderr).trim().split("\n")[0] ?? "",
  };
};

export const parseCodeSigningIdentities = (output: string): MacSigningIdentity[] =>
  output
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"$/);
      if (!match) {
        return null;
      }
      return {
        hash: match[1],
        name: match[2],
      };
    })
    .filter((identity): identity is MacSigningIdentity => Boolean(identity));

export const collectMacSigningEnvironment = (env: NodeJS.ProcessEnv = process.env): MacSigningEnvironment => ({
  platform: process.platform,
  signingIdentity: env.MACOS_CODESIGN_IDENTITY?.trim() || null,
  notarizeRequested: env.MACOS_NOTARIZE === "1",
  notarytoolProfile: env.MACOS_NOTARYTOOL_PROFILE?.trim() || null,
  appleIdProvided: Boolean(env.APPLE_ID?.trim()),
  appleTeamIdProvided: Boolean(env.APPLE_TEAM_ID?.trim()),
  appleAppPasswordProvided: Boolean(env.APPLE_APP_PASSWORD?.trim()),
});

export const assessMacSigningReadiness = ({
  environment,
  tools,
  identities,
}: {
  environment: MacSigningEnvironment;
  tools: MacSigningToolCheck[];
  identities: MacSigningIdentity[];
}): MacSigningReadinessReport => {
  const issues: string[] = [];
  const warnings: string[] = [];
  const nextSteps: string[] = [];

  if (environment.platform !== "darwin") {
    issues.push("macOS 서명/공증 점검은 macOS에서만 실행할 수 있습니다.");
    nextSteps.push("macOS 빌드 머신에서 npm run mac:signing-check를 실행하세요.");
  }

  for (const tool of tools.filter((item) => !item.available)) {
    issues.push(`필수 도구를 찾지 못했습니다: ${tool.name}`);
  }
  if (tools.some((item) => !item.available)) {
    nextSteps.push("Xcode Command Line Tools를 설치하고 xcode-select 경로를 확인하세요.");
  }

  const requestedIdentity = environment.signingIdentity;
  const developerIdIdentityFound = requestedIdentity !== null &&
    requestedIdentity.startsWith("Developer ID Application:") &&
    identities.some((identity) => identity.name === requestedIdentity);

  if (!requestedIdentity) {
    warnings.push("MACOS_CODESIGN_IDENTITY가 설정되지 않아 앱은 ad-hoc 서명으로 패키징됩니다.");
    nextSteps.push("MACOS_CODESIGN_IDENTITY=\"Developer ID Application: ...\"를 설정하세요.");
  } else if (!requestedIdentity.startsWith("Developer ID Application:")) {
    warnings.push("MACOS_CODESIGN_IDENTITY가 Developer ID Application 인증서가 아닙니다.");
    nextSteps.push("Apple Developer 계정의 Developer ID Application 인증서를 Keychain에 설치하세요.");
  } else if (!developerIdIdentityFound) {
    warnings.push("MACOS_CODESIGN_IDENTITY와 일치하는 Developer ID 인증서를 Keychain에서 찾지 못했습니다.");
    nextSteps.push("security find-identity -v -p codesigning 출력과 MACOS_CODESIGN_IDENTITY 값을 맞추세요.");
  }

  const notaryCredentialsProvided = Boolean(environment.notarytoolProfile) ||
    (environment.appleIdProvided && environment.appleTeamIdProvided && environment.appleAppPasswordProvided);

  if (!environment.notarizeRequested) {
    warnings.push("MACOS_NOTARIZE=1이 아니어서 DMG 공증과 stapling을 건너뜁니다.");
    nextSteps.push("외부 배포 전 MACOS_NOTARIZE=1을 설정하세요.");
  }
  if (!notaryCredentialsProvided) {
    warnings.push("notarytool credential이 없습니다.");
    nextSteps.push("MACOS_NOTARYTOOL_PROFILE 또는 APPLE_ID/APPLE_TEAM_ID/APPLE_APP_PASSWORD를 설정하세요.");
  }

  const localToolingReady = environment.platform === "darwin" && tools.every((tool) => tool.available);
  const externalDistributionReady = localToolingReady &&
    developerIdIdentityFound &&
    environment.notarizeRequested &&
    notaryCredentialsProvided;
  const status = environment.platform !== "darwin"
    ? "unsupported"
    : externalDistributionReady
      ? "external-ready"
      : "local-test";

  return {
    ok: localToolingReady,
    externalDistributionReady,
    status,
    label: status === "external-ready"
      ? "외부 배포 서명 준비"
      : status === "local-test"
        ? "로컬 테스트 서명 준비"
        : "macOS 서명 점검 불가",
    environment,
    tools,
    identities,
    developerIdIdentityFound,
    notaryCredentialsProvided,
    issues,
    warnings,
    nextSteps: Array.from(new Set(nextSteps)),
  };
};

const collectToolChecks = (): MacSigningToolCheck[] => {
  const commandChecks = [
    { name: "codesign", command: "codesign", result: commandAvailable("codesign") },
    { name: "security", command: "security", result: commandAvailable("security") },
    { name: "hdiutil", command: "hdiutil", result: commandAvailable("hdiutil") },
    { name: "ditto", command: "ditto", result: commandAvailable("ditto") },
    { name: "xcrun", command: "xcrun", result: commandAvailable("xcrun") },
  ];
  const xcrunChecks = [
    { name: "notarytool", command: "xcrun --find notarytool", result: xcrunToolAvailable("notarytool") },
    { name: "stapler", command: "xcrun --find stapler", result: xcrunToolAvailable("stapler") },
  ];
  return [...commandChecks, ...xcrunChecks].map((item) => ({
    name: item.name,
    command: item.command,
    available: item.result.available,
    detail: item.result.detail,
  }));
};

const collectIdentities = () => {
  const result = run("security", ["find-identity", "-v", "-p", "codesigning"]);
  if (result.status !== 0) {
    return [];
  }
  return parseCodeSigningIdentities(result.stdout);
};

export const collectMacSigningReadinessReport = (env: NodeJS.ProcessEnv = process.env): MacSigningReadinessReport => {
  const environment = collectMacSigningEnvironment(env);
  const tools = collectToolChecks();
  const identities = collectIdentities();
  return assessMacSigningReadiness({ environment, tools, identities });
};

const main = () => {
  const requireExternal = process.argv.includes("--require-external");
  const report = collectMacSigningReadinessReport();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok || (requireExternal && !report.externalDistributionReady)) {
    process.exitCode = requireExternal && report.ok ? 2 : 1;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
