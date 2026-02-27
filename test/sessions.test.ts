import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearSession, loadSessions, saveSessions, setHarness, setLastResponse, setProjectDir, setSession, type SessionState } from "../src/sessions";

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

  test("writes sessions file with restricted permissions", () => {
    const filePath = createTempFilePath();
    const state: SessionState = {};
    setSession(state, "123", "00000000-0000-4000-8000-000000000001", "2026-02-21T00:00:00.000Z");
    saveSessions(filePath, state);

    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
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

describe("setProjectDir", () => {
  test("sets projectDir and clears sessionId on existing entry", () => {
    const state: SessionState = {
      ch1: { sessionId: "old-session", lastUsed: "2026-01-01T00:00:00.000Z" },
    };
    setProjectDir(state, "ch1", "/projects/my-app");
    expect(state.ch1.projectDir).toBe("/projects/my-app");
    expect(state.ch1.sessionId).toBe("");
  });

  test("creates new entry when channel is unbound", () => {
    const state: SessionState = {};
    setProjectDir(state, "ch2", "/projects/new-app");
    expect(state.ch2.projectDir).toBe("/projects/new-app");
    expect(state.ch2.sessionId).toBe("");
  });
});

describe("setHarness", () => {
  test("sets harness and clears sessionId on existing entry", () => {
    const state: SessionState = {
      ch1: { sessionId: "old-session", lastUsed: "2026-01-01T00:00:00.000Z" },
    };
    setHarness(state, "ch1", "gemini");
    expect(state.ch1.harness).toBe("gemini");
    expect(state.ch1.sessionId).toBe("");
  });

  test("creates new entry when channel is unbound", () => {
    const state: SessionState = {};
    setHarness(state, "ch2", "claude");
    expect(state.ch2.harness).toBe("claude");
    expect(state.ch2.sessionId).toBe("");
  });
});

describe("session persistence with new fields", () => {
  test("round-trips projectDir and harness through save/load", () => {
    const filePath = createTempFilePath();
    const state: SessionState = {};
    setSession(state, "ch1", "00000000-0000-4000-8000-000000000001");
    setProjectDir(state, "ch1", "/projects/test");
    setHarness(state, "ch1", "gemini");
    setLastResponse(state, "ch1", "old prompt", "old output", "2026-02-26T00:00:00.000Z");
    saveSessions(filePath, state);

    const loaded = loadSessions(filePath);
    expect(loaded.ch1?.projectDir).toBe("/projects/test");
    expect(loaded.ch1?.harness).toBe("gemini");
    expect(loaded.ch1?.lastPrompt).toBe("old prompt");
    expect(loaded.ch1?.lastOutput).toBe("old output");
    expect(loaded.ch1?.lastResponseAt).toBe("2026-02-26T00:00:00.000Z");
    // setHarness clears sessionId
    expect(loaded.ch1?.sessionId).toBe("");
  });
});

describe("resume cache behavior", () => {
  test("setProjectDir clears cached response", () => {
    const state: SessionState = {
      ch1: {
        sessionId: "sid",
        lastUsed: "2026-02-26T00:00:00.000Z",
        lastPrompt: "old prompt",
        lastOutput: "old output",
        lastResponseAt: "2026-02-26T00:00:00.000Z",
      },
    };

    setProjectDir(state, "ch1", "/projects/new");
    expect(state.ch1.lastPrompt).toBeUndefined();
    expect(state.ch1.lastOutput).toBeUndefined();
    expect(state.ch1.lastResponseAt).toBeUndefined();
  });

  test("setHarness clears cached response", () => {
    const state: SessionState = {
      ch1: {
        sessionId: "sid",
        lastUsed: "2026-02-26T00:00:00.000Z",
        lastPrompt: "old prompt",
        lastOutput: "old output",
        lastResponseAt: "2026-02-26T00:00:00.000Z",
      },
    };

    setHarness(state, "ch1", "codex");
    expect(state.ch1.lastPrompt).toBeUndefined();
    expect(state.ch1.lastOutput).toBeUndefined();
    expect(state.ch1.lastResponseAt).toBeUndefined();
  });
});
