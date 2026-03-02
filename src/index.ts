import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { HarnessProcessError, HarnessTimeoutError, runHarness, type PermissionLevel, type StreamJsonEvent } from "./harness";
import { loadConfig, missingConfigErrorMessage } from "./config";
import {
  DEFAULT_CONSTITUTION,
  defaultConstitutionPath,
  loadConstitutionFromPath,
  serializeConstitution,
  type HoustonConstitution,
} from "./constitution";
import { buildHarnessPromptWithContext, loadPromptContext } from "./context-loader";
import { classifyIntent, type ClassifiedCommand } from "./classify";
import { checkAvailableDrivers, getDriver, isHarnessName } from "./drivers";
import { ChannelQueue } from "./queue";
import { ensureConfigFilePermissions, loadSessions, saveSessions, setEditMode, setHarness, setLastResponse, setProjectDir, setSession } from "./sessions";
import {
  AGENTS_FILE_NAME,
  CONTEXT_FILE_NAME,
  DEFAULT_PERSONA_LANG_MD,
  PERSONA_LANG_FILE_NAME,
  SKILLS_FILE_NAME,
  WORKSPACE_DEFAULT_TEMPLATES,
  type WorkspaceDefaultFileName,
  workspaceDefaultsDir,
} from "./workspace-defaults";

const DISCORD_CHAR_LIMIT = 2000;
const RESUME_PROMPT =
  "Continue the most recent interrupted response in this channel. Return only the final response text.";
const MARKDOWN_LINK_REGEX = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const ABSOLUTE_PATH_REGEX = /(^|[\s(<`'"])((?:\/[^/\s`()[\]{}<>:]+){2,}(?::\d+(?::\d+)?)?)/g;

export type HoustonCommand =
  | { type: "edit"; enabled: boolean }
  | { type: "status" }
  | { type: "resume" }
  | { type: "setup"; projectName: string }
  | { type: "harness"; harnessName: string }
  | { type: "persona"; description: string }
  | { type: "icon"; clear: boolean };

export function parseCommand(prompt: string): HoustonCommand | null {
  const trimmed = prompt.trim();
  if (trimmed === "/edit on") return { type: "edit", enabled: true };
  if (trimmed === "/edit off") return { type: "edit", enabled: false };
  if (trimmed === "/status") return { type: "status" };
  if (trimmed === "/resume") return { type: "resume" };
  if (trimmed === "/icon") return { type: "icon", clear: false };
  if (trimmed === "/icon clear") return { type: "icon", clear: true };

  const setupMatch = trimmed.match(/^\/setup\s+(.+)$/);
  if (setupMatch) return { type: "setup", projectName: setupMatch[1].trim() };

  const harnessMatch = trimmed.match(/^\/harness\s+(.+)$/);
  if (harnessMatch) return { type: "harness", harnessName: harnessMatch[1].trim() };

  if (trimmed === "/persona" || trimmed === "/persona clear") return { type: "persona", description: "" };
  const personaMatch = trimmed.match(/^\/persona\s+(.+)$/);
  if (personaMatch) return { type: "persona", description: personaMatch[1].trim() };

  // Natural language harness switching: "switch to codex", "use gemini", "change harness to claude"
  const nlHarnessMatch = trimmed.match(/^(?:switch|change|use|set)\s+(?:(?:harness|model|engine)\s+)?(?:to\s+)?(\w+)$/i)
    ?? trimmed.match(/^(?:switch|change|set)\s+to\s+(\w+)$/i);
  if (nlHarnessMatch) {
    const candidate = nlHarnessMatch[1].toLowerCase();
    if (isHarnessName(candidate)) return { type: "harness", harnessName: candidate };
  }

  return null;
}

export function classifiedToCommand(classified: ClassifiedCommand): HoustonCommand | null {
  switch (classified.command) {
    case "harness":
      return classified.args ? { type: "harness", harnessName: classified.args } : null;
    case "edit":
      if (classified.args === "on") return { type: "edit", enabled: true };
      if (classified.args === "off") return { type: "edit", enabled: false };
      return null;
    case "status":
      return { type: "status" };
    case "setup":
      return classified.args ? { type: "setup", projectName: classified.args } : null;
    case "persona":
      return { type: "persona", description: classified.args ?? "" };
    default:
      return null;
  }
}

export function applyEmptyMentionHelpRule(
  previousShown: boolean,
  isDirectMention: boolean,
  prompt: string,
): { showHelp: boolean; nextShown: boolean } {
  if (prompt.trim().length > 0) {
    return { showHelp: false, nextShown: false };
  }

  if (!isDirectMention) {
    return { showHelp: false, nextShown: previousShown };
  }

  if (previousShown) {
    return { showHelp: false, nextShown: true };
  }

  return { showHelp: true, nextShown: true };
}

export function buildEmptyMentionHelp(
  botName: string,
  isProjectBound: boolean,
  suggestedProjectName: string | null,
): string {
  if (!isProjectBound) {
    const setupHint = suggestedProjectName
      ? `Use \`/setup ${suggestedProjectName}\` to bind this channel.`
      : "Use `/setup <project-name>` to bind this channel.";
    return [
      `Hi, I am ${botName}. This channel is not set up yet.`,
      setupHint,
      "After setup, try `/status` to verify settings.",
    ].join("\n");
  }

  return [
    `Hi, I am ${botName}.`,
    "Commands: `/status`, `/resume`, `/harness claude|codex|gemini`, `/edit on|off`, `/persona [lang:] <description>`, `/icon`, `/icon clear`.",
  ].join("\n");
}

export function stripBotMention(
  messageContent: string,
  botUserId: string,
  roleIds: string[] = [],
): { mentioned: boolean; prompt: string } {
  const mentionFormats = [`<@${botUserId}>`, `<@!${botUserId}>`];
  for (const roleId of roleIds) {
    mentionFormats.push(`<@&${roleId}>`);
  }
  const trimmed = messageContent.trim();

  for (const mention of mentionFormats) {
    if (trimmed.startsWith(mention)) {
      const prompt = trimmed.slice(mention.length).trim();
      return {
        mentioned: true,
        prompt,
      };
    }
  }

  return {
    mentioned: false,
    prompt: "",
  };
}

export function isSubPath(baseDir: string, targetDir: string): boolean {
  const normalizedBase = path.resolve(baseDir);
  const normalizedTarget = path.resolve(targetDir);
  const relative = path.relative(normalizedBase, normalizedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME_REGEX.test(name) && !name.includes("..");
}

export function sanitizeChannelName(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || !isValidProjectName(slug)) return null;
  return slug;
}

function copyDefaultWorkspaceFileIfMissing(
  projectDir: string,
  fileName: WorkspaceDefaultFileName,
  defaultsDir?: string,
): void {
  const filePath = path.join(projectDir, fileName);
  if (existsSync(filePath)) {
    return;
  }

  if (defaultsDir) {
    const sourcePath = path.join(defaultsDir, fileName);
    if (existsSync(sourcePath)) {
      writeFileSync(filePath, readFileSync(sourcePath, "utf8"), "utf8");
      return;
    }
  }

  writeFileSync(filePath, WORKSPACE_DEFAULT_TEMPLATES[fileName], "utf8");
}

export function scaffoldProject(
  projectDir: string,
  _projectName: string,
  _channelName?: string,
  defaultsDir?: string,
): void {
  mkdirSync(projectDir, { recursive: true });

  copyDefaultWorkspaceFileIfMissing(projectDir, AGENTS_FILE_NAME, defaultsDir);
  copyDefaultWorkspaceFileIfMissing(projectDir, PERSONA_LANG_FILE_NAME, defaultsDir);
  copyDefaultWorkspaceFileIfMissing(projectDir, CONTEXT_FILE_NAME, defaultsDir);
  copyDefaultWorkspaceFileIfMissing(projectDir, SKILLS_FILE_NAME, defaultsDir);

  for (const name of ["CLAUDE.md", "GEMINI.md"]) {
    const linkPath = path.join(projectDir, name);
    if (!existsSync(linkPath)) {
      symlinkSync("AGENTS.md", linkPath);
    }
  }
}

const PERSONA_DEFAULT_LANGUAGE = "EN";
const PERSONA_LANG_INPUT_REGEX = /^([A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})?)\s*:\s*(.+)$/;
const JAPANESE_KANA_REGEX = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/;
const JAPANESE_PUNCTUATION_REGEX = /[。、・「」『』ー]/;

function normalizePersonaLanguage(value: string): string {
  return value
    .trim()
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase())
    .join("-");
}

function inferPersonaLanguage(value: string): string {
  if (JAPANESE_KANA_REGEX.test(value) || JAPANESE_PUNCTUATION_REGEX.test(value)) {
    return "JA";
  }

  return PERSONA_DEFAULT_LANGUAGE;
}

export function parsePersonaRequest(description: string): { language: string; description: string } {
  const trimmed = description.trim();
  const matched = trimmed.match(PERSONA_LANG_INPUT_REGEX);
  if (!matched) {
    return { language: inferPersonaLanguage(trimmed), description: trimmed };
  }

  return {
    language: normalizePersonaLanguage(matched[1]),
    description: matched[2].trim(),
  };
}

export function buildPersonaPrompt(description: string, language = PERSONA_DEFAULT_LANGUAGE): string {
  const normalizedLanguage = normalizePersonaLanguage(language) || PERSONA_DEFAULT_LANGUAGE;
  return [
    "Write a persona instruction for an AI coding assistant's system prompt.",
    `Target language: ${normalizedLanguage}`,
    `The persona: "${description}"`,
    "",
    "Requirements:",
    "- 2-4 sentences defining personality, tone, and communication style",
    "- Be specific about mannerisms, vocabulary, and voice",
    "- The persona should be fun but must never compromise helpfulness or accuracy",
    `- Write the output in ${normalizedLanguage}`,
    "- Output ONLY the persona text, no headers, no markdown formatting, no preamble",
  ].join("\n");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function personaSectionRegex(language: string): RegExp {
  return new RegExp(`\\n## ${escapeRegex(language)}\\n[\\s\\S]*?(?=\\n## |\\n*$)`);
}

export function resetPersonaProfiles(personaPath: string): void {
  writeFileSync(personaPath, `${DEFAULT_PERSONA_LANG_MD}\n`, "utf8");
}

export function updatePersona(personaPath: string, description: string, language = PERSONA_DEFAULT_LANGUAGE): void {
  const normalizedLanguage = normalizePersonaLanguage(language) || PERSONA_DEFAULT_LANGUAGE;
  const content = existsSync(personaPath) ? readFileSync(personaPath, "utf8") : `${DEFAULT_PERSONA_LANG_MD}\n`;
  const section = `\n## ${normalizedLanguage}\n\n${description}\n`;
  const sectionPattern = personaSectionRegex(normalizedLanguage);

  if (sectionPattern.test(content)) {
    writeFileSync(personaPath, content.replace(sectionPattern, section).trimEnd() + "\n");
    return;
  }

  writeFileSync(personaPath, content.trimEnd() + section, "utf8");
}

export function splitDiscordMessage(input: string, maxLength = DISCORD_CHAR_LIMIT): string[] {
  if (input.length <= maxLength) {
    return [input];
  }

  const chunks: string[] = [];
  let remaining = input.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }

    if (splitAt <= 0) {
      const firstWhitespace = remaining.search(/\s/);
      if (firstWhitespace <= 0) {
        chunks.push(remaining);
        break;
      }
      splitAt = firstWhitespace;
    }

    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk.length === 0) {
      remaining = remaining.slice(splitAt + 1);
      continue;
    }

    chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

function normalizePathSeparators(input: string): string {
  return input.split(path.sep).join("/");
}

function toSafeLocation(inputPath: string, baseDir: string): string {
  const match = inputPath.match(/^(.*?)(:\d+(?::\d+)?)?$/);
  const filePath = match?.[1] ?? inputPath;
  const locationSuffix = match?.[2] ?? "";
  const resolvedPath = path.resolve(filePath);

  if (isSubPath(baseDir, resolvedPath)) {
    const relativePath = normalizePathSeparators(path.relative(baseDir, resolvedPath));
    return `${relativePath || "."}${locationSuffix}`;
  }

  return `<external-path>${locationSuffix}`;
}

const DOMAIN_LIKE_REGEX = /^(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z]{2,})+)/i;

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns true when the link label looks like a domain/URL that doesn't match
 * the actual target, e.g. [google.com](https://evil.com). This is the classic
 * masked-link phishing vector. Plain text labels like [Afuri Ramen](...) are fine.
 */
export function isMisleadingLinkLabel(label: string, target: string): boolean {
  const labelMatch = label.trim().match(DOMAIN_LIKE_REGEX);
  if (!labelMatch) return false;

  const labelDomain = labelMatch[1].toLowerCase();
  const targetDomain = extractDomain(target);
  if (!targetDomain) return false;

  return labelDomain !== targetDomain && !targetDomain.endsWith("." + labelDomain);
}

export function sanitizeDiscordReply(input: string, baseDir: string): string {
  const withoutMaskedLocalLinks = input.replace(MARKDOWN_LINK_REGEX, (match, label: string, target: string) => {
    if (/^https?:\/\//i.test(target)) {
      if (isMisleadingLinkLabel(label, target)) {
        return `${label}: ${target}`;
      }
      return match;
    }

    if (path.isAbsolute(target)) {
      return `${label} (\`${toSafeLocation(target, baseDir)}\`)`;
    }

    return `${label} (\`${target}\`)`;
  });

  return withoutMaskedLocalLinks.replace(
    ABSOLUTE_PATH_REGEX,
    (_match, prefix: string, absolutePath: string) => `${prefix}${toSafeLocation(absolutePath, baseDir)}`,
  );
}

async function sendReplyInChunks(message: any, response: string, baseDir: string): Promise<void> {
  const sanitized = sanitizeDiscordReply(response, baseDir);
  const chunks = splitDiscordMessage(sanitized, DISCORD_CHAR_LIMIT);

  for (const chunk of chunks) {
    if (chunk.length <= DISCORD_CHAR_LIMIT) {
      await message.reply(chunk);
      continue;
    }

    const { AttachmentBuilder } = await import("discord.js");
    const attachment = new AttachmentBuilder(Buffer.from(chunk, "utf8"), {
      name: "houston-output.txt",
      description: "Output exceeded Discord character limit for a single token",
    });
    await message.reply({ content: "Response attached as file.", files: [attachment] });
  }
}

function startTypingLoop(channel: { sendTyping: () => Promise<unknown> }): () => void {
  let stopped = false;
  const tick = () => {
    void channel.sendTyping().catch(() => undefined);
  };

  tick();
  const timer = setInterval(tick, 8000);

  return () => {
    if (stopped) {
      return;
    }

    stopped = true;
    clearInterval(timer);
  };
}

function formatCommandError(error: unknown): string {
  if (error instanceof HarnessTimeoutError) {
    return `Process timed out after ${Math.floor(error.timeoutMs / 1000)} seconds.`;
  }

  if (error instanceof HarnessProcessError) {
    const body = error.details.length > 0 ? error.details.join("\n") : "No details returned.";
    return `Exited with code ${error.exitCode}\n${body}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}

function formatContextLoadError(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  if (/slot "agents"|\/AGENTS\.md/.test(reason)) {
    return "Required project instructions file is missing: AGENTS.md. Restore it or run `/setup <project-name>` again.";
  }

  return "Failed to load prompt context: " + reason;
}

export async function start(): Promise<void> {
  let loaded;
  try {
    loaded = loadConfig();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const missingPath = (error as NodeJS.ErrnoException).path ?? "unknown";
      throw new Error(missingConfigErrorMessage(missingPath));
    }

    throw error;
  }

  const { config, paths } = loaded;
  ensureConfigFilePermissions(paths.configPath);

  const configuredConstitutionPath = config.constitutionPath;
  const fallbackConstitutionPath = defaultConstitutionPath(paths.configPath);
  const constitutionPath = configuredConstitutionPath ?? fallbackConstitutionPath;
  let constitution: HoustonConstitution = DEFAULT_CONSTITUTION;
  let constitutionSource: "config" | "default" | "builtin" = "builtin";

  if (configuredConstitutionPath) {
    constitution = loadConstitutionFromPath(configuredConstitutionPath);
    constitutionSource = "config";
  } else if (existsSync(fallbackConstitutionPath)) {
    constitution = loadConstitutionFromPath(fallbackConstitutionPath);
    constitutionSource = "default";
  } else {
    console.warn("[houston] Constitution file not found, using built in defaults: " + fallbackConstitutionPath);
  }

  const constitutionHash = createHash("sha256")
    .update(serializeConstitution(constitution))
    .digest("hex")
    .slice(0, 12);

  let geminiEditOffPolicyPath = config.geminiEditOffPolicy;
  const markdownDefaultsDir = workspaceDefaultsDir(paths.configPath);
  const hasMarkdownDefaults = existsSync(markdownDefaultsDir);
  if (geminiEditOffPolicyPath && !existsSync(geminiEditOffPolicyPath)) {
    console.warn(`[houston] Gemini edit-off policy not found, continuing without it: ${geminiEditOffPolicyPath}`);
    geminiEditOffPolicyPath = undefined;
  }

  const sessions = loadSessions(paths.sessionsPath);
  const queue = new ChannelQueue();
  const availableDrivers = await checkAvailableDrivers();
  const emptyMentionHelpShown = new Set<string>();
  const lastContextFilesByChannel = new Map<string, number>();

  const discord = await import("discord.js");
  const client = new discord.Client({
    intents: [discord.GatewayIntentBits.Guilds, discord.GatewayIntentBits.GuildMessages, discord.GatewayIntentBits.MessageContent],
  });

  const verbose = process.argv.includes("--verbose") || process.env.HOUSTON_VERBOSE === "1";

  function log(...args: unknown[]) {
    if (verbose) console.log("[houston]", ...args);
  }

  async function reply(message: any, content: string): Promise<void> {
    await sendReplyInChunks(message, content, config.baseDir);
  }

  let botRoleIds: string[] = [];

  client.on("clientReady", () => {
    console.log(`Houston online as ${client.user?.tag ?? "unknown user"}`);
    console.log(`Config path: ${paths.configPath}`);
    console.log(`Sessions path: ${paths.sessionsPath}`);
    console.log(`Default harness: ${config.defaultHarness}`);
    console.log(`Available harnesses: ${[...availableDrivers].join(", ") || "none"}`);
    console.log("Base directory: " + config.baseDir);
    console.log(
      "Constitution: " + constitutionPath
      + " (" + constitutionSource
      + ", slots: " + constitution.slots.length
      + ", sha256:" + constitutionHash + ")",
    );
    if (hasMarkdownDefaults) {
      console.log(`Workspace markdown defaults: ${markdownDefaultsDir}`);
    }
    if (geminiEditOffPolicyPath) {
      console.log(`Gemini edit-off policy: ${geminiEditOffPolicyPath}`);
    }

    // Collect managed role IDs so @Role mentions also trigger the bot
    const botId = client.user?.id;
    if (botId) {
      const roleIds: string[] = [];
      for (const guild of client.guilds.cache.values()) {
        const managed = guild.roles.cache.find((r: any) => r.managed && r.tags?.botId === botId);
        if (managed) roleIds.push(managed.id);
      }
      botRoleIds = roleIds;
      if (roleIds.length > 0) log(`Bot role IDs: ${roleIds.join(", ")}`);
    }

    if (verbose) console.log("Verbose logging enabled");
  });

  client.on("messageCreate", async (message: any) => {
    if (message.author?.bot) {
      return;
    }

    if (typeof message.content !== "string" || message.content.trim().length === 0) {
      return;
    }

    if (!client.user?.id) {
      return;
    }

    const channelName = message.channel?.name;
    log(`Message in #${channelName ?? "unknown"} from ${message.author?.tag}: ${message.content.slice(0, 100)}`);

    const repliedMessage = message.reference?.messageId
      ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null)
      : null;
    const isReplyToBot = repliedMessage?.author?.id === client.user.id;

    const mention = stripBotMention(message.content, client.user.id, botRoleIds);
    let prompt = mention.mentioned ? mention.prompt : isReplyToBot ? message.content.trim() : "";
    const previousHelpShown = emptyMentionHelpShown.has(message.channelId);
    const emptyMentionRule = applyEmptyMentionHelpRule(previousHelpShown, mention.mentioned, prompt);
    if (emptyMentionRule.nextShown) {
      emptyMentionHelpShown.add(message.channelId);
    } else {
      emptyMentionHelpShown.delete(message.channelId);
    }

    if (emptyMentionRule.showHelp) {
      const entry = sessions[message.channelId];
      const isProjectBound = Boolean(entry?.projectDir);
      const suggested = typeof channelName === "string" ? sanitizeChannelName(channelName) : null;
      const botName = client.user?.username ?? "Houston";
      const help = buildEmptyMentionHelp(botName, isProjectBound, suggested);
      await reply(message, help);
      return;
    }

    if (!prompt) {
      if (mention.mentioned) {
        log("Skipped: repeated empty mention");
        return;
      }
      log("Skipped: not a bot mention or reply");
      return;
    }

    let yoloOverride = false;
    const yoloMatch = prompt.match(/^\/yolo\s+(.+)$/s);
    if (yoloMatch) {
      yoloOverride = true;
      prompt = yoloMatch[1];
    }

    let command = yoloOverride ? null : parseCommand(prompt);

    // For short unmatched messages, try LLM intent classification
    if (!command && !yoloOverride && prompt.length <= 100 && availableDrivers.has("claude")) {
      try {
        const classified = await classifyIntent(prompt);
        if (classified.command !== "none") {
          command = classifiedToCommand(classified);
          if (command) log(`Classified as ${command.type}${("harnessName" in command ? `: ${command.harnessName}` : "")}`);
        }
      } catch (err) {
        log(`Classification failed, falling through to harness: ${err instanceof Error ? err.message : err}`);
      }
    }

    // /setup command: bind channel to a project
    if (command?.type === "setup") {
      const projectName = command.projectName;
      if (!isValidProjectName(projectName)) {
        await reply(message, "Invalid project name. Use lowercase letters, numbers, hyphens, dots, or underscores.");
        return;
      }

      const projectDir = path.resolve(config.baseDir, projectName);
      if (!isSubPath(config.baseDir, projectDir)) {
        await reply(message, "Invalid project name.");
        return;
      }

      if (!existsSync(projectDir)) {
        scaffoldProject(projectDir, projectName, channelName, hasMarkdownDefaults ? markdownDefaultsDir : undefined);
        console.log(`Created project directory: ${projectDir}`);
      } else if (!statSync(projectDir).isDirectory()) {
        await reply(message, `Project path exists but is not a directory: \`${projectDir}\``);
        return;
      }

      setProjectDir(sessions, message.channelId, projectDir);
      saveSessions(paths.sessionsPath, sessions);

      const harnessName = sessions[message.channelId]?.harness ?? config.defaultHarness;
      const available = [...availableDrivers];
      await reply(message, `Project \`${projectName}\` ready at \`${projectDir}\`. Harness: ${harnessName}\nAvailable harnesses: ${available.join(", ") || "none"}`);
      return;
    }

    // /harness command: switch harness for channel
    if (command?.type === "harness") {
      const available = [...availableDrivers];
      if (!isHarnessName(command.harnessName)) {
        await reply(message, `Unknown harness \`${command.harnessName}\`. Available: ${available.join(", ") || "none"}`);
        return;
      }

      if (!availableDrivers.has(command.harnessName)) {
        await reply(message, `Harness \`${command.harnessName}\` is not installed. Available: ${available.join(", ") || "none"}`);
        return;
      }

      setHarness(sessions, message.channelId, command.harnessName);
      saveSessions(paths.sessionsPath, sessions);
      await reply(message, `Harness switched to **${command.harnessName}**. Session cleared.`);
      return;
    }

    // /icon command: set guild-specific bot avatar
    if (command?.type === "icon") {
      if (!message.guild) {
        await reply(message, "This command only works in server channels.");
        return;
      }

      const permissions = message.memberPermissions ?? message.member?.permissions;
      const canManageGuild = Boolean(permissions?.has?.(discord.PermissionFlagsBits.ManageGuild));
      if (!canManageGuild) {
        await reply(message, "You need Manage Server permission to change the bot icon.");
        return;
      }

      try {
        if (command.clear) {
          await message.guild.members.editMe({
            avatar: null,
            reason: `Houston icon cleared by ${message.author?.id ?? "unknown"}`,
          });
          await reply(message, "Server-specific bot icon cleared.");
          return;
        }

        const attachments = [...message.attachments.values()];
        if (attachments.length !== 1) {
          await reply(message, "Attach exactly one image with `@Houston /icon`.");
          return;
        }

        const attachment = attachments[0];
        const contentType = typeof attachment.contentType === "string" ? attachment.contentType.toLowerCase() : "";
        if (!contentType.startsWith("image/")) {
          await reply(message, "Attachment must be an image.");
          return;
        }

        const imageUrl = typeof attachment.url === "string" ? attachment.url : "";
        if (!imageUrl) {
          await reply(message, "Could not read the image attachment URL.");
          return;
        }

        let hostname = "";
        try {
          hostname = new URL(imageUrl).hostname.toLowerCase();
        } catch {
          await reply(message, "Attachment URL is invalid.");
          return;
        }

        if (hostname !== "cdn.discordapp.com" && hostname !== "media.discordapp.net") {
          await reply(message, "Only Discord hosted attachments are allowed.");
          return;
        }

        await message.guild.members.editMe({
          avatar: imageUrl,
          reason: `Houston icon updated by ${message.author?.id ?? "unknown"}`,
        });
        await reply(message, "Server-specific bot icon updated.");
      } catch (error) {
        log(`Icon update failed: ${error instanceof Error ? error.message : error}`);
        await reply(message, "Failed to update server-specific bot icon.");
      }
      return;
    }

    // Check if channel is bound to a project
    const entry = sessions[message.channelId];
    const projectDir = entry?.projectDir;
    if (!projectDir) {
      const suggested = typeof channelName === "string" ? sanitizeChannelName(channelName) : null;
      const lowerPrompt = prompt.trim().toLowerCase();

      // User replied "yes"/"y" to the setup suggestion: run /setup with the suggested name
      if ((lowerPrompt === "yes" || lowerPrompt === "y") && isReplyToBot && suggested) {
        // Synthesize a /setup command with the suggested channel name
        const syntheticCommand: HoustonCommand = { type: "setup", projectName: suggested };
        const synthProjectDir = path.resolve(config.baseDir, syntheticCommand.projectName);
        if (!isSubPath(config.baseDir, synthProjectDir)) {
          await reply(message, "Invalid project name.");
          return;
        }

        if (!existsSync(synthProjectDir)) {
          scaffoldProject(
            synthProjectDir,
            syntheticCommand.projectName,
            channelName,
            hasMarkdownDefaults ? markdownDefaultsDir : undefined,
          );
          console.log(`Created project directory: ${synthProjectDir}`);
        } else if (!statSync(synthProjectDir).isDirectory()) {
          await reply(message, `Project path exists but is not a directory: \`${synthProjectDir}\``);
          return;
        }

        setProjectDir(sessions, message.channelId, synthProjectDir);
        saveSessions(paths.sessionsPath, sessions);

        const harnessName = sessions[message.channelId]?.harness ?? config.defaultHarness;
        const synthAvailable = [...availableDrivers];
        await reply(message, `Project \`${syntheticCommand.projectName}\` ready at \`${synthProjectDir}\`. Harness: ${harnessName}\nAvailable harnesses: ${synthAvailable.join(", ") || "none"}`);
        return;
      }

      const botName = client.user?.username ?? "Houston";
      if (suggested) {
        await reply(message, `To use ${botName} in this channel, you need to set up a local project. Use \`${suggested}\`? Reply **yes** or \`/setup <other-name>\`.`);
      } else {
        await reply(message, `To use ${botName} in this channel, you need to set up a local project. Use \`/setup <project-name>\` to get started.`);
      }
      return;
    }

    // /persona command
    if (command?.type === "persona") {
      const personaPath = path.join(projectDir, PERSONA_LANG_FILE_NAME);
      if (!command.description) {
        resetPersonaProfiles(personaPath);
        await reply(message, "Persona profiles cleared.");
        return;
      }

      const personaRequest = parsePersonaRequest(command.description);
      if (!personaRequest.description) {
        await reply(message, "Persona description is empty.");
        return;
      }

      const harnessName = entry?.harness ?? config.defaultHarness;
      const driver = getDriver(harnessName);
      const stopTyping = startTypingLoop(message.channel);

      try {
        const result = await runHarness({
          prompt: buildPersonaPrompt(personaRequest.description, personaRequest.language),
          projectDir,
          driver,
          permissionLevel: "off",
          policyPath: geminiEditOffPolicyPath,
          timeoutMs: 2 * 60 * 1000,
        });

        stopTyping();
        const generated = result.output.trim();
        if (!generated) {
          await reply(message, "Failed to generate persona. Try again with a different description.");
          return;
        }

        updatePersona(personaPath, generated, personaRequest.language);
        await reply(message, `Persona set for ${personaRequest.language}:\n\n${generated}`);
      } catch (error) {
        stopTyping();
        log(`Persona generation error: ${error instanceof Error ? error.message : error}`);
        await reply(message, "Failed to generate persona. Try again.");
      }
      return;
    }

    // /edit command
    if (command?.type === "edit") {
      setEditMode(sessions, message.channelId, command.enabled);
      saveSessions(paths.sessionsPath, sessions);
      const label = command.enabled
        ? "Edit mode enabled. The selected harness can now modify files."
        : "Edit mode disabled.";
      await reply(message, label);
      return;
    }

    // /status command
    if (command?.type === "status") {
      const harnessName = entry?.harness ?? config.defaultHarness;
      const editLabel = entry?.editMode ? "on" : "off";
      const sessionLabel = entry?.sessionId || "none";
      const installedLabel = availableDrivers.has(harnessName) ? "yes" : "no";
      const contextFiles = lastContextFilesByChannel.get(message.channelId);
      const contextLabel = typeof contextFiles === "number" ? String(contextFiles) : "none";
      const statusLines = [
        "**Harness:** " + harnessName + " (installed: " + installedLabel + ")",
        "**Edit mode:** " + editLabel,
        "**Session:** " + sessionLabel,
        "**Project:** " + projectDir,
        "**Constitution:** " + constitutionSource + " (slots: " + constitution.slots.length + ", sha256:" + constitutionHash + ")",
        "**Last context files:** " + contextLabel,
      ];
      await reply(message, statusLines.join("\n"));
      return;
    }

    // /resume command
    if (command?.type === "resume") {
      if (queue.isRunning(message.channelId)) {
        await reply(message, "A request is still running in this channel. Please wait for it to finish.");
        return;
      }

      const cached = entry?.lastOutput?.trim();
      if (cached) {
        await reply(message, cached);
        return;
      }

      const harnessName = entry?.harness ?? config.defaultHarness;
      const driver = getDriver(harnessName);
      const sessionId = entry?.sessionId || "";
      if (!sessionId || !driver.isValidSessionId(sessionId)) {
        await reply(message, "Nothing to resume yet. There is no cached output or active session in this channel.");
        return;
      }

      prompt = RESUME_PROMPT;
    }

    // When the user replies to a specific bot message, prepend its content
    // so the harness knows what "this", "that", etc. refer to.
    if (command?.type !== "resume" && isReplyToBot && repliedMessage?.content) {
      const quoted = repliedMessage.content.slice(0, 1000);
      prompt = `[Replying to your previous message: "${quoted}"]\n\n${prompt}`;
    }

    log(`Routed to project: ${projectDir}`);
    log(`Prompt: ${prompt.slice(0, 200)}`);

    await queue.enqueue(message.channelId, async () => {
      if (!existsSync(projectDir)) {
        await reply(message, `Project directory not found: \`${projectDir}\`. Run \`/setup <name>\` again.`);
        return;
      }

      // Re-read session inside the queue callback to get the latest state.
      // The entry captured outside the queue becomes stale when setSession()
      // replaces sessions[channelId] with a new object during a prior queued run.
      const currentEntry = sessions[message.channelId];
      const harnessName = currentEntry?.harness ?? config.defaultHarness;
      const driver = getDriver(harnessName);
      const previousSessionId = currentEntry?.sessionId || undefined;
      const editMode = currentEntry?.editMode === true;
      const permissionLevel: PermissionLevel = yoloOverride ? "yolo" : editMode ? "edit" : "off";
      const userId = typeof message.author?.id === "string" ? message.author.id : message.channelId;
      let harnessPrompt = prompt;

      try {
        const loadedContext = loadPromptContext({
          constitution,
          configPath: paths.configPath,
          projectDir,
          userId,
        });
        harnessPrompt = buildHarnessPromptWithContext(prompt, loadedContext.files);
        lastContextFilesByChannel.set(message.channelId, loadedContext.files.length);
        log(
          "Context files: "
          + loadedContext.files.length
          + ", bytes: "
          + loadedContext.totalBytes,
        );
      } catch (error) {
        lastContextFilesByChannel.delete(message.channelId);
        log(`Context load error: ${error instanceof Error ? error.message : error}`);
        await reply(message, formatContextLoadError(error));
        return;
      }

      log(`Session: ${previousSessionId ?? "new"}`);
      log(`Harness: ${harnessName}`);
      const stopTyping = startTypingLoop(message.channel);

      const runOpts = {
        prompt: harnessPrompt,
        projectDir,
        driver,
        permissionLevel,
        policyPath: geminiEditOffPolicyPath,
        timeoutMs: 10 * 60 * 1000,
        onSpawn: (pid: number) => log(`${driver.name} process started (pid ${pid})`),
        onEvent: (event: StreamJsonEvent) => {
          if (event.type) log(`Event: ${event.type}${event.session_id ? ` session=${event.session_id}` : ""}`);
        },
        onMalformedJson: (line: string, source: "stdout" | "stderr") => {
          console.warn(`[malformed-json][${source}] ${line}`);
        },
      };

      try {
        log(`Spawning ${driver.name} process...`);
        let result;
        try {
          result = await runHarness({ ...runOpts, sessionId: previousSessionId });
        } catch (error) {
          if (previousSessionId && error instanceof HarnessProcessError && error.details.some((l) => l.includes("already in use"))) {
            log("Session in use, retrying without session ID...");
            setEditMode(sessions, message.channelId, false);
            result = await runHarness({ ...runOpts, permissionLevel: "off" });
          } else {
            throw error;
          }
        }

        stopTyping();
        log(`${driver.name} finished: ${result.output.length} chars, session ${result.sessionId ?? "none"}`);
        log(`Output:\n${result.output}`);

        const harnessDisplayName = harnessName.charAt(0).toUpperCase() + harnessName.slice(1);
        const modeLabel = permissionLevel === "yolo" ? "Yolo" : permissionLevel === "edit" ? "Edit on" : "Edit off";
        const modeHeader = `🤖 ${harnessDisplayName} | ✍️ ${modeLabel}`;
        const body = result.output.trim().length > 0 ? result.output.trim() : "No assistant text returned.";
        let output = `${modeHeader}\n${body}`;

        log(`Permission denials: ${JSON.stringify(result.permissionDenials)}`);
        const hasEditDenial = result.permissionDenials.some(
          (d) => d.includes("Edit") || d.includes("Write"),
        ) || (!editMode && /write_file|run_shell_command|write.*blocked|edit.*blocked|permission.*(?:write|edit)|read.only|sandbox|cannot.*(?:modify|write|edit|create)/i.test(result.output));
        if (hasEditDenial) {
          output += editMode
            ? "\n\nTip: use `/yolo <prompt>` to allow shell commands for a single request."
            : "\n\nTip: use `/edit on` to allow file modifications.";
        }

        setLastResponse(sessions, message.channelId, prompt, output);
        saveSessions(paths.sessionsPath, sessions);

        await reply(message, output);

        if (result.sessionId && driver.isValidSessionId(result.sessionId)) {
          setSession(sessions, message.channelId, result.sessionId);
          saveSessions(paths.sessionsPath, sessions);
          log(`Session saved: ${result.sessionId}`);
        }
      } catch (error) {
        stopTyping();
        log(`${driver.name} error: ${error instanceof Error ? error.message : error}`);
        const formatted = formatCommandError(error);
        const body = `\`\`\`\n${formatted.slice(0, 3900)}\n\`\`\``;
        await reply(message, body);
      }
    });
  });

  await client.login(config.token);
}

if (import.meta.main) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
