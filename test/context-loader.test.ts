import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HoustonConstitution } from "../src/constitution";
import { buildHarnessPromptWithContext, loadPromptContext } from "../src/context-loader";

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

const TEST_USER_ID = "123456789012345678";

function makeConstitution(slots: HoustonConstitution["slots"]): HoustonConstitution {
  return {
    version: 1,
    slots,
    limits: {
      maxBytesPerFile: 50_000,
      maxTotalBytes: 200_000,
      maxFiles: 16,
    },
  };
}

describe("context loading", () => {
  test("loads project and user scope files", () => {
    const root = tempDir("houston-context-");
    const configDir = path.join(root, ".config", "houston");
    const configPath = path.join(configDir, "config.json");
    const projectDir = path.join(root, "projects", "alpha");
    const userDir = path.join(configDir, "users", TEST_USER_ID);

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    writeFileSync(configPath, "{}", "utf8");
    writeFileSync(path.join(projectDir, "AGENTS.md"), "project rules", "utf8");
    writeFileSync(path.join(userDir, "CONTEXT.md"), "user context", "utf8");

    const constitution = makeConstitution([
      { id: "agents", scope: "project", path: "AGENTS.md", required: true },
      { id: "user-context", scope: "user", path: "CONTEXT.md", required: false },
    ]);

    const loaded = loadPromptContext({
      constitution,
      configPath,
      projectDir,
      userId: TEST_USER_ID,
    });

    expect(loaded.files.map((file) => file.slotId)).toEqual(["agents", "user-context"]);
    expect(loaded.totalBytes).toBeGreaterThan(0);
  });

  test("throws when required files are missing", () => {
    const root = tempDir("houston-context-");
    const configDir = path.join(root, ".config", "houston");
    const configPath = path.join(configDir, "config.json");
    const projectDir = path.join(root, "projects", "beta");

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(configPath, "{}", "utf8");

    const constitution = makeConstitution([
      { id: "agents", scope: "project", path: "AGENTS.md", required: true },
    ]);

    expect(() =>
      loadPromptContext({
        constitution,
        configPath,
        projectDir,
        userId: TEST_USER_ID,
      }),
    ).toThrow("Missing required context file for slot \"agents\"");
  });

  test("rejects slot paths that escape scope root", () => {
    const root = tempDir("houston-context-");
    const configDir = path.join(root, ".config", "houston");
    const configPath = path.join(configDir, "config.json");
    const projectDir = path.join(root, "projects", "gamma");

    mkdirSync(configDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(configPath, "{}", "utf8");

    const constitution = makeConstitution([
      { id: "escape", scope: "project", path: "../outside.md", required: false },
    ]);

    expect(() =>
      loadPromptContext({
        constitution,
        configPath,
        projectDir,
        userId: TEST_USER_ID,
      }),
    ).toThrow("escapes root");
  });
});

describe("prompt assembly", () => {
  test("returns original prompt when no context files are loaded", () => {
    expect(buildHarnessPromptWithContext("ship it", [])).toBe("ship it");
  });

  test("prepends context block before the user prompt", () => {
    const output = buildHarnessPromptWithContext("ship it", [
      {
        slotId: "agents",
        scope: "project",
        path: "/tmp/project/AGENTS.md",
        content: "be concise",
        bytes: 10,
      },
    ]);

    expect(output).toContain("[Houston Context Start]");
    expect(output).toContain("## agents (/tmp/project/AGENTS.md)");
    expect(output.endsWith("\nship it")).toBe(true);
  });
});
