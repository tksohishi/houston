import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

const DISCORD_ID_REGEX = /^\d{17,20}$/;
const DISCORD_TOKEN_SEGMENT = /[A-Za-z0-9._-]+/;
const DISCORD_TOKEN_REGEX = new RegExp(`^${DISCORD_TOKEN_SEGMENT.source}\\.${DISCORD_TOKEN_SEGMENT.source}\\.${DISCORD_TOKEN_SEGMENT.source}$`);
const GEMINI_TRUSTED_FOLDERS_PATH_ENV = "GEMINI_CLI_TRUSTED_FOLDERS_PATH";
const GEMINI_DEFAULT_TRUSTED_FOLDERS_PATH = path.join(".gemini", "trustedFolders.json");

type GeminiTrustedFolderSetting = "TRUST_FOLDER" | "TRUST_PARENT" | "DO_NOT_TRUST";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isObjectRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePathWithHome(value: string, home: string): string {
  if (value === "~") {
    return home;
  }
  if (value.startsWith("~/")) {
    return path.join(home, value.slice(2));
  }
  return path.resolve(value);
}

function loadTrustedFolders(filePath: string): Record<string, JsonValue> {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return {};
  }

  const parsed: JsonValue = JSON.parse(raw);
  if (!isObjectRecord(parsed)) {
    throw new Error("Gemini trusted folders file must contain a JSON object.");
  }

  return parsed;
}

export function geminiTrustedFoldersPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const configuredPath = env[GEMINI_TRUSTED_FOLDERS_PATH_ENV];
  if (typeof configuredPath === "string" && configuredPath.trim().length > 0) {
    return resolvePathWithHome(configuredPath.trim(), home);
  }
  return path.join(home, GEMINI_DEFAULT_TRUSTED_FOLDERS_PATH);
}

export function trustGeminiFolder(
  folderPath: string,
  options?: {
    trustPath?: string;
    setting?: GeminiTrustedFolderSetting;
  },
): { trustPath: string; setting: GeminiTrustedFolderSetting; changed: boolean } {
  const trustPath = options?.trustPath ?? geminiTrustedFoldersPath();
  const setting = options?.setting ?? "TRUST_PARENT";
  const resolvedFolderPath = path.resolve(folderPath);
  const trustedFolders = loadTrustedFolders(trustPath);

  const existingSetting = trustedFolders[resolvedFolderPath];
  const changed = existingSetting !== setting;
  if (changed) {
    trustedFolders[resolvedFolderPath] = setting;
    mkdirSync(path.dirname(trustPath), { recursive: true });
    writeFileSync(trustPath, JSON.stringify(trustedFolders, null, 2), "utf8");
  }

  return {
    trustPath,
    setting,
    changed,
  };
}

export function isValidDiscordId(value: string): boolean {
  return DISCORD_ID_REGEX.test(value.trim());
}

export function looksLikeDiscordToken(value: string): boolean {
  return DISCORD_TOKEN_REGEX.test(value.trim());
}

export function buildBotInviteUrl(applicationId: string): string {
  const permissions = new PermissionsBitField([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ]).bitfield.toString();

  const params = new URLSearchParams({
    client_id: applicationId,
    scope: "bot",
    permissions,
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
