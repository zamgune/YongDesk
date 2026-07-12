import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const parseMacPackageVersion = (raw: string, label = "package.json") => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  const version = parsed && typeof parsed === "object" && "version" in parsed
    ? (parsed as { version?: unknown }).version
    : null;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${label} version must use semantic major.minor.patch format.`);
  }
  return version;
};

export const macMarketingVersion = (semanticVersion: string) => {
  const match = semanticVersion.match(/^(\d+\.\d+\.\d+)/);
  if (!match) throw new Error(`Invalid semantic version: ${semanticVersion}`);
  return match[1];
};

export const macReleaseChannel = (semanticVersion: string) =>
  semanticVersion.includes("-") ? semanticVersion.split("-", 2)[1]?.split(".", 1)[0] ?? "prerelease" : "stable";

export const normalizeMacNodeVersion = (value: string, label = "Node version") => {
  const normalized = value.trim();
  if (!/^v?\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`${label} must use numeric major.minor.patch format, got: ${value || "(empty)"}`);
  }
  return normalized.startsWith("v") ? normalized : `v${normalized}`;
};

export const assertMacNodeVersion = (actual: string, expected: string, label: string) => {
  const normalizedActual = normalizeMacNodeVersion(actual, label);
  const normalizedExpected = normalizeMacNodeVersion(expected, ".node-version");
  if (normalizedActual !== normalizedExpected) {
    throw new Error(`${label} mismatch. Expected ${normalizedExpected}, got ${normalizedActual}.`);
  }
  return normalizedActual;
};

export const normalizeMacBuildNumber = (value: string | undefined) => {
  const buildNumber = value?.trim() || "12002";
  if (!/^[1-9]\d*$/.test(buildNumber)) {
    throw new Error(`MACOS_BUILD_NUMBER must be a positive integer, got: ${value ?? "(unset)"}`);
  }
  return buildNumber;
};

export const readMacPackageVersion = async (repoRoot: string) =>
  parseMacPackageVersion(await readFile(join(repoRoot, "package.json"), "utf8"), "root package.json");

export const readPinnedMacNodeVersion = async (repoRoot: string) =>
  normalizeMacNodeVersion(await readFile(join(repoRoot, ".node-version"), "utf8"), ".node-version");

export const assertMacNodeVersionOverride = (value: string | undefined, pinnedVersion: string) => {
  if (!value?.trim()) {
    return;
  }
  assertMacNodeVersion(value, pinnedVersion, "MACOS_NODE_VERSION");
};
