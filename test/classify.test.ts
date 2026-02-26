import { describe, expect, test } from "bun:test";
import { parseClassifierResponse } from "../src/classify";

describe("parseClassifierResponse", () => {
  test("parses harness command", () => {
    expect(parseClassifierResponse('{"command":"harness","args":"codex"}')).toEqual({
      command: "harness",
      args: "codex",
    });
  });

  test("parses edit command", () => {
    expect(parseClassifierResponse('{"command":"edit","args":"on"}')).toEqual({
      command: "edit",
      args: "on",
    });
  });

  test("parses status command (no args)", () => {
    expect(parseClassifierResponse('{"command":"status"}')).toEqual({
      command: "status",
    });
  });

  test("parses setup command", () => {
    expect(parseClassifierResponse('{"command":"setup","args":"my-app"}')).toEqual({
      command: "setup",
      args: "my-app",
    });
  });

  test("parses persona command with description", () => {
    expect(parseClassifierResponse('{"command":"persona","args":"陽気な海賊"}')).toEqual({
      command: "persona",
      args: "陽気な海賊",
    });
  });

  test("parses persona clear (empty args)", () => {
    expect(parseClassifierResponse('{"command":"persona","args":""}')).toEqual({
      command: "persona",
      args: "",
    });
  });

  test("parses none command", () => {
    expect(parseClassifierResponse('{"command":"none"}')).toEqual({
      command: "none",
    });
  });

  test("extracts JSON from markdown fences", () => {
    const response = '```json\n{"command":"harness","args":"gemini"}\n```';
    expect(parseClassifierResponse(response)).toEqual({
      command: "harness",
      args: "gemini",
    });
  });

  test("extracts JSON with surrounding text", () => {
    const response = 'The result is {"command":"status"} based on the input.';
    expect(parseClassifierResponse(response)).toEqual({
      command: "status",
    });
  });

  test("returns none for empty input", () => {
    expect(parseClassifierResponse("")).toEqual({ command: "none" });
  });

  test("returns none for non-JSON input", () => {
    expect(parseClassifierResponse("I don't understand")).toEqual({ command: "none" });
  });

  test("returns none for invalid command value", () => {
    expect(parseClassifierResponse('{"command":"delete"}')).toEqual({ command: "none" });
  });

  test("returns none for missing command field", () => {
    expect(parseClassifierResponse('{"action":"harness"}')).toEqual({ command: "none" });
  });

  test("ignores non-string args", () => {
    expect(parseClassifierResponse('{"command":"harness","args":123}')).toEqual({
      command: "harness",
    });
  });

  test("returns none for brace-like text that is not valid JSON", () => {
    expect(parseClassifierResponse("the result is {not valid json}")).toEqual({ command: "none" });
  });
});
