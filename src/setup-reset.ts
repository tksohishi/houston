import { existsSync, rmSync } from "node:fs";

export interface ResetOutcome {
  removedConfig: boolean;
  removedSessions: boolean;
}

export interface ResetFileOps {
  exists: (filePath: string) => boolean;
  remove: (filePath: string) => void;
}

const defaultOps: ResetFileOps = {
  exists: (filePath) => existsSync(filePath),
  remove: (filePath) => rmSync(filePath, { force: true }),
};

export function resetConfigAndSessions(
  configPath: string,
  sessionsPath: string,
  ops: ResetFileOps = defaultOps,
): ResetOutcome {
  const removedConfig = ops.exists(configPath);
  if (removedConfig) {
    ops.remove(configPath);
  }

  const removedSessions = ops.exists(sessionsPath);
  if (removedSessions) {
    ops.remove(sessionsPath);
  }

  return {
    removedConfig,
    removedSessions,
  };
}
