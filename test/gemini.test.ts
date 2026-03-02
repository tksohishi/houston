import { describe, expect, test } from "bun:test";
import { geminiDriver } from "../src/drivers/gemini";

describe("gemini argument builder", () => {
  test("off: builds default args with no approval mode when no policy path is configured", () => {
    const args = geminiDriver.buildArgs({ prompt: "hello", permissionLevel: "off" });
    expect(args).toEqual(["-p", "hello", "-o", "stream-json"]);
  });

  test("off: enables yolo mode with policy when policy path is configured", () => {
    const args = geminiDriver.buildArgs({
      prompt: "run tests",
      permissionLevel: "off",
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

  test("edit: uses auto_edit approval mode", () => {
    const args = geminiDriver.buildArgs({ prompt: "fix bug", permissionLevel: "edit" });
    expect(args).toEqual(["-p", "fix bug", "-o", "stream-json", "--approval-mode", "auto_edit"]);
  });

  test("edit: ignores policy path", () => {
    const args = geminiDriver.buildArgs({
      prompt: "fix bug",
      permissionLevel: "edit",
      policyPath: "/tmp/houston/policies/gemini/edit-off.toml",
    });
    expect(args).toEqual(["-p", "fix bug", "-o", "stream-json", "--approval-mode", "auto_edit"]);
  });

  test("yolo: uses yolo approval mode", () => {
    const args = geminiDriver.buildArgs({ prompt: "fix bug", permissionLevel: "yolo" });
    expect(args).toEqual(["-p", "fix bug", "-o", "stream-json", "--approval-mode", "yolo"]);
  });

  test("includes session resume when session id is present", () => {
    const args = geminiDriver.buildArgs({
      prompt: "continue",
      permissionLevel: "off",
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

