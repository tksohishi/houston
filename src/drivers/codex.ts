import type { HarnessDriver } from "../harness";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const codexDriver: HarnessDriver = {
  name: "Codex",
  binary: "codex",
  textSeparator: "\n\n",

  buildArgs({ prompt, sessionId, editMode }) {
    const args = ["exec", "--json", "--skip-git-repo-check"];

    if (editMode) {
      args.push("--full-auto");
      args.push("-c", "sandbox_workspace_write.network_access=true");
    } else {
      args.push("--sandbox", "read-only");
      args.push("-c", "sandbox_read_only.network_access=true");
    }

    if (sessionId) {
      args.push("resume", sessionId);
    }

    args.push(prompt);
    return args;
  },

  buildEnv(env) {
    return { ...env };
  },

  extractSessionId(event) {
    if (event.type !== "thread.started") {
      return undefined;
    }

    const threadId = event.thread_id;
    if (typeof threadId === "string" && UUID_REGEX.test(threadId)) {
      return threadId;
    }
    return undefined;
  },

  extractAssistantText(event) {
    if (event.type !== "item.completed") {
      return "";
    }

    const item = event.item as { type?: string; text?: string } | undefined;
    if (item?.type !== "agent_message" || typeof item.text !== "string") {
      return "";
    }

    return item.text;
  },

  extractErrors(event) {
    if (event.type === "turn.failed") {
      const message = (event as Record<string, unknown>).message;
      if (typeof message === "string") {
        return [message];
      }
      return ["Turn failed"];
    }

    if (event.type === "error") {
      const message = (event as Record<string, unknown>).message;
      if (typeof message === "string") {
        return [message];
      }
      return ["Unknown error"];
    }

    return [];
  },

  extractPermissionDenials(_event) {
    // Codex CLI has no structured permission denial field
    return [];
  },

  isValidSessionId(value) {
    return UUID_REGEX.test(value);
  },
};
