export type HarnessName = "claude" | "gemini";

export interface HarnessDriver {
  name: string;
  binary: string;
  textSeparator: string;
  buildArgs(opts: { prompt: string; sessionId?: string; editMode: boolean }): string[];
  buildEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;
  extractSessionId(event: Record<string, unknown>): string | undefined;
  extractAssistantText(event: Record<string, unknown>): string;
  extractErrors(event: Record<string, unknown>): string[];
  extractPermissionDenials(event: Record<string, unknown>): string[];
  isValidSessionId(value: string): boolean;
}

export interface StreamJsonEvent {
  type?: string;
  session_id?: string;
  message?: {
    content?: Array<{ type?: string; text?: string }>;
  };
  errors?: string[];
  [key: string]: unknown;
}

export interface HarnessRunOptions {
  prompt: string;
  projectDir: string;
  driver: HarnessDriver;
  sessionId?: string;
  editMode?: boolean;
  timeoutMs?: number;
  onSpawn?: (pid: number) => void;
  onEvent?: (event: StreamJsonEvent) => void | Promise<void>;
  onMalformedJson?: (line: string, source: "stdout" | "stderr") => void;
}

export interface HarnessRunResult {
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

export class HarnessProcessError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly details: string[],
  ) {
    super(message);
  }
}

export class HarnessTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Harness process timed out after ${timeoutMs}ms`);
  }
}

// NDJSON parsing utilities

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

// Generic harness runner

export async function runHarness(options: HarnessRunOptions): Promise<HarnessRunResult> {
  const { driver } = options;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const args = driver.buildArgs({
    prompt: options.prompt,
    sessionId: options.sessionId,
    editMode: options.editMode ?? false,
  });
  const env = driver.buildEnv({ ...process.env });

  const processHandle = Bun.spawn([driver.binary, ...args], {
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

  const processEvent = async (event: StreamJsonEvent): Promise<void> => {
    eventsSeen += 1;

    const extractedSessionId = driver.extractSessionId(event as Record<string, unknown>);
    if (extractedSessionId && driver.isValidSessionId(extractedSessionId)) {
      sessionId = extractedSessionId;
    }

    const assistantText = driver.extractAssistantText(event as Record<string, unknown>);
    if (assistantText) {
      output += (output && assistantText) ? driver.textSeparator + assistantText : assistantText;
    }

    const resultErrors = driver.extractErrors(event as Record<string, unknown>);
    if (resultErrors.length > 0) {
      errorLines.push(...resultErrors);
    }

    const denials = driver.extractPermissionDenials(event as Record<string, unknown>);
    if (denials.length > 0) {
      permissionDenials.push(...denials);
    }

    await options.onEvent?.(event);
  };

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
          await processEvent(event);
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
      await processEvent(event);
    }
    for (const malformed of flushedStdout.malformed) {
      malformedLines += 1;
      options.onMalformedJson?.(malformed, "stdout");
      errorLines.push(`[stdout] ${malformed}`);
    }

    const flushedStderr = flushNdjsonState(stderrState);
    for (const event of flushedStderr.parsed) {
      await processEvent(event);
    }
    for (const malformed of flushedStderr.malformed) {
      malformedLines += 1;
      options.onMalformedJson?.(malformed, "stderr");
      errorLines.push(`[stderr] ${malformed}`);
    }

    const exitCode = await processHandle.exited;

    if (timeoutTriggered) {
      throw new HarnessTimeoutError(timeoutMs);
    }

    if (exitCode !== 0) {
      throw new HarnessProcessError(`${driver.name} exited with a non zero code`, exitCode, errorLines);
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
