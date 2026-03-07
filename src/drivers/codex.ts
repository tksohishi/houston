import type { HarnessDriver } from "../harness";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FINAL_RESPONSE_ONLY_INSTRUCTION =
  "Respond with the final answer only. Do not include planning notes, progress updates, or internal reasoning.";

function withFinalResponseOnlyInstruction(prompt: string): string {
  return `${prompt}\n\n${FINAL_RESPONSE_ONLY_INSTRUCTION}`;
}

export const codexDriver: HarnessDriver = {
  name: "Codex",
  binary: "codex",
  textSeparator: "\n\n",
  assistantTextMode: "latest",

  buildArgs({ prompt, sessionId, permissionLevel }) {
    const args = ["exec", "--json", "--skip-git-repo-check"];

    if (permissionLevel === "yolo") {
      args.push("--full-auto");
      args.push("-c", "sandbox_workspace_write.network_access=true");
    } else if (permissionLevel === "edit") {
      args.push("--sandbox", "workspace-write");
      args.push("-c", "sandbox_workspace_write.network_access=true");
    } else {
      args.push("--sandbox", "read-only");
      args.push("-c", "sandbox_read_only.network_access=true");
    }

    if (sessionId) {
      args.push("resume", sessionId);
    }

    args.push(withFinalResponseOnlyInstruction(prompt));
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

    const item = event.item as { type?: string; text?: string; phase?: string } | undefined;
    if (item?.type !== "agent_message" || typeof item.text !== "string") {
      return "";
    }

    if (item.phase && item.phase !== "final") {
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

  summarizeEvent(event) {
    const lines: string[] = [];
    const type = event.type as string | undefined;
    const item = event.item as { type?: string; phase?: string; text?: string } | undefined;
    const itemDetail = item ? ` ${item.type ?? ""}${item.phase ? ` phase=${item.phase}` : ""}` : "";
    if (type) lines.push(`Event: ${type}${itemDetail}`);

    if (type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
      lines.push(`Agent message: (${item.text.length} chars) ${item.text.slice(0, 200)}`);
    }

    return lines;
  },
};
