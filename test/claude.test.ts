import { describe, expect, test } from "bun:test";
import {
  buildClaudeArgs,
  extractAssistantText,
  flushNdjsonState,
  isUuid,
  parseJsonLine,
  parseNdjsonChunk,
} from "../src/claude";

describe("claude argument builder", () => {
  test("defaults to dontAsk permission mode", () => {
    const args = buildClaudeArgs("hello world");
    expect(args).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "dontAsk",
      "hello world",
    ]);
  });

  test("uses dangerously-skip-permissions when flag is set", () => {
    const args = buildClaudeArgs("hello world", undefined, true);
    expect(args).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      "hello world",
    ]);
  });

  test("includes session id only when valid uuid", () => {
    const valid = "550e8400-e29b-41d4-a716-446655440000";
    const withSession = buildClaudeArgs("test", valid);
    expect(withSession).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "dontAsk",
      "--resume",
      valid,
      "test",
    ]);

    const withoutSession = buildClaudeArgs("test", "not-uuid");
    expect(withoutSession).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "dontAsk",
      "test",
    ]);
  });

  test("uuid validator accepts v4 and rejects random text", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuid("channel-id-123")).toBe(false);
  });
});

describe("stream json parsing", () => {
  test("parses valid json line", () => {
    const line = '{"type":"result","session_id":"550e8400-e29b-41d4-a716-446655440000"}';
    const parsed = parseJsonLine(line);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.event.type).toBe("result");
    }
  });

  test("reports malformed lines and handles chunk boundaries", () => {
    const state = { remaining: "" };

    const first = parseNdjsonChunk(
      state,
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hel',
    );
    expect(first.parsed).toEqual([]);
    expect(first.malformed).toEqual([]);

    const second = parseNdjsonChunk(
      state,
      'lo"}]}}\nnot-json\n{"type":"result","session_id":"550e8400-e29b-41d4-a716-446655440000"}\n',
    );

    expect(second.parsed.length).toBe(2);
    expect(second.malformed).toEqual(["not-json"]);
    expect(state.remaining).toBe("");
  });

  test("flushes trailing buffered line", () => {
    const state = { remaining: '{"type":"result","session_id":"550e8400-e29b-41d4-a716-446655440000"}' };
    const flushed = flushNdjsonState(state);
    expect(flushed.parsed.length).toBe(1);
    expect(flushed.malformed).toEqual([]);
    expect(state.remaining).toBe("");
  });

  test("flushes malformed trailing data", () => {
    const state = { remaining: "not-json" };
    const flushed = flushNdjsonState(state);
    expect(flushed.parsed).toEqual([]);
    expect(flushed.malformed).toEqual(["not-json"]);
    expect(state.remaining).toBe("");
  });
});

describe("assistant text extraction", () => {
  test("extracts and concatenates text segments", () => {
    const output = extractAssistantText({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "hello " },
          { type: "tool_use" },
          { type: "text", text: "world" },
        ],
      },
    });

    expect(output).toBe("hello world");
  });

  test("returns empty string for non assistant events", () => {
    expect(extractAssistantText({ type: "result" })).toBe("");
  });
});
