import { describe, expect, test } from "bun:test";
import { geminiDriver } from "../src/drivers/gemini";

describe("gemini argument builder", () => {
  test("builds default args when edit mode is off and no policy path is configured", () => {
    const args = geminiDriver.buildArgs({ prompt: "hello", editMode: false });
    expect(args).toEqual(["-p", "hello", "-o", "stream-json"]);
  });

  test("enables yolo mode when edit mode is on", () => {
    const args = geminiDriver.buildArgs({ prompt: "fix bug", editMode: true });
    expect(args).toEqual(["-p", "fix bug", "-o", "stream-json", "--approval-mode", "yolo"]);
  });

  test("enables yolo mode with policy when edit mode is off and policy path is configured", () => {
    const args = geminiDriver.buildArgs({
      prompt: "run tests",
      editMode: false,
      policyPath: "/tmp/houston/policies/gemini/edit-off.toml",
    });
    expect(args).toEqual([
      "-p",
      "run tests",
      "-o",
      "stream-json",
      "--approval-mode",
      "yolo",
      "--policy",
      "/tmp/houston/policies/gemini/edit-off.toml",
    ]);
  });

  test("includes session resume when session id is present", () => {
    const args = geminiDriver.buildArgs({
      prompt: "continue",
      editMode: false,
      policyPath: "/tmp/houston/policies/gemini/edit-off.toml",
      sessionId: "latest",
    });
    expect(args).toEqual([
      "-p",
      "continue",
      "-o",
      "stream-json",
      "--approval-mode",
      "yolo",
      "--policy",
      "/tmp/houston/policies/gemini/edit-off.toml",
      "--resume",
      "latest",
    ]);
  });
});

describe("gemini session extraction", () => {
  test("extracts session id from init event", () => {
    const sid = geminiDriver.extractSessionId({
      type: "init",
      session_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(sid).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  test("returns undefined for non-init events", () => {
    expect(geminiDriver.extractSessionId({ type: "message", session_id: "x" })).toBeUndefined();
  });
});

