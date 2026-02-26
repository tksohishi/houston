import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { REST, Routes } from "discord.js";
import { defaultConfigPath, defaultSessionsPath, defaults, expandHomePath } from "../src/config";
import { parseSetupFlags } from "../src/setup-flags";
import { resetConfigAndSessions } from "../src/setup-reset";
import { buildBotInviteUrl, isValidDiscordId, looksLikeDiscordToken } from "../src/setup-utils";

const SUPPORTED_HARNESSES = ["claude", "codex", "gemini"] as const;

function withDefault(value: string, fallback: string): string {
  return value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeYesNo(value: string, defaultYes: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultYes;
  }
  if (normalized === "y" || normalized === "yes") {
    return true;
  }
  if (normalized === "n" || normalized === "no") {
    return false;
  }
  return defaultYes;
}

async function promptRequired(
  ask: (text: string) => Promise<string>,
  prompt: string,
): Promise<string> {
  while (true) {
    const response = (await ask(prompt)).trim();
    if (response.length > 0) {
      return response;
    }
    console.log("Value is required.");
  }
}

async function promptDiscordId(
  ask: (text: string) => Promise<string>,
  prompt: string,
): Promise<string> {
  while (true) {
    const value = await promptRequired(ask, prompt);
    if (isValidDiscordId(value)) {
      return value;
    }
    console.log("ID should be a Discord snowflake, expected 17 to 20 digits.");
  }
}

async function promptToken(
  ask: (text: string) => Promise<string>,
): Promise<string> {
  while (true) {
    const token = await promptRequired(ask, "Discord bot token: ");
    if (looksLikeDiscordToken(token)) {
      return token;
    }
    const proceed = await ask("Token format looks unusual. Continue anyway? [y/N]: ");
    if (normalizeYesNo(proceed, false)) {
      return token;
    }
  }
}

async function waitForEnter(ask: (text: string) => Promise<string>): Promise<void> {
  await ask("Press Enter to continue: ");
}

async function validateToken(token: string): Promise<{ ok: boolean; tag?: string; reason?: string }> {
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    const user = await rest.get(Routes.user());
    if (!user || typeof user !== "object") {
      return { ok: false, reason: "Discord returned an unexpected response." };
    }
    const data = user as { username?: string; discriminator?: string; id?: string };
    const discriminator = data.discriminator && data.discriminator !== "0" ? `#${data.discriminator}` : "";
    const tag = `${data.username ?? "unknown"}${discriminator} (${data.id ?? "unknown"})`;
    return { ok: true, tag };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = (text: string) => rl.question(text);

  try {
    const flags = parseSetupFlags(process.argv.slice(2));
    const defaultConfig = defaultConfigPath();
    const defaultSessions = defaultSessionsPath();
    const defaultBaseDir = path.join(homedir(), "projects");

    if (flags.reset) {
      const shouldReset = flags.yes
        ? true
        : normalizeYesNo(
            await ask(
              `Reset config at ${defaultConfig} and sessions at ${defaultSessions}? [y/N]: `,
            ),
            false,
          );

      if (!shouldReset) {
        throw new Error("Setup aborted, reset not confirmed.");
      }

      const outcome = resetConfigAndSessions(defaultConfig, defaultSessions);
      console.log("");
      console.log(`Reset complete, config removed: ${outcome.removedConfig ? "yes" : "no"}`);
      console.log(`Reset complete, sessions removed: ${outcome.removedSessions ? "yes" : "no"}`);
      console.log("");
      console.log("Discord cleanup checklist:");
      console.log("1. Server Settings > Integrations > Bots and Apps, remove Houston bot if no longer needed.");
      console.log("2. Discord Developer Portal > Bot, reset token if credentials were exposed.");
      console.log("3. Review channel permissions so only trusted members can post.");

      if (flags.resetOnly) {
        console.log("Reset only mode finished.");
        return;
      }
      console.log("");
    }

    console.log("Houston setup wizard");
    console.log("");

    if (existsSync(defaultConfig)) {
      console.log(`Existing config found at ${defaultConfig}`);
      const reconfigure = await ask("Reconfigure? [y/N]: ");
      if (!normalizeYesNo(reconfigure, false)) {
        console.log("Setup cancelled.");
        return;
      }
      console.log("");
    } else {
      console.log("This wizard covers Discord setup plus local config.");
      console.log("");
      console.log("Discord checklist:");
      console.log("1. Open https://discord.com/developers/applications");
      console.log("2. Create an application, open the Bot tab, click Add Bot.");
      console.log("3. In Bot settings, enable Message Content Intent.");
      console.log("   Without this, Discord sends empty messages and Houston can't read prompts.");
      console.log("4. In Discord app settings, enable Developer Mode.");
      console.log("   This lets you right-click to copy IDs like the application ID.");
      console.log("5. Copy the bot token: Bot tab > Reset Token > copy the value.");
      console.log("   Copy the application ID: General Information tab > Application ID > Copy.");
      console.log("   The token authenticates the bot; the app ID generates the invite URL.");
      console.log("");
      await waitForEnter(ask);
    }

    const token = await promptToken(ask);
    const applicationId = await promptDiscordId(ask, "Discord application ID: ");

    const inviteUrl = buildBotInviteUrl(applicationId);
    console.log("");
    console.log("Invite URL:");
    console.log(inviteUrl);
    console.log("Open the URL, pick the target server, complete authorization.");
    await waitForEnter(ask);

    const tokenCheck = await validateToken(token);
    if (tokenCheck.ok) {
      console.log(`Token validation passed for bot user: ${tokenCheck.tag}`);
    } else {
      console.log(`Token validation failed: ${tokenCheck.reason ?? "unknown reason"}`);
      const keepGoing = await ask("Continue setup anyway? [y/N]: ");
      if (!normalizeYesNo(keepGoing, false)) {
        throw new Error("Setup aborted due to failed token validation.");
      }
    }

    const configPathInput = await ask(`Config path [${defaultConfig}]: `);
    const configPath = path.resolve(expandHomePath(withDefault(configPathInput, defaultConfig)));

    console.log("");
    console.log(`Default harness: ${SUPPORTED_HARNESSES.join(", ")}`);
    const harnessInput = await ask(`Default harness [${defaults.defaultHarness}]: `);
    const defaultHarness = withDefault(harnessInput, defaults.defaultHarness);
    if (!SUPPORTED_HARNESSES.includes(defaultHarness as typeof SUPPORTED_HARNESSES[number])) {
      console.log(`Warning: "${defaultHarness}" is not a recognized harness. Using "${defaults.defaultHarness}".`);
    }
    const harness = SUPPORTED_HARNESSES.includes(defaultHarness as typeof SUPPORTED_HARNESSES[number])
      ? defaultHarness
      : defaults.defaultHarness;

    let baseDir: string;
    while (true) {
      const baseDirInput = await ask(`Base project directory [${defaultBaseDir}]: `);
      baseDir = path.resolve(expandHomePath(withDefault(baseDirInput, defaultBaseDir)));
      if (existsSync(baseDir) && statSync(baseDir).isDirectory()) {
        break;
      }
      console.log(`Directory does not exist: ${baseDir}`);
      console.log("Please enter a valid directory path.");
    }

    const sessionsPath = path.resolve(expandHomePath(defaultSessions));
    const configBody = JSON.stringify(
      {
        token,
        applicationId,
        defaultHarness: harness,
        baseDir,
      },
      null,
      2,
    );

    mkdirSync(path.dirname(configPath), { recursive: true });
    mkdirSync(path.dirname(sessionsPath), { recursive: true });
    writeFileSync(configPath, configBody, "utf8");
    chmodSync(configPath, 0o600);

    console.log("");
    console.log(`Wrote config to ${configPath}`);
    console.log(`Sessions file will be stored at ${sessionsPath}`);
    console.log("Use --sessions or HOUSTON_SESSIONS to override the sessions path.");
    console.log("Use `bun run setup -- --reset` for clean reset during testing.");
    console.log("Houston runs only when someone mentions the bot in a watched channel.");
    console.log("Run `bun run start` to launch Houston.");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
