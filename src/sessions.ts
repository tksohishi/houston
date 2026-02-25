import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface SessionStateEntry {
  sessionId: string;
  lastUsed: string;
  editMode?: boolean;
}

export type SessionState = Record<string, SessionStateEntry>;

export function loadSessions(filePath: string): SessionState {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const output: SessionState = {};
    for (const [channelId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") {
        continue;
      }

      const entry = value as Record<string, unknown>;
      if (typeof entry.sessionId !== "string") {
        continue;
      }

      output[channelId] = {
        sessionId: entry.sessionId,
        lastUsed: typeof entry.lastUsed === "string" ? entry.lastUsed : new Date().toISOString(),
        editMode: entry.editMode === true ? true : undefined,
      };
    }

    return output;
  } catch {
    return {};
  }
}

export function saveSessions(filePath: string, sessions: SessionState): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tempPath = `${filePath}.tmp`;
  const body = JSON.stringify(sessions, null, 2);
  writeFileSync(tempPath, body, "utf8");
  renameSync(tempPath, filePath);
}

export function ensureConfigFilePermissions(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  chmodSync(filePath, 0o600);
}

export function setSession(
  sessions: SessionState,
  channelId: string,
  sessionId: string,
  lastUsed = new Date().toISOString(),
): void {
  const existing = sessions[channelId];
  sessions[channelId] = { sessionId, lastUsed, editMode: existing?.editMode };
}

export function setEditMode(sessions: SessionState, channelId: string, editMode: boolean): void {
  const existing = sessions[channelId];
  if (existing) {
    existing.editMode = editMode || undefined;
  } else {
    sessions[channelId] = { sessionId: "", lastUsed: new Date().toISOString(), editMode: editMode || undefined };
  }
}

export function clearSession(sessions: SessionState, channelId: string): boolean {
  if (!(channelId in sessions)) {
    return false;
  }

  delete sessions[channelId];
  return true;
}
