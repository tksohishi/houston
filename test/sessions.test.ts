import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearSession, loadSessions, saveSessions, setSession, type SessionState } from "../src/sessions";

function createTempFilePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "houston-sessions-"));
  return path.join(dir, "sessions.json");
}

describe("session persistence", () => {
  test("returns empty state when file is missing", () => {
    const filePath = createTempFilePath();
    const loaded = loadSessions(filePath);
    expect(loaded).toEqual({});
  });

  test("saves and reloads session state", () => {
    const filePath = createTempFilePath();
    const state: SessionState = {};
    setSession(state, "123", "00000000-0000-4000-8000-000000000001", "2026-02-21T00:00:00.000Z");
    saveSessions(filePath, state);

    const loaded = loadSessions(filePath);
    expect(loaded["123"]?.sessionId).toBe("00000000-0000-4000-8000-000000000001");
    expect(loaded["123"]?.lastUsed).toBe("2026-02-21T00:00:00.000Z");
  });

  test("handles malformed json by returning empty object", () => {
    const filePath = createTempFilePath();
    writeFileSync(filePath, "{not-json", "utf8");
    const loaded = loadSessions(filePath);
    expect(loaded).toEqual({});
  });

  test("clearSession removes existing session", () => {
    const filePath = createTempFilePath();
    const state = {
      abc: {
        sessionId: "00000000-0000-4000-8000-000000000001",
        lastUsed: "2026-02-21T00:00:00.000Z",
      },
    };
    saveSessions(filePath, state);

    const loaded = loadSessions(filePath);
    const removed = clearSession(loaded, "abc");
    saveSessions(filePath, loaded);

    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    expect(removed).toBe(true);
    expect(raw.abc).toBeUndefined();
  });
});
