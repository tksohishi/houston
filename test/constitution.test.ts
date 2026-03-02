import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_CONSTITUTION,
  defaultConstitutionPath,
  loadConstitutionFromPath,
  normalizeConstitutionRelativePath,
  serializeConstitution,
  userMarkdownDir,
  validateConstitution,
} from "../src/constitution";

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe("constitution path helpers", () => {
  test("normalizes valid relative slot paths", () => {
    expect(normalizeConstitutionRelativePath("./docs\\AGENTS.md")).toBe("docs/AGENTS.md");
  });

  test("rejects slot paths that escape the scope root", () => {
    expect(() => normalizeConstitutionRelativePath("../AGENTS.md")).toThrow("escapes scope root");
  });

  test("builds default constitution path from config path", () => {
    expect(defaultConstitutionPath("/tmp/houston/config.json")).toBe("/tmp/houston/constitution.json");
  });
});

describe("constitution validation", () => {
  test("loads a valid constitution file", () => {
    const dir = tempDir("houston-constitution-");
    const filePath = path.join(dir, "constitution.json");
    writeFileSync(filePath, `${serializeConstitution(DEFAULT_CONSTITUTION)}\n`, "utf8");

    const loaded = loadConstitutionFromPath(filePath);
    expect(loaded.version).toBe(1);
    expect(loaded.slots.length).toBe(DEFAULT_CONSTITUTION.slots.length);
  });

  test("rejects duplicate slot ids", () => {
    expect(() =>
      validateConstitution({
        version: 1,
        slots: [
          { id: "agents", scope: "project", path: "AGENTS.md", required: true },
          { id: "agents", scope: "project", path: "CONTEXT.md", required: false },
        ],
        limits: { maxBytesPerFile: 1024, maxTotalBytes: 4096, maxFiles: 16 },
      }),
    ).toThrow("duplicate constitution slot id");
  });

  test("builds user markdown directory from numeric user ids only", () => {
    const configPath = "/tmp/houston/config.json";
    expect(userMarkdownDir(configPath, "123456789012345678")).toBe(
      "/tmp/houston/users/123456789012345678",
    );
    expect(() => userMarkdownDir(configPath, "abc123")).toThrow("invalid user id");
  });
});
