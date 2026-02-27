import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildBotInviteUrl,
  geminiTrustedFoldersPath,
  isValidDiscordId,
  looksLikeDiscordToken,
  trustGeminiFolder,
} from "../src/setup-utils";

describe("setup utility helpers", () => {
  test("validates Discord snowflake IDs", () => {
    expect(isValidDiscordId("123456789012345678")).toBe(true);
    expect(isValidDiscordId("1234")).toBe(false);
    expect(isValidDiscordId("abc123456789012345")).toBe(false);
  });

  test("validates basic token shape", () => {
    expect(looksLikeDiscordToken("abc.def.ghi")).toBe(true);
    expect(looksLikeDiscordToken("abc-def-ghi")).toBe(false);
  });

  test("builds invite URL with required scopes", () => {
    const url = buildBotInviteUrl("123456789012345678");
    expect(url.startsWith("https://discord.com/oauth2/authorize?")).toBe(true);
    expect(url).toContain("client_id=123456789012345678");
    expect(url).toContain("scope=bot");
    expect(url).not.toContain("applications.commands");
    expect(url).toContain("permissions=");
  });

  test("resolves gemini trusted folders path from env override", () => {
    const resolved = geminiTrustedFoldersPath({
      GEMINI_CLI_TRUSTED_FOLDERS_PATH: "~/custom/path/trustedFolders.json",
    } as NodeJS.ProcessEnv, "/Users/tester");

    expect(resolved).toBe("/Users/tester/custom/path/trustedFolders.json");
  });

  test("falls back to default gemini trusted folders path", () => {
    const resolved = geminiTrustedFoldersPath({}, "/Users/tester");
    expect(resolved).toBe(path.join("/Users/tester", ".gemini", "trustedFolders.json"));
  });

  test("writes trust entry with TRUST_PARENT by default", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "houston-setup-utils-"));
    const trustPath = path.join(tmp, "trustedFolders.json");
    const folder = path.join(tmp, "projects");

    const result = trustGeminiFolder(folder, { trustPath });

    expect(result.changed).toBe(true);
    expect(result.setting).toBe("TRUST_PARENT");
    const file = JSON.parse(readFileSync(trustPath, "utf8")) as Record<string, string>;
    expect(file[path.resolve(folder)]).toBe("TRUST_PARENT");
  });

  test("preserves existing entries when adding trust entry", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "houston-setup-utils-"));
    const trustPath = path.join(tmp, "trustedFolders.json");
    const existingFolder = path.join(tmp, "existing");
    writeFileSync(
      trustPath,
      JSON.stringify({
        [path.resolve(existingFolder)]: "TRUST_FOLDER",
      }),
      "utf8",
    );

    const folder = path.join(tmp, "projects");
    trustGeminiFolder(folder, { trustPath, setting: "TRUST_PARENT" });

    const file = JSON.parse(readFileSync(trustPath, "utf8")) as Record<string, string>;
    expect(file[path.resolve(existingFolder)]).toBe("TRUST_FOLDER");
    expect(file[path.resolve(folder)]).toBe("TRUST_PARENT");
  });

  test("returns unchanged when trust entry is already set", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "houston-setup-utils-"));
    const trustPath = path.join(tmp, "trustedFolders.json");
    const folder = path.join(tmp, "projects");
    writeFileSync(
      trustPath,
      JSON.stringify({
        [path.resolve(folder)]: "TRUST_PARENT",
      }),
      "utf8",
    );

    const result = trustGeminiFolder(folder, { trustPath, setting: "TRUST_PARENT" });
    expect(result.changed).toBe(false);
  });
});
