import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyEmptyMentionHelpRule,
  buildEmptyMentionHelp,
  classifiedToCommand,
  isMisleadingLinkLabel,
  isSubPath,
  isValidProjectName,
  parseCommand,
  parsePersonaRequest,
  resetPersonaProfiles,
  sanitizeChannelName,
  sanitizeDiscordReply,
  scaffoldProject,
  splitDiscordMessage,
  stripBotMention,
  updatePersona,
} from "../src/index";

describe("yolo prefix parsing", () => {
  const YOLO_REGEX = /^\/yolo\s+(.+)$/s;

  test("matches /yolo with a prompt", () => {
    const match = "/yolo list files".match(YOLO_REGEX);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("list files");
  });

  test("matches /yolo with multiline prompt", () => {
    const match = "/yolo line one\nline two".match(YOLO_REGEX);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("line one\nline two");
  });

  test("does not match bare /yolo without prompt", () => {
    expect("/yolo".match(YOLO_REGEX)).toBeNull();
    expect("/yolo ".match(YOLO_REGEX)).toBeNull();
  });

  test("does not match /yolo embedded in text", () => {
    expect("please /yolo something".match(YOLO_REGEX)).toBeNull();
  });

  test("captures prompt after first whitespace char", () => {
    const match = "/yolo   run npm test".match(YOLO_REGEX);
    expect(match![1]).toBe("run npm test");
  });
});

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

  test("parses /cancel", () => {
    expect(parseCommand("/cancel")).toEqual({ type: "cancel" });
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

  test("parses /icon and /icon clear", () => {
    expect(parseCommand("/icon")).toEqual({ type: "icon", clear: false });
    expect(parseCommand("/icon clear")).toEqual({ type: "icon", clear: true });
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

  test("does not match /yolo (handled separately before parseCommand)", () => {
    expect(parseCommand("/yolo list files")).toBeNull();
    expect(parseCommand("/yolo")).toBeNull();
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

  test("preserves markdown links with HTTP URLs when the label is plain text", () => {
    const output = sanitizeDiscordReply(
      "[Docs](https://example.com/path)",
      "/Users/alex/work/projects",
    );
    expect(output).toBe("[Docs](https://example.com/path)");
  });

  test("unwraps markdown link when label looks like a different domain", () => {
    const output = sanitizeDiscordReply(
      "[google.com](https://evil.example.com/phish)",
      "/Users/alex/work/projects",
    );
    expect(output).toBe("`google.com`: https://evil.example.com/phish");
  });

  test("collapses markdown link when label domain matches target", () => {
    const output = sanitizeDiscordReply(
      "[example.com](https://example.com/page)",
      "/Users/alex/work/projects",
    );
    expect(output).toBe("https://example.com/page");
  });

  test("converts h4 headings to bold text", () => {
    const output = sanitizeDiscordReply(
      "#### Summary\nSome content\n#### Details",
      "/Users/alex/work/projects",
    );
    expect(output).toBe("**Summary**\nSome content\n**Details**");
  });

  test("does not rewrite slash commands", () => {
    const output = sanitizeDiscordReply(
      "Run /setup my-project to bind this channel.",
      "/Users/alex/work/projects",
    );
    expect(output).toBe("Run /setup my-project to bind this channel.");
  });
});

describe("isMisleadingLinkLabel", () => {
  test("plain text label is not misleading", () => {
    expect(isMisleadingLinkLabel("Afuri Ramen", "https://maps.google.com/place")).toBe(false);
  });

  test("label with matching domain is not misleading", () => {
    expect(isMisleadingLinkLabel("example.com", "https://example.com/page")).toBe(false);
  });

  test("label subdomain of target is not misleading", () => {
    expect(isMisleadingLinkLabel("google.com", "https://maps.google.com/place")).toBe(false);
  });

  test("label with different domain is misleading", () => {
    expect(isMisleadingLinkLabel("google.com", "https://evil.com/phish")).toBe(true);
  });

  test("label with full URL pointing to different domain is misleading", () => {
    expect(isMisleadingLinkLabel("https://google.com", "https://evil.com")).toBe(true);
  });

  test("single word without TLD is not misleading", () => {
    expect(isMisleadingLinkLabel("Docs", "https://evil.com")).toBe(false);
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

describe("empty mention help rule", () => {
  test("shows help for first empty direct mention", () => {
    expect(applyEmptyMentionHelpRule(false, true, "")).toEqual({ showHelp: true, nextShown: true });
  });

  test("suppresses help for consecutive empty direct mentions", () => {
    expect(applyEmptyMentionHelpRule(true, true, "")).toEqual({ showHelp: false, nextShown: true });
  });

  test("resets help suppression after non empty prompt", () => {
    expect(applyEmptyMentionHelpRule(true, true, "/status")).toEqual({ showHelp: false, nextShown: false });
    expect(applyEmptyMentionHelpRule(true, false, "hello")).toEqual({ showHelp: false, nextShown: false });
  });

  test("keeps state when message is unrelated and empty", () => {
    expect(applyEmptyMentionHelpRule(true, false, "")).toEqual({ showHelp: false, nextShown: true });
  });
});

describe("empty mention help message", () => {
  test("customizes message for unbound channels", () => {
    const output = buildEmptyMentionHelp("Houston", false, "my-channel");
    expect(output).toContain("not set up yet");
    expect(output).toContain("/setup my-channel");
  });

  test("returns command summary for bound channels", () => {
    const output = buildEmptyMentionHelp("Houston", true, null);
    expect(output).toContain("Commands:");
    expect(output).toContain("/status");
    expect(output).toContain("/cancel");
    expect(output).toContain("/icon clear");
  });
});

describe("scaffoldProject", () => {
  test("creates default workspace markdown files with symlinks for CLAUDE.md and GEMINI.md", () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "houston-scaffold-")), "my-app");
    scaffoldProject(dir, "my-app", "my-channel");

    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(dir, "PERSONA.LANG.md"))).toBe(true);
    expect(existsSync(path.join(dir, "CONTEXT.md"))).toBe(true);
    expect(existsSync(path.join(dir, "SKILLS.md"))).toBe(true);
    expect(lstatSync(path.join(dir, "CLAUDE.md")).isSymbolicLink()).toBe(true);
    expect(lstatSync(path.join(dir, "GEMINI.md")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(dir, "CLAUDE.md"))).toBe("AGENTS.md");
    expect(readlinkSync(path.join(dir, "GEMINI.md"))).toBe("AGENTS.md");
  });

  test("copies markdown defaults from app-level defaults directory when provided", () => {
    const root = mkdtempSync(path.join(tmpdir(), "houston-scaffold-"));
    const dir = path.join(root, "my-app");
    const defaultsDir = path.join(root, "workspace-defaults");
    mkdirSync(defaultsDir, { recursive: true });
    writeFileSync(path.join(defaultsDir, "AGENTS.md"), "# custom agents\n");
    writeFileSync(path.join(defaultsDir, "PERSONA.LANG.md"), "# custom persona\n");
    writeFileSync(path.join(defaultsDir, "CONTEXT.md"), "# custom context\n");
    writeFileSync(path.join(defaultsDir, "SKILLS.md"), "# custom skills\n");

    scaffoldProject(dir, "my-app", "my-channel", defaultsDir);

    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe("# custom agents\n");
    expect(readFileSync(path.join(dir, "PERSONA.LANG.md"), "utf8")).toBe("# custom persona\n");
    expect(readFileSync(path.join(dir, "CONTEXT.md"), "utf8")).toBe("# custom context\n");
    expect(readFileSync(path.join(dir, "SKILLS.md"), "utf8")).toBe("# custom skills\n");
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
  test("creates persona profiles file with EN section when missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "houston-persona-"));
    const personaPath = path.join(dir, "PERSONA.LANG.md");

    updatePersona(personaPath, "a sarcastic pirate");

    const content = readFileSync(personaPath, "utf8");
    expect(content).toContain("# Persona Profiles");
    expect(content).toContain("## EN");
    expect(content).toContain("a sarcastic pirate");
  });

  test("replaces existing section for the same language", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "houston-persona-"));
    const personaPath = path.join(dir, "PERSONA.LANG.md");
    writeFileSync(personaPath, "# Persona Profiles\n\n## EN\n\nold persona\n");

    updatePersona(personaPath, "a patient mentor", "en");

    const content = readFileSync(personaPath, "utf8");
    expect(content).toContain("a patient mentor");
    expect(content).not.toContain("old persona");
  });

  test("appends a new section for a different language", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "houston-persona-"));
    const personaPath = path.join(dir, "PERSONA.LANG.md");
    writeFileSync(personaPath, "# Persona Profiles\n\n## EN\n\nold persona\n");

    updatePersona(personaPath, "concise japanese", "ja");

    const content = readFileSync(personaPath, "utf8");
    expect(content).toContain("## EN");
    expect(content).toContain("old persona");
    expect(content).toContain("## JA");
    expect(content).toContain("concise japanese");
  });

  test("resetPersonaProfiles restores defaults", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "houston-persona-"));
    const personaPath = path.join(dir, "PERSONA.LANG.md");
    writeFileSync(personaPath, "# Persona Profiles\n\n## EN\n\nold persona\n");

    resetPersonaProfiles(personaPath);

    const content = readFileSync(personaPath, "utf8");
    expect(content).toContain("# Persona Profiles");
    expect(content).toContain("## EN");
    expect(content).not.toContain("old persona");
  });
});

describe("parsePersonaRequest", () => {
  test("defaults to EN when no language prefix is provided", () => {
    expect(parsePersonaRequest("a friendly mentor")).toEqual({
      language: "EN",
      description: "a friendly mentor",
    });
  });

  test("parses language prefix from persona command", () => {
    expect(parsePersonaRequest("ja: 丁寧で簡潔")).toEqual({
      language: "JA",
      description: "丁寧で簡潔",
    });
  });

  test("auto detects JA for Japanese descriptions without prefix", () => {
    expect(parsePersonaRequest("丁寧で簡潔に話すアシスタント")).toEqual({
      language: "JA",
      description: "丁寧で簡潔に話すアシスタント",
    });
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
