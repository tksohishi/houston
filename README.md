# Houston

Houston is a remote command center for Claude Code, operated through Discord.

## Prerequisites

- [Bun](https://bun.sh/)
- Claude Code CLI installed and authenticated on the Mac
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
4. Setup writes config to `${XDG_CONFIG_HOME:-~/.config}/houston/config.json` by default.
5. Sessions are stored at `${XDG_STATE_HOME:-~/.local/state}/houston/sessions.json` by default.

## Channel Mapping

- Channels with the configured prefix are watched.
- `cc-project-alpha` maps to `<baseDir>/project-alpha`.
- `cc-houston` maps to `<baseDir>/houston`.
- Channels without the prefix are ignored.

## Run

- Start daemon: `bun run start`
- Dev mode: `bun run dev`

## Tests

- Run tests: `bun test`

The test suite covers:
- config path resolution and validation
- per channel queue behavior
- channel to project mapping and message splitting
- session file load and save behavior
- Claude stream JSON chunk parsing helpers

## Notes

- Houston runs Claude with `-p --verbose --output-format stream-json --permission-mode dontAsk`.
- Houston only runs when a message starts with a bot mention in a watched channel; regular chat is ignored.
- Execution is allowed only when both checks pass, the Discord user can post in the target `cc-*` channel, and Claude Code allows the requested tool via `~/.claude/settings.json` plus optional `<project>/.claude/settings.json`. Houston does not add per user RBAC in this phase.
