import { describe, expect, test } from "bun:test";
import { buildBotInviteUrl, isValidDiscordId, looksLikeDiscordToken } from "../src/setup-utils";

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
});
