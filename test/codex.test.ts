import { describe, expect, test } from "bun:test";
import { codexDriver } from "../src/drivers/codex";

const withFinalOnly = (prompt: string) =>
  `${prompt}\n\nRespond with the final answer only. Do not include planning notes, progress updates, or internal reasoning.`;

describe("codex argument builder", () => {
  test("uses latest assistant text mode", () => {
    expect(codexDriver.assistantTextMode).toBe("latest");
  });

  test("off: builds read-only args with network access", () => {
    const args = codexDriver.buildArgs({ prompt: "hello world", permissionLevel: "off" });
    expect(args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-c",
      "sandbox_read_only.network_access=true",
      withFinalOnly("hello world"),
    ]);
  });

  test("edit: builds workspace-write args with network access", () => {
    const args = codexDriver.buildArgs({ prompt: "fix the bug", permissionLevel: "edit" });
    expect(args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "-c",
      "sandbox_workspace_write.network_access=true",
      withFinalOnly("fix the bug"),
    ]);
  });

  test("yolo: builds full-auto args with network access", () => {
    const args = codexDriver.buildArgs({ prompt: "fix the bug", permissionLevel: "yolo" });
    expect(args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--full-auto",
      "-c",
      "sandbox_workspace_write.network_access=true",
      withFinalOnly("fix the bug"),
    ]);
  });

  test("includes resume with session id", () => {
    const sid = "550e8400-e29b-41d4-a716-446655440000";
    const args = codexDriver.buildArgs({ prompt: "continue", sessionId: sid, permissionLevel: "off" });
    expect(args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "-c",
      "sandbox_read_only.network_access=true",
      "resume",
      sid,
      withFinalOnly("continue"),
    ]);
  });
});

describe("codex session extraction", () => {
  test("extracts thread_id from thread.started event", () => {
    const sid = codexDriver.extractSessionId({
      type: "thread.started",
      thread_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(sid).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  test("returns undefined for non thread.started events", () => {
    expect(codexDriver.extractSessionId({ type: "turn.started" })).toBeUndefined();
  });

  test("returns undefined for invalid thread_id", () => {
    expect(codexDriver.extractSessionId({ type: "thread.started", thread_id: "not-uuid" })).toBeUndefined();
  });
});

describe("codex text extraction", () => {
  test("extracts text from item.completed agent_message", () => {
    const text = codexDriver.extractAssistantText({
      type: "item.completed",
      item: { type: "agent_message", text: "Here is the result." },
    });
    expect(text).toBe("Here is the result.");
  });

  test("extracts final phase text", () => {
    const text = codexDriver.extractAssistantText({
      type: "item.completed",
      item: { type: "agent_message", phase: "final", text: "Final answer." },
    });
    expect(text).toBe("Final answer.");
  });

  test("ignores non-final phases", () => {
    const analysis = codexDriver.extractAssistantText({
      type: "item.completed",
      item: { type: "agent_message", phase: "analysis", text: "internal reasoning" },
    });
    const commentary = codexDriver.extractAssistantText({
      type: "item.completed",
      item: { type: "agent_message", phase: "commentary", text: "ongoing thoughts" },
    });

    expect(analysis).toBe("");
    expect(commentary).toBe("");
  });

  test("returns empty for non agent_message items", () => {
    const text = codexDriver.extractAssistantText({
      type: "item.completed",
      item: { type: "command_execution", command: "ls" },
    });
    expect(text).toBe("");
  });

  test("returns empty for non item.completed events", () => {
    expect(codexDriver.extractAssistantText({ type: "turn.started" })).toBe("");
  });
});

describe("codex error extraction", () => {
  test("extracts error from turn.failed", () => {
    const errors = codexDriver.extractErrors({ type: "turn.failed", message: "rate limited" });
    expect(errors).toEqual(["rate limited"]);
  });

  test("extracts error from error event", () => {
    const errors = codexDriver.extractErrors({ type: "error", message: "connection lost" });
    expect(errors).toEqual(["connection lost"]);
  });

  test("returns fallback when message is missing", () => {
    expect(codexDriver.extractErrors({ type: "turn.failed" })).toEqual(["Turn failed"]);
    expect(codexDriver.extractErrors({ type: "error" })).toEqual(["Unknown error"]);
  });

  test("returns empty for normal events", () => {
    expect(codexDriver.extractErrors({ type: "item.completed" })).toEqual([]);
  });
});

describe("codex session validation", () => {
  test("accepts valid UUIDs", () => {
    expect(codexDriver.isValidSessionId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  test("rejects non-UUIDs", () => {
    expect(codexDriver.isValidSessionId("not-a-uuid")).toBe(false);
    expect(codexDriver.isValidSessionId("latest")).toBe(false);
  });
});
