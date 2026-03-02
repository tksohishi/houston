import type { HarnessDriver } from "../harness";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const claudeDriver: HarnessDriver = {
  name: "Claude",
  binary: "claude",
  textSeparator: "\n\n",

  buildArgs({ prompt, sessionId, permissionLevel }) {
    const args = [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
    ];

    if (permissionLevel === "yolo") {
      args.push("--dangerously-skip-permissions");
    } else if (permissionLevel === "edit") {
      args.push("--permission-mode", "acceptEdits");
    } else {
      args.push("--permission-mode", "dontAsk");
    }

    if (sessionId && UUID_REGEX.test(sessionId)) {
      args.push("--resume", sessionId);
    }

    args.push(prompt);
    return args;
  },

  buildEnv(env) {
    const result = { ...env };
    delete result.CLAUDECODE;
    delete result.CLAUDE_CODE_ENTRYPOINT;
    return result;
  },

  extractSessionId(event) {
    const sid = event.session_id;
    if (typeof sid === "string" && UUID_REGEX.test(sid)) {
      return sid;
    }
    return undefined;
  },

  extractAssistantText(event) {
    if (event.type !== "assistant") {
      return "";
    }

    const message = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) {
      return "";
    }

    return content
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("");
  },

  extractErrors(event) {
    if (event.type !== "result") {
      return [];
    }

    const errors = event.errors;
    if (!Array.isArray(errors)) {
      return [];
    }

    return errors.filter((value): value is string => typeof value === "string");
  },

  extractPermissionDenials(event) {
    if (event.type !== "result") {
      return [];
    }

    const denials = event.permission_denials;
    if (!Array.isArray(denials)) {
      return [];
    }

    return denials.filter((value): value is string => typeof value === "string");
  },

  isValidSessionId(value) {
    return UUID_REGEX.test(value);
  },
};
