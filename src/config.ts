import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { HarnessName } from "./harness";
import { isHarnessName } from "./drivers";

export interface HoustonConfig {
  token: string;
  defaultHarness: HarnessName;
  baseDir: string;
  geminiEditOffPolicy?: string;
}

export interface ResolvedPaths {
  configPath: string;
  sessionsPath: string;
  configSource: "argv" | "env" | "xdg" | "local";
  sessionsSource: "argv" | "env" | "xdg";
}

export interface ResolvePathOptions {
  argv?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  homeDir?: string;
}

const DEFAULT_CONFIG_RELATIVE_PATH = ".config/houston/config.json";
const DEFAULT_SESSIONS_RELATIVE_PATH = ".local/state/houston/sessions.json";
const DEFAULT_HARNESS: HarnessName = "claude";

function getArgValue(argv: string[], flag: string): string | undefined {
  const directIndex = argv.indexOf(flag);
  if (directIndex >= 0) {
    return argv[directIndex + 1];
  }

  const prefix = `${flag}=`;
  const inlineValue = argv.find((item) => item.startsWith(prefix));
  if (!inlineValue) {
    return undefined;
  }

  return inlineValue.slice(prefix.length);
}

export function expandHomePath(inputPath: string, homeDir = homedir()): string {
  if (inputPath === "~") {
    return homeDir;
  }

  if (inputPath.startsWith("~/")) {
    return path.join(homeDir, inputPath.slice(2));
  }

  return inputPath;
}

export function resolvePaths(options: ResolvePathOptions = {}): ResolvedPaths {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();

  const configArg = getArgValue(argv, "--config");
  const sessionsArg = getArgValue(argv, "--sessions");

  if (configArg) {
    return {
      configPath: path.resolve(cwd, expandHomePath(configArg, homeDir)),
      sessionsPath: resolveSessionsPath(sessionsArg, env, homeDir, cwd),
      configSource: "argv",
      sessionsSource: resolveSessionsSource(sessionsArg, env),
    };
  }

  if (env.HOUSTON_CONFIG) {
    return {
      configPath: path.resolve(cwd, expandHomePath(env.HOUSTON_CONFIG, homeDir)),
      sessionsPath: resolveSessionsPath(sessionsArg, env, homeDir, cwd),
      configSource: "env",
      sessionsSource: resolveSessionsSource(sessionsArg, env),
    };
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME
    ? expandHomePath(env.XDG_CONFIG_HOME, homeDir)
    : path.join(homeDir, ".config");
  const xdgDefaultConfigPath = path.join(xdgConfigHome, "houston", "config.json");

  if (existsSync(xdgDefaultConfigPath)) {
    return {
      configPath: xdgDefaultConfigPath,
      sessionsPath: resolveSessionsPath(sessionsArg, env, homeDir, cwd),
      configSource: "xdg",
      sessionsSource: resolveSessionsSource(sessionsArg, env),
    };
  }

  const localConfigPath = path.join(cwd, "config.json");
  if (existsSync(localConfigPath)) {
    return {
      configPath: localConfigPath,
      sessionsPath: resolveSessionsPath(sessionsArg, env, homeDir, cwd),
      configSource: "local",
      sessionsSource: resolveSessionsSource(sessionsArg, env),
    };
  }

  return {
    configPath: xdgDefaultConfigPath,
    sessionsPath: resolveSessionsPath(sessionsArg, env, homeDir, cwd),
    configSource: "xdg",
    sessionsSource: resolveSessionsSource(sessionsArg, env),
  };
}

function resolveSessionsSource(
  sessionsArg: string | undefined,
  env: Record<string, string | undefined>,
): "argv" | "env" | "xdg" {
  if (sessionsArg) {
    return "argv";
  }

  if (env.HOUSTON_SESSIONS) {
    return "env";
  }

  return "xdg";
}

function resolveSessionsPath(
  sessionsArg: string | undefined,
  env: Record<string, string | undefined>,
  homeDir: string,
  cwd: string,
): string {
  if (sessionsArg) {
    return path.resolve(cwd, expandHomePath(sessionsArg, homeDir));
  }

  if (env.HOUSTON_SESSIONS) {
    return path.resolve(cwd, expandHomePath(env.HOUSTON_SESSIONS, homeDir));
  }

  const xdgStateHome = env.XDG_STATE_HOME
    ? expandHomePath(env.XDG_STATE_HOME, homeDir)
    : path.join(homeDir, ".local", "state");
  return path.join(xdgStateHome, "houston", "sessions.json");
}

function readJsonFile(filePath: string): unknown {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function isValidHarnessName(value: unknown): value is HarnessName {
  return typeof value === "string" && isHarnessName(value);
}

export function loadConfigFromPath(configPath: string, cwd = process.cwd()): HoustonConfig {
  const parsed = readJsonFile(configPath);
  return validateConfig(parsed, cwd, path.dirname(configPath));
}

export function loadConfig(
  options: ResolvePathOptions = {},
): { config: HoustonConfig; paths: ResolvedPaths } {
  const paths = resolvePaths(options);
  const config = loadConfigFromPath(paths.configPath, options.cwd ?? process.cwd());
  return { config, paths };
}

function resolveOptionalPath(value: unknown, resolveDir: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return path.resolve(resolveDir, expandHomePath(trimmed));
}

export function validateConfig(
  value: unknown,
  cwd = process.cwd(),
  configDir = cwd,
): HoustonConfig {
  if (!value || typeof value !== "object") {
    throw new Error("config.json must contain a JSON object");
  }

  const input = value as Record<string, unknown>;
  const token = typeof input.token === "string" ? input.token.trim() : "";
  const defaultHarness = isValidHarnessName(input.defaultHarness)
    ? input.defaultHarness
    : DEFAULT_HARNESS;
  const baseDirInput = typeof input.baseDir === "string" ? input.baseDir.trim() : "";
  const geminiEditOffPolicy = resolveOptionalPath(input.geminiEditOffPolicy, configDir);
  if (!token) {
    throw new Error("config.json is missing required field: token");
  }

  if (!baseDirInput) {
    throw new Error("config.json is missing required field: baseDir");
  }

  return {
    token,
    defaultHarness,
    baseDir: path.resolve(cwd, expandHomePath(baseDirInput)),
    geminiEditOffPolicy,
  };
}

export function defaultConfigPath(env: Record<string, string | undefined> = process.env): string {
  const homeDir = homedir();
  const xdgConfigHome = env.XDG_CONFIG_HOME
    ? expandHomePath(env.XDG_CONFIG_HOME, homeDir)
    : path.join(homeDir, ".config");
  return path.join(xdgConfigHome, "houston", "config.json");
}

export function defaultSessionsPath(env: Record<string, string | undefined> = process.env): string {
  const homeDir = homedir();
  const xdgStateHome = env.XDG_STATE_HOME
    ? expandHomePath(env.XDG_STATE_HOME, homeDir)
    : path.join(homeDir, ".local", "state");
  return path.join(xdgStateHome, "houston", "sessions.json");
}

export function missingConfigErrorMessage(configPath: string): string {
  return [
    `Config file not found at: ${configPath}`,
    "Run `bun run setup` to create it.",
  ].join("\n");
}

export const defaults = {
  defaultHarness: DEFAULT_HARNESS,
  configRelativePath: DEFAULT_CONFIG_RELATIVE_PATH,
  sessionsRelativePath: DEFAULT_SESSIONS_RELATIVE_PATH,
};
