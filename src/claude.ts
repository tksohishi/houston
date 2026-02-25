// Re-export from harness.ts for backward compatibility with existing imports.
// New code should import from harness.ts and drivers/ directly.

export {
  type StreamJsonEvent,
  type LineBufferState,
  type ChunkParseResult,
  parseJsonLine,
  parseNdjsonChunk,
  flushNdjsonState,
  splitIncomingChunk,
} from "./harness";

export {
  HarnessProcessError as ClaudeProcessError,
  HarnessTimeoutError as ClaudeTimeoutError,
} from "./harness";

import { claudeDriver } from "./drivers/claude";

export function isUuid(value: string): boolean {
  return claudeDriver.isValidSessionId(value);
}

export function buildClaudeArgs(prompt: string, sessionId?: string, dangerouslySkipPermissions?: boolean): string[] {
  return claudeDriver.buildArgs({
    prompt,
    sessionId,
    editMode: dangerouslySkipPermissions ?? false,
  });
}

export function extractAssistantText(event: Record<string, unknown>): string {
  return claudeDriver.extractAssistantText(event);
}
