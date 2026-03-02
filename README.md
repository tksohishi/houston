# Houston

Houston is a remote command center for AI coding agents, operated through Discord. It supports multiple harnesses (Claude Code, Gemini CLI, Codex CLI) and binds Discord channels to local project directories.

## Prerequisites

- [Bun](https://bun.sh/)
- [gitleaks](https://github.com/gitleaks/gitleaks)
- At least one supported CLI installed and authenticated:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
  - [Codex CLI](https://github.com/openai/codex) (`codex`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)
- A private Discord server

## Setup Flow

1. Bootstrap local development:
   - `bun run bootstrap`
   - installs dependencies and sets `.git/hooks/pre-commit` to run `gitleaks git --staged`
2. Run setup:
   - `bun run setup`
   - clean reset first: `bun run reset`
3. Setup wizard guides Discord setup end to end:
   - Discord developer portal steps
   - required bot settings (Message Content Intent)
   - invite URL generation
   - token and application ID prompts with validation
   - default harness selection (claude, codex, or gemini)
   - optional app-level markdown defaults (`AGENTS.md`, `PERSONA.LANG.md`, `CONTEXT.md`, `SKILLS.md`)
   - optional constitution file (`constitution.json`) and per-user markdown root (`users/<discord-user-id>/CONTEXT.md`)
   - optional Gemini trusted folder update for selected base directory
   - optional Gemini policy files for edit-off mode
4. Setup writes config to `${XDG_CONFIG_HOME:-~/.config}/houston/config.json` by default.
5. Setup can create `${XDG_CONFIG_HOME:-~/.config}/houston/policies/gemini/*.toml`.
6. Sessions are stored at `${XDG_STATE_HOME:-~/.local/state}/houston/sessions.json` by default.

## Channel Binding

Channels are explicitly bound to projects via the `/setup` command:

```
@Houston /setup my-project
```

This creates `<baseDir>/my-project` (if missing), scaffolds `AGENTS.md`, `PERSONA.LANG.md`, `CONTEXT.md`, `SKILLS.md`, links `CLAUDE.md` and `GEMINI.md` to `AGENTS.md`, then binds the channel. Unbound channels receive a prompt to run `/setup`.

## Commands

| Command | Action |
|---------|--------|
| `/setup <name>` | Bind channel to `baseDir/<name>`, auto-create dir |
| `/harness claude\|codex\|gemini` | Switch harness for channel (clears session) |
| `/edit on\|off` | Toggle edit mode |
| `/status` | Show harness, edit mode, session, project |
| `/resume` | Return cached last output, or continue active session when available |
| `/persona [lang:] <description>` | Generate and set persona text in `PERSONA.LANG.md` (default language: `EN`) |
| `/persona clear` | Reset persona profiles in `PERSONA.LANG.md` |
| `/icon` | Set server-specific bot icon from one attached image (Manage Server required) |
| `/icon clear` | Clear server-specific bot icon (Manage Server required) |

## Run

- `bun start` or `bun dev` (verbose logging)

## Tests

- Run tests: `bun test`

The test suite covers:
- config path resolution and validation
- per channel queue behavior
- channel binding and message splitting
- session file load and save behavior
- NDJSON stream parsing helpers
- command parsing (/setup, /harness, /edit, /status, /resume, /persona, /icon)
- Gemini argument handling with optional edit-off policy

## Notes

- Houston runs the selected harness CLI with headless flags and NDJSON output.
- Houston runs on bot mention or direct reply to a bot message in bound channels.
- In unbound channels, a bare mention returns setup help once; repeated bare mentions are ignored until a non-empty prompt is sent.
- The default harness is configurable (`defaultHarness` in config.json). Per-channel overrides are set via `/harness`.
- Optional `geminiEditOffPolicy` in config enables Gemini `--approval-mode yolo` with `--policy` while edit mode is off.
- Optional `constitutionPath` in config controls prompt context slots and limits (defaults to `<config-dir>/constitution.json` when present).
- At startup, Houston checks which harness binaries are installed and logs availability. The `/harness` command only allows switching to installed harnesses.
