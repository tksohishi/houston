import path from "node:path";

export const WORKSPACE_DEFAULTS_DIR_NAME = "workspace-defaults";

export const AGENTS_FILE_NAME = "AGENTS.md";
export const PERSONA_LANG_FILE_NAME = "PERSONA.LANG.md";
export const CONTEXT_FILE_NAME = "CONTEXT.md";
export const SKILLS_FILE_NAME = "SKILLS.md";

export const DEFAULT_AGENTS_MD = [
  "# Houston Workspace Rules",
  "",
  "## Session Start",
  "1. Read CONTEXT.md and SKILLS.md before making decisions.",
  "2. Read PERSONA.LANG.md and select the section that matches the user language.",
  "3. If no matching language is defined, use EN.",
  "4. Treat CONTEXT.md as semi-private and do not reveal it unless asked.",
  "",
  "## File Map",
  "- PERSONA.LANG.md: language-specific persona profiles.",
  "- CONTEXT.md: user background, preferences, and constraints.",
  "- SKILLS.md: repeatable workflows and command snippets.",
  "- AGENTS.md: top-level behavior and safety rules.",
  "",
  "## Safety",
  "- Do not exfiltrate secrets or semi-private context.",
  "- Ask before destructive commands.",
  "- Keep responses concise in chat; write long artifacts to files when useful.",
  "",
].join("\n");

export const DEFAULT_PERSONA_LANG_MD = [
  "# Persona Profiles",
  "",
  "Store one persona section per language code.",
  "Examples: EN, JA, ES.",
  "",
  "## EN",
  "Pragmatic and concise. Explain trade-offs and provide actionable next steps.",
  "",
].join("\n");

export const DEFAULT_CONTEXT_MD = [
  "# User Context",
  "",
  "## Profile",
  "- Name:",
  "- Timezone:",
  "- Working hours:",
  "",
  "## Preferences",
  "- Communication style:",
  "- Preferred tools:",
  "- Coding conventions:",
  "",
  "## Sensitive Context",
  "- Keep semi-private information here.",
  "- Avoid copying this content into public channels.",
  "",
].join("\n");

export const DEFAULT_SKILLS_MD = [
  "# Reusable Skills",
  "",
  "Use this file for tasks that repeat often.",
  "",
  "## Template",
  "### skill-name",
  "- Trigger:",
  "- Steps:",
  "- Commands:",
  "- Notes:",
  "",
].join("\n");

export const WORKSPACE_DEFAULT_TEMPLATES = {
  [AGENTS_FILE_NAME]: DEFAULT_AGENTS_MD,
  [PERSONA_LANG_FILE_NAME]: DEFAULT_PERSONA_LANG_MD,
  [CONTEXT_FILE_NAME]: DEFAULT_CONTEXT_MD,
  [SKILLS_FILE_NAME]: DEFAULT_SKILLS_MD,
} as const;

export type WorkspaceDefaultFileName = keyof typeof WORKSPACE_DEFAULT_TEMPLATES;

export const WORKSPACE_DEFAULT_FILE_NAMES = Object.keys(
  WORKSPACE_DEFAULT_TEMPLATES,
) as WorkspaceDefaultFileName[];

export function workspaceDefaultsDir(configPath: string): string {
  return path.join(path.dirname(configPath), WORKSPACE_DEFAULTS_DIR_NAME);
}
