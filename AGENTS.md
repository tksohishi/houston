# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

## Overview

Houston is a remote command center for AI coding agents, operated through Discord. It supports multiple harnesses (Claude Code, Codex CLI, Gemini CLI) and maps Discord channels to local project directories.

## Development

- Run: `bun start` or `bun dev` (verbose)
- Test: `bun test`
- Typecheck: `bun run typecheck`

### Background processes

When running Houston as a background task, always stop the previous instance before starting a new one. Multiple bot processes cause Discord gateway conflicts and silently break message handling.

If your harness does not provide a built-in stop action, use:

`pkill -f 'bun.*src/index.ts'`

`bun dev` uses `--watch`, so source file changes auto-restart. Only restart manually for `package.json`, config, or dependency changes.
