import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HarnessProcessError, HarnessTimeoutError, runHarness, type StreamJsonEvent } from "./harness";
import { loadConfig, missingConfigErrorMessage } from "./config";
import { getDriver, isHarnessName } from "./drivers";
import { ChannelQueue } from "./queue";
import { ensureConfigFilePermissions, loadSessions, saveSessions, setEditMode, setHarness, setProjectDir, setSession } from "./sessions";

const DISCORD_CHAR_LIMIT = 2000;

export type HoustonCommand =
  | { type: "edit"; enabled: boolean }
  | { type: "status" }
  | { type: "setup"; projectName: string }
  | { type: "harness"; harnessName: string }
  | { type: "persona"; description: string };

export function parseCommand(prompt: string): HoustonCommand | null {
  const trimmed = prompt.trim();
  if (trimmed === "/edit on") return { type: "edit", enabled: true };
  if (trimmed === "/edit off") return { type: "edit", enabled: false };
  if (trimmed === "/status") return { type: "status" };

  const setupMatch = trimmed.match(/^\/setup\s+(.+)$/);
  if (setupMatch) return { type: "setup", projectName: setupMatch[1].trim() };

  const harnessMatch = trimmed.match(/^\/harness\s+(.+)$/);
  if (harnessMatch) return { type: "harness", harnessName: harnessMatch[1].trim() };

  if (trimmed === "/persona" || trimmed === "/persona clear") return { type: "persona", description: "" };
  const personaMatch = trimmed.match(/^\/persona\s+(.+)$/);
  if (personaMatch) return { type: "persona", description: personaMatch[1].trim() };

  return null;
}

export function stripBotMention(
  messageContent: string,
  botUserId: string,
): { mentioned: boolean; prompt: string } {
  const mentionFormats = [`<@${botUserId}>`, `<@!${botUserId}>`];
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

export function scaffoldProject(projectDir: string, projectName: string, channelName?: string): void {
  mkdirSync(projectDir, { recursive: true });

  const agentsPath = path.join(projectDir, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    const label = channelName ? ` from Discord channel #${channelName}` : "";
    writeFileSync(agentsPath, `# ${projectName}\n\nProject created by Houston${label}.\n`);
  }

  for (const name of ["CLAUDE.md", "GEMINI.md"]) {
    const linkPath = path.join(projectDir, name);
    if (!existsSync(linkPath)) {
      symlinkSync("AGENTS.md", linkPath);
    }
  }
}

const PERSONA_SECTION_REGEX = /\n## Persona\n[\s\S]*?(?=\n## |\n*$)/;

export function buildPersonaPrompt(description: string): string {
  return [
    "Write a persona instruction for an AI coding assistant's system prompt.",
    `The persona: "${description}"`,
    "",
    "Requirements:",
    "- 2-4 sentences defining personality, tone, and communication style",
    "- Be specific about mannerisms, vocabulary, and voice",
    "- The persona should be fun but must never compromise helpfulness or accuracy",
    "- Output ONLY the persona text, no headers, no markdown formatting, no preamble",
  ].join("\n");
}

export function updatePersona(agentsPath: string, description: string): void {
  const content = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";

  if (!description) {
    // Clear persona
    const cleared = content.replace(PERSONA_SECTION_REGEX, "");
    writeFileSync(agentsPath, cleared.trimEnd() + "\n");
    return;
  }

  const section = `\n## Persona\n\n${description}\n`;

  if (PERSONA_SECTION_REGEX.test(content)) {
    writeFileSync(agentsPath, content.replace(PERSONA_SECTION_REGEX, section).trimEnd() + "\n");
  } else {
    writeFileSync(agentsPath, content.trimEnd() + "\n" + section);
  }
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

async function sendReplyInChunks(message: any, response: string): Promise<void> {
  const chunks = splitDiscordMessage(response, DISCORD_CHAR_LIMIT);

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

  const sessions = loadSessions(paths.sessionsPath);
  const queue = new ChannelQueue();

  const discord = await import("discord.js");
  const client = new discord.Client({
    intents: [discord.GatewayIntentBits.Guilds, discord.GatewayIntentBits.GuildMessages, discord.GatewayIntentBits.MessageContent],
  });

  const verbose = process.argv.includes("--verbose") || process.env.HOUSTON_VERBOSE === "1";

  function log(...args: unknown[]) {
    if (verbose) console.log("[houston]", ...args);
  }

  client.on("clientReady", () => {
    console.log(`Houston online as ${client.user?.tag ?? "unknown user"}`);
    console.log(`Config path: ${paths.configPath}`);
    console.log(`Sessions path: ${paths.sessionsPath}`);
    console.log(`Default harness: ${config.defaultHarness}`);
    console.log(`Base directory: ${config.baseDir}`);
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

    const isReplyToBot = message.reference?.messageId
      && (await message.channel.messages.fetch(message.reference.messageId).catch(() => null))?.author?.id === client.user.id;

    const mention = stripBotMention(message.content, client.user.id);
    const prompt = mention.mentioned ? mention.prompt : isReplyToBot ? message.content.trim() : "";
    if (!prompt) {
      log("Skipped: not a bot mention or reply");
      return;
    }

    const command = parseCommand(prompt);

    // /setup command: bind channel to a project
    if (command?.type === "setup") {
      const projectName = command.projectName;
      if (!isValidProjectName(projectName)) {
        await message.reply("Invalid project name. Use lowercase letters, numbers, hyphens, dots, or underscores.");
        return;
      }

      const projectDir = path.resolve(config.baseDir, projectName);
      if (!isSubPath(config.baseDir, projectDir)) {
        await message.reply("Invalid project name.");
        return;
      }

      if (!existsSync(projectDir)) {
        scaffoldProject(projectDir, projectName, channelName);
        console.log(`Created project directory: ${projectDir}`);
      } else if (!statSync(projectDir).isDirectory()) {
        await message.reply(`Project path exists but is not a directory: \`${projectDir}\``);
        return;
      }

      setProjectDir(sessions, message.channelId, projectDir);
      saveSessions(paths.sessionsPath, sessions);

      const harnessName = sessions[message.channelId]?.harness ?? config.defaultHarness;
      await message.reply(`Project \`${projectName}\` ready at \`${projectDir}\`. Harness: ${harnessName}`);
      return;
    }

    // /harness command: switch harness for channel
    if (command?.type === "harness") {
      if (!isHarnessName(command.harnessName)) {
        await message.reply(`Unknown harness \`${command.harnessName}\`. Supported: claude, gemini`);
        return;
      }

      setHarness(sessions, message.channelId, command.harnessName);
      saveSessions(paths.sessionsPath, sessions);
      await message.reply(`Harness switched to **${command.harnessName}**. Session cleared.`);
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
          await message.reply("Invalid project name.");
          return;
        }

        if (!existsSync(synthProjectDir)) {
          scaffoldProject(synthProjectDir, syntheticCommand.projectName, channelName);
          console.log(`Created project directory: ${synthProjectDir}`);
        } else if (!statSync(synthProjectDir).isDirectory()) {
          await message.reply(`Project path exists but is not a directory: \`${synthProjectDir}\``);
          return;
        }

        setProjectDir(sessions, message.channelId, synthProjectDir);
        saveSessions(paths.sessionsPath, sessions);

        const harnessName = sessions[message.channelId]?.harness ?? config.defaultHarness;
        await message.reply(`Project \`${syntheticCommand.projectName}\` ready at \`${synthProjectDir}\`. Harness: ${harnessName}`);
        return;
      }

      const botName = client.user?.username ?? "Houston";
      if (suggested) {
        await message.reply(`To use ${botName} in this channel, you need to set up a local project. Use \`${suggested}\`? Reply **yes** or \`/setup <other-name>\`.`);
      } else {
        await message.reply(`To use ${botName} in this channel, you need to set up a local project. Use \`/setup <project-name>\` to get started.`);
      }
      return;
    }

    // /persona command
    if (command?.type === "persona") {
      const agentsPath = path.join(projectDir, "AGENTS.md");
      if (!command.description) {
        updatePersona(agentsPath, "");
        await message.reply("Persona cleared.");
        return;
      }

      const harnessName = entry?.harness ?? config.defaultHarness;
      const driver = getDriver(harnessName);
      const stopTyping = startTypingLoop(message.channel);

      try {
        const result = await runHarness({
          prompt: buildPersonaPrompt(command.description),
          projectDir,
          driver,
          editMode: false,
          timeoutMs: 2 * 60 * 1000,
        });

        stopTyping();
        const generated = result.output.trim();
        if (!generated) {
          await message.reply("Failed to generate persona. Try again with a different description.");
          return;
        }

        updatePersona(agentsPath, generated);
        await message.reply(`Persona set:\n\n${generated}`);
      } catch (error) {
        stopTyping();
        log(`Persona generation error: ${error instanceof Error ? error.message : error}`);
        await message.reply("Failed to generate persona. Try again.");
      }
      return;
    }

    // /edit command
    if (command?.type === "edit") {
      setEditMode(sessions, message.channelId, command.enabled);
      saveSessions(paths.sessionsPath, sessions);
      const label = command.enabled
        ? "Edit mode enabled. Claude can now modify files."
        : "Edit mode disabled.";
      await message.reply(label);
      return;
    }

    // /status command
    if (command?.type === "status") {
      const harnessName = entry?.harness ?? config.defaultHarness;
      const editLabel = entry?.editMode ? "on" : "off";
      const sessionLabel = entry?.sessionId || "none";
      await message.reply(
        `**Harness:** ${harnessName}\n**Edit mode:** ${editLabel}\n**Session:** ${sessionLabel}\n**Project:** ${projectDir}`,
      );
      return;
    }

    log(`Routed to project: ${projectDir}`);
    log(`Prompt: ${prompt.slice(0, 200)}`);

    await queue.enqueue(message.channelId, async () => {
      if (!existsSync(projectDir)) {
        await message.reply(`Project directory not found: \`${projectDir}\`. Run \`/setup <name>\` again.`);
        return;
      }

      const harnessName = entry?.harness ?? config.defaultHarness;
      const driver = getDriver(harnessName);
      const previousSessionId = entry?.sessionId || undefined;
      const editMode = entry?.editMode === true;

      log(`Session: ${previousSessionId ?? "new"}`);
      log(`Harness: ${harnessName}`);
      const stopTyping = startTypingLoop(message.channel);

      const runOpts = {
        prompt,
        projectDir,
        driver,
        editMode,
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
            result = await runHarness({ ...runOpts, editMode: false });
          } else {
            throw error;
          }
        }

        stopTyping();
        log(`${driver.name} finished: ${result.output.length} chars, session ${result.sessionId ?? "none"}`);
        log(`Output:\n${result.output}`);

        let output = result.output.trim().length > 0 ? result.output.trim() : "No assistant text returned.";

        if (editMode) {
          output = `**[edit]** ${output}`;
        }

        log(`Permission denials: ${JSON.stringify(result.permissionDenials)}`);
        const hasEditDenial = result.permissionDenials.some(
          (d) => d.includes("Edit") || d.includes("Write"),
        ) || (!editMode && /\bWrite\b.*\bblocked\b|\bEdit\b.*\bblocked\b|\bpermission\b.*\b(?:Write|Edit)\b/i.test(result.output));
        if (hasEditDenial) {
          output += "\n\nTip: use `/edit on` to allow file modifications.";
        }

        await sendReplyInChunks(message, output);

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
        await message.reply(body);
      }
    });
  });

  console.log(`Default harness: ${config.defaultHarness}`);

  await client.login(config.token);
}

if (import.meta.main) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
