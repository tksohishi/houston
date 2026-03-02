import { readFileSync } from "node:fs";
import path from "node:path";

export const CONSTITUTION_FILE_NAME = "constitution.json";
export const USER_MARKDOWNS_DIR_NAME = "users";
export const DEFAULT_USER_CONTEXT_FILE_NAME = "CONTEXT.md";

export type ConstitutionScope = "global" | "user" | "project";

export interface ConstitutionSlot {
  id: string;
  scope: ConstitutionScope;
  path: string;
  required: boolean;
}

export interface ConstitutionLimits {
  maxBytesPerFile: number;
  maxTotalBytes: number;
  maxFiles: number;
}

export interface HoustonConstitution {
  version: 1;
  slots: ConstitutionSlot[];
  limits: ConstitutionLimits;
}

const SLOT_ID_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const DEFAULT_LIMITS: ConstitutionLimits = {
  maxBytesPerFile: 20_000,
  maxTotalBytes: 120_000,
  maxFiles: 16,
};

export const DEFAULT_CONSTITUTION: HoustonConstitution = {
  version: 1,
  slots: [
    { id: "agents", scope: "project", path: "AGENTS.md", required: true },
    { id: "persona", scope: "project", path: "PERSONA.LANG.md", required: false },
    { id: "user-context", scope: "user", path: "CONTEXT.md", required: false },
    { id: "project-context", scope: "project", path: "CONTEXT.md", required: false },
    { id: "skills", scope: "project", path: "SKILLS.md", required: false },
  ],
  limits: DEFAULT_LIMITS,
};

function isConstitutionScope(value: unknown): value is ConstitutionScope {
  return value === "global" || value === "user" || value === "project";
}

export function normalizeConstitutionRelativePath(value: string): string {
  const normalizedInput = value.trim().replace(/\\/g, "/");
  if (!normalizedInput) {
    throw new Error("constitution slot path is empty");
  }
  if (/^[A-Za-z]:\//.test(normalizedInput) || path.posix.isAbsolute(normalizedInput)) {
    throw new Error(`constitution slot path must be relative: ${value}`);
  }

  const normalized = path.posix.normalize(normalizedInput).replace(/^\.\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`constitution slot path escapes scope root: ${value}`);
  }

  return normalized;
}

function parseLimits(value: unknown): ConstitutionLimits {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_LIMITS };
  }

  const raw = value as Record<string, unknown>;
  const maxBytesPerFile = typeof raw.maxBytesPerFile === "number" ? raw.maxBytesPerFile : DEFAULT_LIMITS.maxBytesPerFile;
  const maxTotalBytes = typeof raw.maxTotalBytes === "number" ? raw.maxTotalBytes : DEFAULT_LIMITS.maxTotalBytes;
  const maxFiles = typeof raw.maxFiles === "number" ? raw.maxFiles : DEFAULT_LIMITS.maxFiles;

  if (!Number.isInteger(maxBytesPerFile) || maxBytesPerFile < 1) {
    throw new Error("constitution limits.maxBytesPerFile must be a positive integer");
  }
  if (!Number.isInteger(maxTotalBytes) || maxTotalBytes < 1) {
    throw new Error("constitution limits.maxTotalBytes must be a positive integer");
  }
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new Error("constitution limits.maxFiles must be a positive integer");
  }
  if (maxTotalBytes < maxBytesPerFile) {
    throw new Error("constitution limits.maxTotalBytes must be >= limits.maxBytesPerFile");
  }

  return {
    maxBytesPerFile,
    maxTotalBytes,
    maxFiles,
  };
}

function parseSlots(value: unknown): ConstitutionSlot[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("constitution slots must be a non-empty array");
  }

  const slots: ConstitutionSlot[] = [];
  const seenIds = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      throw new Error("constitution slot must be an object");
    }
    const raw = entry as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!SLOT_ID_REGEX.test(id)) {
      throw new Error(`invalid constitution slot id: ${String(raw.id ?? "")}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`duplicate constitution slot id: ${id}`);
    }
    seenIds.add(id);

    if (!isConstitutionScope(raw.scope)) {
      throw new Error(`invalid constitution slot scope for "${id}"`);
    }

    const slotPath = typeof raw.path === "string" ? normalizeConstitutionRelativePath(raw.path) : "";
    if (!slotPath) {
      throw new Error(`constitution slot "${id}" has empty path`);
    }

    if (typeof raw.required !== "boolean") {
      throw new Error(`constitution slot "${id}" must define required as boolean`);
    }

    slots.push({
      id,
      scope: raw.scope,
      path: slotPath,
      required: raw.required,
    });
  }

  return slots;
}

export function validateConstitution(value: unknown): HoustonConstitution {
  if (!value || typeof value !== "object") {
    throw new Error("constitution must contain a JSON object");
  }

  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new Error("constitution version must be 1");
  }

  const limits = parseLimits(raw.limits);
  const slots = parseSlots(raw.slots);
  if (slots.length > limits.maxFiles) {
    throw new Error("constitution slots count exceeds limits.maxFiles");
  }

  return {
    version: 1,
    slots,
    limits,
  };
}

export function loadConstitutionFromPath(filePath: string): HoustonConstitution {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return validateConstitution(parsed);
}

export function defaultConstitutionPath(configPath: string): string {
  return path.join(path.dirname(configPath), CONSTITUTION_FILE_NAME);
}

export function userMarkdownsRootDir(configPath: string): string {
  return path.join(path.dirname(configPath), USER_MARKDOWNS_DIR_NAME);
}

export function userMarkdownDir(configPath: string, userId: string): string {
  const normalized = userId.trim();
  if (!/^\d{5,30}$/.test(normalized)) {
    throw new Error(`invalid user id for user markdown directory: ${userId}`);
  }
  return path.join(userMarkdownsRootDir(configPath), normalized);
}

export function serializeConstitution(constitution: HoustonConstitution): string {
  return JSON.stringify(constitution, null, 2);
}
