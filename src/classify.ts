import { claudeDriver } from "./drivers";

export interface ClassifiedCommand {
  command: "harness" | "edit" | "status" | "setup" | "persona" | "none";
  args?: string;
}

const SYSTEM_PROMPT = `You classify Discord bot commands. Return JSON only.
Commands: harness(claude|codex|gemini), edit(on|off), status, setup(project-name), persona([lang:] description or empty to clear)
If not a command, return {"command":"none"}.

Examples:
"codexに切り替えて" → {"command":"harness","args":"codex"}
"編集モードオン" → {"command":"edit","args":"on"}
"turn off edit mode" → {"command":"edit","args":"off"}
"状態を教えて" → {"command":"status"}
"プロジェクトmy-appをセットアップ" → {"command":"setup","args":"my-app"}
"陽気な海賊のペルソナにして" → {"command":"persona","args":"陽気な海賊"}
"ペルソナをクリア" → {"command":"persona","args":""}
"fix the login bug" → {"command":"none"}`;

const VALID_COMMANDS = new Set(["harness", "edit", "status", "setup", "persona", "none"]);
const TIMEOUT_MS = 5000;

export function parseClassifierResponse(text: string): ClassifiedCommand {
  // Try to extract JSON from the response (may have markdown fences or extra text)
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) return { command: "none" };

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { command: "none" };
  }

  if (!parsed || typeof parsed.command !== "string" || !VALID_COMMANDS.has(parsed.command)) {
    return { command: "none" };
  }

  const result: ClassifiedCommand = { command: parsed.command };
  if (typeof parsed.args === "string") {
    result.args = parsed.args;
  }
  return result;
}

export async function classifyIntent(text: string): Promise<ClassifiedCommand> {
  try {
    const env = claudeDriver.buildEnv({ ...process.env });

    const proc = Bun.spawn(
      [
        "claude",
        "-p",
        "--output-format", "text",
        "--model", "claude-haiku-4-5-20251001",
        "--max-turns", "1",
        "--permission-mode", "dontAsk",
        `${SYSTEM_PROMPT}\n\nClassify: "${text}"`,
      ],
      {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
        env,
      },
    );

    const timeout = setTimeout(() => proc.kill(), TIMEOUT_MS);

    try {
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) return { command: "none" };
      return parseClassifierResponse(output);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return { command: "none" };
  }
}
