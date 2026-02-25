const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StreamJsonEvent {
  type?: string;
  session_id?: string;
  message?: {
    content?: Array<{ type?: string; text?: string }>;
  };
  errors?: string[];
  [key: string]: unknown;
}

export interface ClaudeRunOptions {
  prompt: string;
  projectDir: string;
  sessionId?: string;
  dangerouslySkipPermissions?: boolean;
  timeoutMs?: number;
  onSpawn?: (pid: number) => void;
  onEvent?: (event: StreamJsonEvent) => void | Promise<void>;
  onMalformedJson?: (line: string, source: "stdout" | "stderr") => void;
}

export interface ClaudeRunResult {
  exitCode: number;
  sessionId?: string;
  output: string;
  eventsSeen: number;
  malformedLines: number;
  errorLines: string[];
  permissionDenials: string[];
}

export interface LineBufferState {
  remaining: string;
}

export interface ChunkParseResult {
  parsed: StreamJsonEvent[];
  malformed: string[];
}

export class ClaudeProcessError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly details: string[],
  ) {
    super(message);
  }
}

export class ClaudeTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Claude process timed out after ${timeoutMs}ms`);
  }
}

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function buildClaudeArgs(prompt: string, sessionId?: string, dangerouslySkipPermissions?: boolean): string[] {
  const args = [
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
  ];

  if (dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", "dontAsk");
  }

  if (sessionId && isUuid(sessionId)) {
    args.push("--resume", sessionId);
  }

  args.push(prompt);
  return args;
}

export function splitIncomingChunk(state: LineBufferState, chunk: string): string[] {
  const text = state.remaining + chunk;
  const lines: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      lines.push(text.slice(start, i));
      start = i + 1;
    }
  }

  state.remaining = text.slice(start);
  return lines;
}

export function parseJsonLine(line: string): { ok: true; event: StreamJsonEvent } | { ok: false } {
  const trimmed = line.trim();
  if (!trimmed) {
    return { ok: false };
  }

  try {
    const parsed = JSON.parse(trimmed) as StreamJsonEvent;
    return { ok: true, event: parsed };
  } catch {
    return { ok: false };
  }
}

export function parseNdjsonChunk(state: LineBufferState, chunk: string): ChunkParseResult {
  const lines = splitIncomingChunk(state, chunk);
  const parsed: StreamJsonEvent[] = [];
  const malformed: string[] = [];

  for (const line of lines) {
    const result = parseJsonLine(line);
    if (result.ok) {
      parsed.push(result.event);
      continue;
    }

    if (line.trim().length > 0) {
      malformed.push(line);
    }
  }

  return { parsed, malformed };
}

export function flushNdjsonState(state: LineBufferState): ChunkParseResult {
  if (!state.remaining.trim()) {
    return { parsed: [], malformed: [] };
  }

  const trailing = state.remaining;
  const result = parseJsonLine(trailing);
  state.remaining = "";
  if (result.ok) {
    return { parsed: [result.event], malformed: [] };
  }

  return { parsed: [], malformed: [trailing] };
}

export function extractAssistantText(event: StreamJsonEvent): string {
  if (event.type !== "assistant") {
    return "";
  }

  const content = event.message?.content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("");
}

function extractPermissionDenials(event: StreamJsonEvent): string[] {
  if (event.type !== "result") {
    return [];
  }

  const denials = (event as Record<string, unknown>).permission_denials;
  if (!Array.isArray(denials)) {
    return [];
  }

  return denials.filter((value): value is string => typeof value === "string");
}

function extractResultErrors(event: StreamJsonEvent): string[] {
  if (event.type !== "result") {
    return [];
  }

  if (!Array.isArray(event.errors)) {
    return [];
  }

  return event.errors.filter((value): value is string => typeof value === "string");
}

export async function runClaude(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const args = buildClaudeArgs(options.prompt, options.sessionId, options.dangerouslySkipPermissions);

  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const processHandle = Bun.spawn(["claude", ...args], {
    cwd: options.projectDir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  if (processHandle.pid != null) {
    options.onSpawn?.(processHandle.pid);
  }

  let timeoutTriggered = false;
  const timeout = setTimeout(() => {
    timeoutTriggered = true;
    processHandle.kill();
  }, timeoutMs);

  let output = "";
  let eventsSeen = 0;
  let malformedLines = 0;
  let sessionId = options.sessionId;
  const errorLines: string[] = [];
  const permissionDenials: string[] = [];

  const stdoutState: LineBufferState = { remaining: "" };
  const stderrState: LineBufferState = { remaining: "" };
  const decoder = new TextDecoder();

  const consumeStream = async (
    stream: ReadableStream<Uint8Array> | null,
    source: "stdout" | "stderr",
    state: LineBufferState,
  ): Promise<void> => {
    if (!stream) {
      return;
    }

    const reader = stream.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }

        const text = decoder.decode(next.value, { stream: true });
        const parsedChunk = parseNdjsonChunk(state, text);

        for (const malformed of parsedChunk.malformed) {
          malformedLines += 1;
          options.onMalformedJson?.(malformed, source);
          errorLines.push(`[${source}] ${malformed}`);
        }

        for (const event of parsedChunk.parsed) {
          eventsSeen += 1;
          if (typeof event.session_id === "string" && isUuid(event.session_id)) {
            sessionId = event.session_id;
          }

          const assistantText = extractAssistantText(event);
          if (assistantText) {
            output += (output && assistantText) ? "\n\n" + assistantText : assistantText;
          }

          const resultErrors = extractResultErrors(event);
          if (resultErrors.length > 0) {
            errorLines.push(...resultErrors);
          }

          const denials = extractPermissionDenials(event);
          if (denials.length > 0) {
            permissionDenials.push(...denials);
          }

          await options.onEvent?.(event);
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  try {
    await Promise.all([
      consumeStream(processHandle.stdout, "stdout", stdoutState),
      consumeStream(processHandle.stderr, "stderr", stderrState),
    ]);

    const flushedStdout = flushNdjsonState(stdoutState);
    for (const event of flushedStdout.parsed) {
      eventsSeen += 1;
      const assistantText = extractAssistantText(event);
      if (assistantText) {
        output += (output && assistantText) ? "\n\n" + assistantText : assistantText;
      }
      await options.onEvent?.(event);
    }
    for (const malformed of flushedStdout.malformed) {
      malformedLines += 1;
      options.onMalformedJson?.(malformed, "stdout");
      errorLines.push(`[stdout] ${malformed}`);
    }

    const flushedStderr = flushNdjsonState(stderrState);
    for (const event of flushedStderr.parsed) {
      eventsSeen += 1;
      const assistantText = extractAssistantText(event);
      if (assistantText) {
        output += (output && assistantText) ? "\n\n" + assistantText : assistantText;
      }
      await options.onEvent?.(event);
    }
    for (const malformed of flushedStderr.malformed) {
      malformedLines += 1;
      options.onMalformedJson?.(malformed, "stderr");
      errorLines.push(`[stderr] ${malformed}`);
    }

    const exitCode = await processHandle.exited;

    if (timeoutTriggered) {
      throw new ClaudeTimeoutError(timeoutMs);
    }

    if (exitCode !== 0) {
      throw new ClaudeProcessError("Claude exited with a non zero code", exitCode, errorLines);
    }

    return {
      exitCode,
      sessionId,
      output,
      eventsSeen,
      malformedLines,
      errorLines,
      permissionDenials,
    };
  } finally {
    clearTimeout(timeout);
  }
}
