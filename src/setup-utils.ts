import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

const DISCORD_ID_REGEX = /^\d{17,20}$/;
const DISCORD_TOKEN_SEGMENT = /[A-Za-z0-9._-]+/;
const DISCORD_TOKEN_REGEX = new RegExp(`^${DISCORD_TOKEN_SEGMENT.source}\\.${DISCORD_TOKEN_SEGMENT.source}\\.${DISCORD_TOKEN_SEGMENT.source}$`);

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
