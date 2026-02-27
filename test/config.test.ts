import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfigFromPath, resolvePaths, validateConfig } from "../src/config";

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe("config path resolution", () => {
  test("uses --config when provided", () => {
    const cwd = tempDir("houston-config-");
    const resolved = resolvePaths({
      argv: ["--config", "./my-config.json", "--sessions", "./my-sessions.json"],
      env: {},
      cwd,
      homeDir: "/tmp/home",
    });

    expect(resolved.configSource).toBe("argv");
    expect(resolved.configPath).toBe(path.join(cwd, "my-config.json"));
    expect(resolved.sessionsSource).toBe("argv");
    expect(resolved.sessionsPath).toBe(path.join(cwd, "my-sessions.json"));
  });

  test("uses HOUSTON_CONFIG when argument is absent", () => {
    const cwd = tempDir("houston-config-");
    const resolved = resolvePaths({
      argv: [],
      env: {
        HOUSTON_CONFIG: "~/custom/houston.json",
      },
      cwd,
      homeDir: "/Users/tester",
    });

    expect(resolved.configSource).toBe("env");
    expect(resolved.configPath).toBe("/Users/tester/custom/houston.json");
  });

  test("falls back to local config.json when xdg config is missing", () => {
    const cwd = tempDir("houston-config-");
    writeFileSync(path.join(cwd, "config.json"), "{}", "utf8");

    const resolved = resolvePaths({
      argv: [],
      env: {
        XDG_CONFIG_HOME: path.join(cwd, ".xdg-config"),
      },
      cwd,
      homeDir: "/Users/tester",
    });

    expect(resolved.configSource).toBe("local");
    expect(resolved.configPath).toBe(path.join(cwd, "config.json"));
  });

  test("uses xdg default when config file is not present yet", () => {
    const cwd = tempDir("houston-config-");
    const resolved = resolvePaths({
      argv: [],
      env: {
        XDG_CONFIG_HOME: path.join(cwd, ".cfg"),
        XDG_STATE_HOME: path.join(cwd, ".state"),
      },
      cwd,
      homeDir: "/Users/tester",
    });

    expect(resolved.configSource).toBe("xdg");
    expect(resolved.configPath).toBe(path.join(cwd, ".cfg", "houston", "config.json"));
    expect(resolved.sessionsPath).toBe(path.join(cwd, ".state", "houston", "sessions.json"));
  });
});

describe("config validation", () => {
  test("applies default harness and resolves baseDir", () => {
    const cwd = tempDir("houston-config-");
    const config = validateConfig(
      {
        token: "test-token",
        baseDir: "./projects",
      },
      cwd,
    );

    expect(config.defaultHarness).toBe("claude");
    expect(config.baseDir).toBe(path.join(cwd, "projects"));
  });

  test("accepts explicit defaultHarness", () => {
    const cwd = tempDir("houston-config-");
    const config = validateConfig(
      {
        token: "test-token",
        baseDir: "./projects",
        defaultHarness: "gemini",
      },
      cwd,
    );

    expect(config.defaultHarness).toBe("gemini");
  });

  test("falls back to claude for invalid defaultHarness", () => {
    const cwd = tempDir("houston-config-");
    const config = validateConfig(
      {
        token: "test-token",
        baseDir: "./projects",
        defaultHarness: "invalid",
      },
      cwd,
    );

    expect(config.defaultHarness).toBe("claude");
  });

  test("accepts optional geminiEditOffPolicy", () => {
    const cwd = tempDir("houston-config-");
    const config = validateConfig(
      {
        token: "test-token",
        baseDir: "./projects",
        geminiEditOffPolicy: "./policies/gemini/edit-off.toml",
      },
      cwd,
    );

    expect(config.geminiEditOffPolicy).toBe(path.join(cwd, "policies", "gemini", "edit-off.toml"));
  });

  test("throws on missing token", () => {
    expect(() =>
      validateConfig({
        baseDir: "/tmp/projects",
      }),
    ).toThrow("missing required field: token");
  });

  test("loads config from disk", () => {
    const dir = tempDir("houston-config-");
    const filePath = path.join(dir, "config.json");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({
        token: "abc",
        defaultHarness: "claude",
        baseDir: "/tmp/projects",
      }),
      "utf8",
    );

    const config = loadConfigFromPath(filePath, "/");
    expect(config.token).toBe("abc");
    expect(config.baseDir).toBe("/tmp/projects");
    expect(config.defaultHarness).toBe("claude");
  });

  test("resolves geminiEditOffPolicy relative to config file path", () => {
    const dir = tempDir("houston-config-");
    const nestedConfigDir = path.join(dir, ".config", "houston");
    const filePath = path.join(nestedConfigDir, "config.json");
    mkdirSync(nestedConfigDir, { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({
        token: "abc",
        defaultHarness: "gemini",
        baseDir: "/tmp/projects",
        geminiEditOffPolicy: "./policies/gemini/edit-off.toml",
      }),
      "utf8",
    );

    const config = loadConfigFromPath(filePath, "/tmp/unrelated-cwd");
    expect(config.geminiEditOffPolicy).toBe(path.join(nestedConfigDir, "policies", "gemini", "edit-off.toml"));
  });
});
