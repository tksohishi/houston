import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ConstitutionScope, ConstitutionSlot, HoustonConstitution } from "./constitution";
import { userMarkdownDir } from "./constitution";

export interface LoadedContextFile {
  slotId: string;
  scope: ConstitutionScope;
  path: string;
  content: string;
  bytes: number;
}

export interface ContextLoadResult {
  files: LoadedContextFile[];
  totalBytes: number;
}

function isSubPath(baseDir: string, targetDir: string): boolean {
  const normalizedBase = path.resolve(baseDir);
  const normalizedTarget = path.resolve(targetDir);
  const relative = path.relative(normalizedBase, normalizedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function scopeRoot(params: {
  scope: ConstitutionScope;
  configPath: string;
  projectDir: string;
  userId: string;
}): string {
  if (params.scope === "project") {
    return params.projectDir;
  }
  if (params.scope === "user") {
    return userMarkdownDir(params.configPath, params.userId);
  }
  return path.dirname(params.configPath);
}

function resolveSlotPath(slot: ConstitutionSlot, rootDir: string): string {
  const resolvedPath = path.resolve(rootDir, slot.path);
  if (!isSubPath(rootDir, resolvedPath)) {
    throw new Error(`Constitution slot path escapes root for "${slot.id}": ${slot.path}`);
  }
  return resolvedPath;
}

export function loadPromptContext(params: {
  constitution: HoustonConstitution;
  configPath: string;
  projectDir: string;
  userId: string;
}): ContextLoadResult {
  if (params.constitution.slots.length > params.constitution.limits.maxFiles) {
    throw new Error("Constitution slots exceed limits.maxFiles.");
  }

  const files: LoadedContextFile[] = [];
  let totalBytes = 0;

  for (const slot of params.constitution.slots) {
    const rootDir = scopeRoot({
      scope: slot.scope,
      configPath: params.configPath,
      projectDir: params.projectDir,
      userId: params.userId,
    });
    const filePath = resolveSlotPath(slot, rootDir);

    if (!existsSync(filePath)) {
      if (slot.required) {
        throw new Error(`Missing required context file for slot "${slot.id}": ${filePath}`);
      }
      continue;
    }

    const stats = statSync(filePath);
    if (!stats.isFile()) {
      throw new Error(`Context slot "${slot.id}" is not a file: ${filePath}`);
    }
    if (stats.size > params.constitution.limits.maxBytesPerFile) {
      throw new Error(`Context slot "${slot.id}" exceeds maxBytesPerFile: ${filePath}`);
    }

    totalBytes += stats.size;
    if (totalBytes > params.constitution.limits.maxTotalBytes) {
      throw new Error(`Context files exceed maxTotalBytes after slot "${slot.id}".`);
    }

    const content = readFileSync(filePath, "utf8");
    files.push({
      slotId: slot.id,
      scope: slot.scope,
      path: filePath,
      content,
      bytes: stats.size,
    });
  }

  return {
    files,
    totalBytes,
  };
}

export function buildHarnessPromptWithContext(prompt: string, files: LoadedContextFile[]): string {
  if (files.length === 0) {
    return prompt;
  }

  const lines = ["[Houston Context Start]"];
  for (const file of files) {
    lines.push(`## ${file.slotId} (${file.path})`, file.content, "");
  }
  lines.push("[Houston Context End]", "", prompt);
  return lines.join("\n");
}
