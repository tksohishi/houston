import type { HarnessDriver } from "../harness";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const geminiDriver: HarnessDriver = {
  name: "Gemini",
  binary: "gemini",
  textSeparator: "",

  buildArgs({ prompt, sessionId, permissionLevel, policyPath }) {
    const args = ["-p", prompt, "-o", "stream-json"];

    if (permissionLevel === "yolo") {
      args.push("--approval-mode", "yolo");
    } else if (permissionLevel === "edit") {
      args.push("--approval-mode", "auto_edit");
    } else if (policyPath) {
      args.push("--approval-mode", "yolo", "--policy", policyPath);
    }

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    return args;
  },

  buildEnv(env) {
    return { ...env };
  },

  extractSessionId(event) {
    if (event.type !== "init") {
      return undefined;
    }

    const sid = event.session_id;
    if (typeof sid === "string" && UUID_REGEX.test(sid)) {
      return sid;
    }
    return undefined;
  },

  extractAssistantText(event) {
    if (event.type !== "message") {
      return "";
    }

    if (event.role !== "assistant" || event.delta !== true) {
      return "";
    }

    const content = event.content;
    if (typeof content === "string") {
      return content;
    }

    return "";
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

  extractPermissionDenials(_event) {
    // Gemini CLI has no structured permission denial field
    return [];
  },

  isValidSessionId(value) {
    // Gemini accepts "latest" or numeric session indices in addition to UUIDs
    if (value === "latest") return true;
    if (/^\d+$/.test(value)) return true;
    return UUID_REGEX.test(value);
  },
};
