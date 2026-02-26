import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifiedToCommand, isSubPath, isValidProjectName, parseCommand, sanitizeChannelName, sanitizeDiscordReply, scaffoldProject, splitDiscordMessage, stripBotMention, updatePersona } from "../src/index";

describe("isSubPath", () => {
  test("accepts direct children and rejects parents", () => {
    expect(isSubPath("/tmp/base", "/tmp/base/a")).toBe(true);
    expect(isSubPath("/tmp/base", "/tmp/base")).toBe(true);
    expect(isSubPath("/tmp/base", "/tmp/other")).toBe(false);
    expect(isSubPath("/tmp/base", path.join("/tmp/base", "..", "outside"))).toBe(false);
  });
});

describe("isValidProjectName", () => {
  test("accepts valid slugs", () => {
    expect(isValidProjectName("my-project")).toBe(true);
    expect(isValidProjectName("project123")).toBe(true);
    expect(isValidProjectName("my.project")).toBe(true);
    expect(isValidProjectName("my_project")).toBe(true);
  });

  test("rejects invalid names", () => {
    expect(isValidProjectName("")).toBe(false);
    expect(isValidProjectName("My-Project")).toBe(false);
    expect(isValidProjectName("../escape")).toBe(false);
    expect(isValidProjectName("-leading")).toBe(false);
    expect(isValidProjectName(".leading")).toBe(false);
    expect(isValidProjectName("has space")).toBe(false);
    expect(isValidProjectName("a/b")).toBe(false);
  });
});

describe("sanitizeChannelName", () => {
  test("passes through already valid slugs", () => {
    expect(sanitizeChannelName("my-project")).toBe("my-project");
    expect(sanitizeChannelName("houston-test")).toBe("houston-test");
  });

  test("lowercases and replaces invalid characters", () => {
    expect(sanitizeChannelName("My-Project")).toBe("my-project");
    expect(sanitizeChannelName("hello world")).toBe("hello-world");
  });

  test("collapses consecutive hyphens and strips leading/trailing", () => {
    expect(sanitizeChannelName("--a--b--")).toBe("a-b");
  });

  test("returns null for empty or unsalvageable names", () => {
    expect(sanitizeChannelName("")).toBeNull();
    expect(sanitizeChannelName("---")).toBeNull();
    expect(sanitizeChannelName("!!!")).toBeNull();
  });
});

describe("parseCommand", () => {
  test("parses /edit on and /edit off", () => {
    expect(parseCommand("/edit on")).toEqual({ type: "edit", enabled: true });
    expect(parseCommand("/edit off")).toEqual({ type: "edit", enabled: false });
  });

  test("parses /status", () => {
    expect(parseCommand("/status")).toEqual({ type: "status" });
  });

  test("parses /resume", () => {
    expect(parseCommand("/resume")).toEqual({ type: "resume" });
  });

  test("parses /setup with project name", () => {
    expect(parseCommand("/setup my-project")).toEqual({ type: "setup", projectName: "my-project" });
    expect(parseCommand("/setup  test-app ")).toEqual({ type: "setup", projectName: "test-app" });
  });

  test("parses /harness with harness name", () => {
    expect(parseCommand("/harness claude")).toEqual({ type: "harness", harnessName: "claude" });
    expect(parseCommand("/harness gemini")).toEqual({ type: "harness", harnessName: "gemini" });
    expect(parseCommand("/harness codex")).toEqual({ type: "harness", harnessName: "codex" });
  });

  test("parses /persona with description", () => {
    expect(parseCommand("/persona a sarcastic pirate")).toEqual({ type: "persona", description: "a sarcastic pirate" });
  });

  test("parses /persona clear and bare /persona as clear", () => {
    expect(parseCommand("/persona clear")).toEqual({ type: "persona", description: "" });
    expect(parseCommand("/persona")).toEqual({ type: "persona", description: "" });
  });

  test("parses natural language harness switching", () => {
    expect(parseCommand("switch to codex")).toEqual({ type: "harness", harnessName: "codex" });
    expect(parseCommand("use gemini")).toEqual({ type: "harness", harnessName: "gemini" });
    expect(parseCommand("change harness to claude")).toEqual({ type: "harness", harnessName: "claude" });
    expect(parseCommand("set model to codex")).toEqual({ type: "harness", harnessName: "codex" });
  });

  test("does not match natural language for unknown harness names", () => {
    expect(parseCommand("switch to banana")).toBeNull();
  });

  test("returns null for unknown commands", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("/unknown")).toBeNull();
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

describe("discord reply sanitizing", () => {
  test("converts absolute paths inside base directory to relative locations", () => {
    const output = sanitizeDiscordReply(
      "Saved at /Users/alex/work/projects/my-app/src/index.ts:42",
      "/Users/alex/work/projects",
    );
    expect(output).toBe("Saved at my-app/src/index.ts:42");
  });

  test("redacts absolute paths outside base directory", () => {
    const output = sanitizeDiscordReply(
      "Read from /Users/alex/.ssh/id_rsa",
      "/Users/alex/work/projects",
    );
    expect(output).toBe("Read from <external-path>");
  });

  test("converts local markdown links to safe text with location", () => {
    const output = sanitizeDiscordReply(
      "[index.ts](/Users/alex/work/projects/my-app/src/index.ts:9)",
      "/Users/alex/work/projects",
    );
    expect(output).toBe("index.ts (`my-app/src/index.ts:9`)");
  });

  test("converts external markdown links to explicit URL text", () => {
    const output = sanitizeDiscordReply(
      "[Docs](https://example.com/path)",
      "/Users/alex/work/projects",
    );
    expect(output).toBe("Docs: https://example.com/path");
  });

  test("does not rewrite slash commands", () => {
    const output = sanitizeDiscordReply(
      "Run /setup my-project to bind this channel.",
      "/Users/alex/work/projects",
    );
    expect(output).toBe("Run /setup my-project to bind this channel.");
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

  test("detects role mention when role id is provided", () => {
    const parsed = stripBotMention("<@&456> /harness codex", "123", ["456"]);
    expect(parsed).toEqual({
      mentioned: true,
      prompt: "/harness codex",
    });
  });

  test("ignores role mention when no role ids provided", () => {
    const parsed = stripBotMention("<@&456> hello", "123");
    expect(parsed).toEqual({
      mentioned: false,
      prompt: "",
    });
  });
});

describe("scaffoldProject", () => {
  test("creates AGENTS.md with symlinks for CLAUDE.md and GEMINI.md", () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "houston-scaffold-")), "my-app");
    scaffoldProject(dir, "my-app", "my-channel");

    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(lstatSync(path.join(dir, "CLAUDE.md")).isSymbolicLink()).toBe(true);
    expect(lstatSync(path.join(dir, "GEMINI.md")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(dir, "CLAUDE.md"))).toBe("AGENTS.md");
    expect(readlinkSync(path.join(dir, "GEMINI.md"))).toBe("AGENTS.md");
  });

  test("does not overwrite existing files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "houston-scaffold-"));
    writeFileSync(path.join(dir, "CLAUDE.md"), "custom content");
    scaffoldProject(dir, "existing", "ch");

    // AGENTS.md created, but existing CLAUDE.md untouched
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    const content = readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    expect(content).toBe("custom content");
  });
});

describe("updatePersona", () => {
  test("appends persona section to existing AGENTS.md", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "houston-persona-"));
    const agentsPath = path.join(dir, "AGENTS.md");
    writeFileSync(agentsPath, "# my-project\n\nSome description.\n");

    updatePersona(agentsPath, "a sarcastic pirate");

    const content = readFileSync(agentsPath, "utf8");
    expect(content).toContain("## Persona");
    expect(content).toContain("a sarcastic pirate");
    expect(content).toContain("# my-project");
  });

  test("replaces existing persona section", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "houston-persona-"));
    const agentsPath = path.join(dir, "AGENTS.md");
    writeFileSync(agentsPath, "# my-project\n\n## Persona\n\nold persona\n");

    updatePersona(agentsPath, "a patient mentor");

    const content = readFileSync(agentsPath, "utf8");
    expect(content).toContain("a patient mentor");
    expect(content).not.toContain("old persona");
  });

  test("clears persona section", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "houston-persona-"));
    const agentsPath = path.join(dir, "AGENTS.md");
    writeFileSync(agentsPath, "# my-project\n\n## Persona\n\nold persona\n");

    updatePersona(agentsPath, "");

    const content = readFileSync(agentsPath, "utf8");
    expect(content).not.toContain("## Persona");
    expect(content).not.toContain("old persona");
    expect(content).toContain("# my-project");
  });

  test("creates file if missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "houston-persona-"));
    const agentsPath = path.join(dir, "AGENTS.md");

    updatePersona(agentsPath, "a friendly bot");

    const content = readFileSync(agentsPath, "utf8");
    expect(content).toContain("## Persona");
    expect(content).toContain("a friendly bot");
  });
});

describe("classifiedToCommand", () => {
  test("converts harness classification", () => {
    expect(classifiedToCommand({ command: "harness", args: "codex" })).toEqual({
      type: "harness",
      harnessName: "codex",
    });
  });

  test("converts edit on/off", () => {
    expect(classifiedToCommand({ command: "edit", args: "on" })).toEqual({ type: "edit", enabled: true });
    expect(classifiedToCommand({ command: "edit", args: "off" })).toEqual({ type: "edit", enabled: false });
  });

  test("converts status", () => {
    expect(classifiedToCommand({ command: "status" })).toEqual({ type: "status" });
  });

  test("converts setup", () => {
    expect(classifiedToCommand({ command: "setup", args: "my-app" })).toEqual({
      type: "setup",
      projectName: "my-app",
    });
  });

  test("converts persona with description", () => {
    expect(classifiedToCommand({ command: "persona", args: "a pirate" })).toEqual({
      type: "persona",
      description: "a pirate",
    });
  });

  test("converts persona clear", () => {
    expect(classifiedToCommand({ command: "persona", args: "" })).toEqual({
      type: "persona",
      description: "",
    });
  });

  test("returns null for harness without args", () => {
    expect(classifiedToCommand({ command: "harness" })).toBeNull();
  });

  test("returns null for edit without args", () => {
    expect(classifiedToCommand({ command: "edit" })).toBeNull();
  });

  test("returns null for setup without args", () => {
    expect(classifiedToCommand({ command: "setup" })).toBeNull();
  });

  test("returns null for none command", () => {
    expect(classifiedToCommand({ command: "none" })).toBeNull();
  });
});
