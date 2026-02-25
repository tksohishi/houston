import { describe, expect, test } from "bun:test";
import path from "node:path";
import { isSubPath, resolveProjectRoute, splitDiscordMessage, stripBotMention } from "../src/index";

describe("project routing", () => {
  test("returns null for channels without prefix", () => {
    const result = resolveProjectRoute("general", "cc-", "/Users/takeshi/projects");
    expect(result).toBeNull();
  });

  test("maps prefixed channel to baseDir child", () => {
    const result = resolveProjectRoute("cc-project-alpha", "cc-", "/Users/takeshi/projects");
    expect(result).toEqual({
      slug: "project-alpha",
      projectDir: "/Users/takeshi/projects/project-alpha",
    });
  });

  test("rejects traversal that escapes baseDir", () => {
    const result = resolveProjectRoute("cc-../../etc", "cc-", "/Users/takeshi/projects");
    expect(result).toBeNull();
  });

  test("isSubPath accepts direct children and rejects parents", () => {
    expect(isSubPath("/tmp/base", "/tmp/base/a")).toBe(true);
    expect(isSubPath("/tmp/base", "/tmp/base")).toBe(true);
    expect(isSubPath("/tmp/base", "/tmp/other")).toBe(false);
    expect(isSubPath("/tmp/base", path.join("/tmp/base", "..", "outside"))).toBe(false);
  });
});

describe("discord message splitting", () => {
  test("splits by newline first when possible", () => {
    const input = "aaaaa\nbbbbb\nccccc";
    const chunks = splitDiscordMessage(input, 10);
    expect(chunks).toEqual(["aaaaa", "bbbbb", "ccccc"]);
  });

  test("falls back to spaces when newline split is not available", () => {
    const input = "alpha beta gamma delta";
    const chunks = splitDiscordMessage(input, 11);
    expect(chunks).toEqual(["alpha beta", "gamma delta"]);
  });

  test("does not split in the middle of words", () => {
    const input = "word1 word2 word3";
    const chunks = splitDiscordMessage(input, 8);
    for (const chunk of chunks) {
      expect(chunk.includes(" ")).toBe(chunk.split(" ").length > 1);
      expect(chunk).not.toContain("wo\n");
    }
    expect(chunks).toEqual(["word1", "word2", "word3"]);
  });
});

describe("mention parsing", () => {
  test("detects direct mention and returns prompt", () => {
    const parsed = stripBotMention("<@123> run tests", "123");
    expect(parsed).toEqual({
      mentioned: true,
      prompt: "run tests",
    });
  });

  test("detects nickname mention and trims prompt", () => {
    const parsed = stripBotMention("  <@!123>   hello world  ", "123");
    expect(parsed).toEqual({
      mentioned: true,
      prompt: "hello world",
    });
  });

  test("ignores non mention messages", () => {
    const parsed = stripBotMention("hello bot", "123");
    expect(parsed).toEqual({
      mentioned: false,
      prompt: "",
    });
  });

  test("requires content after mention", () => {
    const parsed = stripBotMention("<@123>   ", "123");
    expect(parsed).toEqual({
      mentioned: true,
      prompt: "",
    });
  });
});
