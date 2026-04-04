# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cerberus is a local-first encrypted private vault CLI for storing sensitive notes, attachments, and final messages. It uses `age` for all content encryption and SQLite for metadata storage. Full technical specification is in `docs/PROJECT.md` (written in Chinese).

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Run via ts-node (no build needed)
npm run check        # Type-check without emitting
```

No test framework is configured yet (`tests/unit/` and `tests/integration/` exist but are empty).

## Architecture

The codebase follows a layered architecture with strict separation:

```
cli/          → Command routing (runCli dispatches by command name)
commands/     → One file per CLI command, receives AppContext + args
core/         → Shared types, config, paths, errors, runtime (AppContext builder)
crypto/       → age encryption wrapper, identity management, session handling
storage/      → SQLite db layer, entries/tags/attachments data access
services/     → Business logic (vault-service, search-service)
skill/        → OpenClaw integration layer (natural language → CLI)
```

**Data flow:** `index.ts` → `cli/index.ts` (command dispatch) → `commands/*.ts` → `services/*.ts` → `crypto/` + `storage/`

### Key Types

- `AppContext` — carries `AppPaths` (all resolved filesystem paths under `~/.cerberus/`)
- `EntryCategory` — union type: `diary | note | last_words | collection | secret`
- `CerberusConfig` — vault config with `sessionTtlMinutes` (default 15)

### Storage Layout (`~/.cerberus/`)

- `vault/entries/<id>.age` — encrypted entry content
- `vault/attachments/<id>.age` — encrypted attachments
- `db.sqlite` — metadata (entries, tags, entry_tags, attachments tables)
- `config.json` — vault configuration
- `keys/identity.age.enc` — age identity encrypted with master password–derived key

## Crypto Design Constraints

- **Never implement custom crypto.** All encryption/decryption goes through the `age` CLI.
- Master password is used to derive a wrapping key (Argon2id) that protects the age identity file.
- Entry content and attachments are encrypted using the age identity — never the master password directly.
- Decrypted identity must never be written to disk long-term.
- Logs/errors must never include plaintext content, master password, or decrypted paths.

## TypeScript Configuration

- ES2022 target, NodeNext module resolution, strict mode
- ES modules only (`"type": "module"` in package.json)
- Import paths must use `.js` extension (NodeNext requirement)
- Requires Node.js >= 20

## Implementation Status

Phase 1 (skeleton) is complete. Most commands are stubs. The implementation order from the spec is: `init` → `new` → `list` → `show` → `delete` → `edit` → `search` → `attach` → `skill`.