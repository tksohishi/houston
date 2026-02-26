import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HarnessName } from "./harness";
import { isHarnessName } from "./drivers";

export interface SessionStateEntry {
  sessionId: string;
  lastUsed: string;
  editMode?: boolean;
  projectDir?: string;
  harness?: HarnessName;
  lastPrompt?: string;
  lastOutput?: string;
  lastResponseAt?: string;
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
        projectDir: typeof entry.projectDir === "string" ? entry.projectDir : undefined,
        harness: typeof entry.harness === "string" && isHarnessName(entry.harness) ? entry.harness : undefined,
        lastPrompt: typeof entry.lastPrompt === "string" ? entry.lastPrompt : undefined,
        lastOutput: typeof entry.lastOutput === "string" ? entry.lastOutput : undefined,
        lastResponseAt: typeof entry.lastResponseAt === "string" ? entry.lastResponseAt : undefined,
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
  sessions[channelId] = {
    sessionId,
    lastUsed,
    editMode: existing?.editMode,
    projectDir: existing?.projectDir,
    harness: existing?.harness,
    lastPrompt: existing?.lastPrompt,
    lastOutput: existing?.lastOutput,
    lastResponseAt: existing?.lastResponseAt,
  };
}

export function setEditMode(sessions: SessionState, channelId: string, editMode: boolean): void {
  const existing = sessions[channelId];
  if (existing) {
    existing.editMode = editMode || undefined;
  } else {
    sessions[channelId] = { sessionId: "", lastUsed: new Date().toISOString(), editMode: editMode || undefined };
  }
}

export function setProjectDir(sessions: SessionState, channelId: string, projectDir: string): void {
  const existing = sessions[channelId];
  if (existing) {
    existing.projectDir = projectDir;
    existing.sessionId = "";
    existing.lastPrompt = undefined;
    existing.lastOutput = undefined;
    existing.lastResponseAt = undefined;
  } else {
    sessions[channelId] = { sessionId: "", lastUsed: new Date().toISOString(), projectDir };
  }
}

export function setHarness(sessions: SessionState, channelId: string, harness: HarnessName): void {
  const existing = sessions[channelId];
  if (existing) {
    existing.harness = harness;
    existing.sessionId = "";
    existing.editMode = undefined;
    existing.lastPrompt = undefined;
    existing.lastOutput = undefined;
    existing.lastResponseAt = undefined;
  } else {
    sessions[channelId] = { sessionId: "", lastUsed: new Date().toISOString(), harness };
  }
}

export function setLastResponse(
  sessions: SessionState,
  channelId: string,
  prompt: string,
  output: string,
  lastResponseAt = new Date().toISOString(),
): void {
  const existing = sessions[channelId];
  if (existing) {
    existing.lastPrompt = prompt;
    existing.lastOutput = output;
    existing.lastResponseAt = lastResponseAt;
    return;
  }

  sessions[channelId] = {
    sessionId: "",
    lastUsed: lastResponseAt,
    lastPrompt: prompt,
    lastOutput: output,
    lastResponseAt,
  };
}

export function clearSession(sessions: SessionState, channelId: string): boolean {
  if (!(channelId in sessions)) {
    return false;
  }

  delete sessions[channelId];
  return true;
}
