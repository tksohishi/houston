import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildClaudeArgs, ClaudeProcessError, ClaudeTimeoutError, isUuid, runClaude, type StreamJsonEvent } from "./claude";
import { loadConfig, missingConfigErrorMessage } from "./config";
import { ChannelQueue } from "./queue";
import { ensureConfigFilePermissions, loadSessions, saveSessions, setEditMode, setSession } from "./sessions";

const DISCORD_CHAR_LIMIT = 2000;

export type HoustonCommand =
  | { type: "edit"; enabled: boolean }
  | { type: "status" };

export function parseCommand(prompt: string): HoustonCommand | null {
  const trimmed = prompt.trim();
  if (trimmed === "/edit on") return { type: "edit", enabled: true };
  if (trimmed === "/edit off") return { type: "edit", enabled: false };
  if (trimmed === "/status") return { type: "status" };
  return null;
}

export interface ProjectRoute {
  slug: string;
  projectDir: string;
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

export function resolveProjectRoute(
  channelName: string,
  channelPrefix: string,
  baseDir: string,
): ProjectRoute | null {
  if (!channelName.startsWith(channelPrefix)) {
    return null;
  }

  const slug = channelName.slice(channelPrefix.length).trim();
  if (!slug) {
    return null;
  }

  const projectDir = path.resolve(baseDir, slug);
  if (!isSubPath(baseDir, projectDir)) {
    return null;
  }

  return { slug, projectDir };
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
  if (error instanceof ClaudeTimeoutError) {
    return `Claude timed out after ${Math.floor(error.timeoutMs / 1000)} seconds.`;
  }

  if (error instanceof ClaudeProcessError) {
    const body = error.details.length > 0 ? error.details.join("\n") : "No details returned.";
    return `Claude exited with code ${error.exitCode}\n${body}`;
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
    console.log(`Channel prefix: ${config.channelPrefix}`);
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

    if (typeof channelName !== "string") {
      return;
    }

    const route = resolveProjectRoute(channelName, config.channelPrefix, config.baseDir);
    if (!route) {
      log(`Skipped: channel #${channelName} does not match prefix "${config.channelPrefix}"`);
      return;
    }

    log(`Routed to project: ${route.slug} (${route.projectDir})`);
    log(`Prompt: ${prompt.slice(0, 200)}`);

    const command = parseCommand(prompt);
    if (command) {
      if (command.type === "edit") {
        setEditMode(sessions, message.channelId, command.enabled);
        saveSessions(paths.sessionsPath, sessions);
        const label = command.enabled
          ? "Edit mode enabled. Claude can now modify files."
          : "Edit mode disabled.";
        await message.reply(label);
        return;
      }

      if (command.type === "status") {
        const entry = sessions[message.channelId];
        const editLabel = entry?.editMode ? "on" : "off";
        const sessionLabel = entry?.sessionId || "none";
        await message.reply(
          `**Edit mode:** ${editLabel}\n**Session:** ${sessionLabel}\n**Project:** ${route.projectDir}`,
        );
        return;
      }
    }

    await queue.enqueue(message.channelId, async () => {
      if (!existsSync(route.projectDir)) {
        mkdirSync(route.projectDir, { recursive: true });
        writeFileSync(
          path.join(route.projectDir, "CLAUDE.md"),
          `# ${route.slug}\n\nProject created by Houston from Discord channel #${channelName}.\n`,
        );
        console.log(`Created project directory: ${route.projectDir}`);
      } else if (!statSync(route.projectDir).isDirectory()) {
        await message.reply(`Project path exists but is not a directory: \`${route.projectDir}\``);
        return;
      }

      const previousSessionId = sessions[message.channelId]?.sessionId;
      const resumeFlag = previousSessionId ? ` --resume ${previousSessionId}` : "";
      log(`Session: ${previousSessionId ?? "new"}`);
      log(`Debug: cd ${route.projectDir} && claude${resumeFlag}`);
      const stopTyping = startTypingLoop(message.channel);

      const editMode = sessions[message.channelId]?.editMode === true;
      const runOpts = {
        prompt,
        projectDir: route.projectDir,
        dangerouslySkipPermissions: editMode,
        timeoutMs: 10 * 60 * 1000,
        onSpawn: (pid: number) => log(`Claude process started (pid ${pid})`),
        onEvent: (event: StreamJsonEvent) => {
          if (event.type) log(`Event: ${event.type}${event.session_id ? ` session=${event.session_id}` : ""}`);
        },
        onMalformedJson: (line: string, source: "stdout" | "stderr") => {
          console.warn(`[malformed-json][${source}] ${line}`);
        },
      };

      try {
        log("Spawning Claude process...");
        let result;
        try {
          result = await runClaude({ ...runOpts, sessionId: previousSessionId });
        } catch (error) {
          if (previousSessionId && error instanceof ClaudeProcessError && error.details.some((l) => l.includes("already in use"))) {
            log("Session in use, retrying without session ID...");
            setEditMode(sessions, message.channelId, false);
            result = await runClaude({ ...runOpts, dangerouslySkipPermissions: false });
          } else {
            throw error;
          }
        }

        stopTyping();
        log(`Claude finished: ${result.output.length} chars, session ${result.sessionId ?? "none"}`);
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

        if (result.sessionId && isUuid(result.sessionId)) {
          setSession(sessions, message.channelId, result.sessionId);
          saveSessions(paths.sessionsPath, sessions);
          log(`Session saved: ${result.sessionId}`);
        }
      } catch (error) {
        stopTyping();
        log(`Claude error: ${error instanceof Error ? error.message : error}`);
        const formatted = formatCommandError(error);
        const body = `\`\`\`\n${formatted.slice(0, 3900)}\n\`\`\``;
        await message.reply(body);
      }
    });
  });

  const argsPreview = buildClaudeArgs("health-check");
  console.log(`Claude args baseline: ${argsPreview.slice(0, 6).join(" ")}`);

  await client.login(config.token);
}

if (import.meta.main) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
