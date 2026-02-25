# Houston

Houston is a remote command center for AI coding agents, operated through Discord. It supports multiple harnesses (Claude Code, Gemini CLI) and binds Discord channels to local project directories.

## Prerequisites

- [Bun](https://bun.sh/)
- At least one supported CLI installed and authenticated:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)
- A private Discord server

## Setup Flow

1. Install dependencies:
   - `bun install`
2. Run setup:
   - `bun run setup`
   - clean reset first: `bun run reset`
3. Setup wizard guides Discord setup end to end:
   - Discord developer portal steps
   - required bot settings (Message Content Intent)
   - invite URL generation
   - token and application ID prompts with validation
   - default harness selection (claude or gemini)
4. Setup writes config to `${XDG_CONFIG_HOME:-~/.config}/houston/config.json` by default.
5. Sessions are stored at `${XDG_STATE_HOME:-~/.local/state}/houston/sessions.json` by default.

## Channel Binding

Channels are explicitly bound to projects via the `/setup` command:

```
@Houston /setup my-project
```

This creates `<baseDir>/my-project` (if missing), scaffolds a `CLAUDE.md`, and binds the channel. Unbound channels receive a prompt to run `/setup`.

## Commands

| Command | Action |
|---------|--------|
| `/setup <name>` | Bind channel to `baseDir/<name>`, auto-create dir |
| `/harness claude\|gemini` | Switch harness for channel (clears session) |
| `/edit on\|off` | Toggle edit mode |
| `/status` | Show harness, edit mode, session, project |

## Run

- Start daemon: `bun run start`
- Dev mode: `bun run dev`

## Tests

- Run tests: `bun test`

The test suite covers:
- config path resolution and validation
- per channel queue behavior
- channel binding and message splitting
- session file load and save behavior
- NDJSON stream parsing helpers
- command parsing (/setup, /harness, /edit, /status)

## Notes

- Houston runs the selected harness CLI with headless flags and NDJSON output.
- Houston only runs when a message starts with a bot mention in a bound channel; regular chat is ignored.
- The default harness is configurable (`defaultHarness` in config.json). Per-channel overrides are set via `/harness`.
