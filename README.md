# 🛰️ Houston — Mission control for AI coding agents, operated through Discord.

Give AI coding agents (Claude Code, Codex CLI, Gemini CLI) a Discord interface. Bind channels to local project directories, switch harnesses on the fly, manage sessions and personas. Works with any private Discord server.

## Features

- **Multi-harness** — Claude Code, Codex CLI, Gemini CLI; switch per channel with `/harness`
- **Channel-to-directory binding** — each Discord channel maps to a local project via `/setup`
- **Session continuity** — conversations persist across messages; `/resume` to pick up where you left off
- **Persona system** — set agent personality and language per project with `/persona`
- **Context slots** — constitution system controls what context files are injected into prompts
- **Edit mode** — toggle file-editing permissions per channel with `/edit`

## Prerequisites

- [Bun](https://bun.sh/)
- [gitleaks](https://github.com/gitleaks/gitleaks)
- At least one supported CLI installed and authenticated:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`)
  - [Codex CLI](https://github.com/openai/codex) (`codex`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)
- A private Discord server

## Setup

Bootstrap and run the setup wizard:

```bash
bun run bootstrap
bun run setup
```

The wizard walks you through Discord app creation, bot configuration (Message Content Intent), invite URL, token entry, default harness selection, and optional context/constitution files.

Config is written to `${XDG_CONFIG_HOME:-~/.config}/houston/config.json`.
Sessions are stored at `${XDG_STATE_HOME:-~/.local/state}/houston/sessions.json`.

Clean reset: `bun run reset`

## Usage

Start the bot:

```bash
bun start
```

Or with verbose logging:

```bash
bun dev
```

### Bind a channel

In any Discord channel, mention the bot:

```
@Houston /setup my-project
```

This creates `<baseDir>/my-project` (if missing), scaffolds default markdown files, and binds the channel. Unbound channels receive a prompt to run `/setup`.

### Talk to your agent

Mention the bot or reply to a bot message in a bound channel:

```
@Houston refactor the auth module to use JWT
```

Houston spawns the selected harness CLI against the bound project directory and streams the response back.

## Commands

| Command | Action |
|---------|--------|
| `/setup <name>` | Bind channel to `baseDir/<name>`, auto-create dir |
| `/harness claude\|codex\|gemini` | Switch harness for channel (clears session) |
| `/edit on\|off` | Toggle edit mode |
| `/status` | Show harness, edit mode, session, project |
| `/resume` | Return cached last output, or continue active session |
| `/persona [lang:] <description>` | Generate and set persona in `PERSONA.LANG.md` |
| `/persona clear` | Reset persona profiles |
| `/icon` | Set server-specific bot icon from attached image |
| `/icon clear` | Clear server-specific bot icon |

## Contributing

```bash
bun run bootstrap
bun test
bun run typecheck
```

## License

[MIT](LICENSE)
