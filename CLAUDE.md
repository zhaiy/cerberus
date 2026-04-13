# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cerberus is a local-first encrypted private vault CLI for storing sensitive notes, attachments, and final messages. It uses `age` for all content encryption and SQLite for metadata storage. The project has reached v1.0 maturity — all planned CLI commands are fully implemented with tests, JSON contracts, and agent integration.

Full technical specification and iteration history are in `docs/history/2026-04-iteration-5/` (written in Chinese).

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Run via ts-node (no build needed)
npm run check        # Type-check without emitting (both tsconfig variants)
npm test             # Build + run all tests (vitest)
npm run test:watch   # Watch mode for tests
```

## Architecture

The codebase follows a layered architecture with strict separation:

```
cli/          → Command routing (runCli dispatches by command name)
commands/     → One file per CLI command, receives AppContext + args
core/         → Shared types, config, paths, errors, runtime, JSON envelope, operation log
crypto/       → age encryption wrapper, identity management (Argon2id), session handling
storage/      → SQLite db layer, entries/tags/attachments data access
services/     → Business logic (vault-service, search-service, export/import, backup, doctor)
skill/        → OpenClaw integration layer (intent → business logic → sanitized response)
```

**Data flow:** `index.ts` → `cli/index.ts` (command dispatch) → `commands/*.ts` → `services/*.ts` → `crypto/` + `storage/`

### Implemented Commands

All commands are fully implemented (not stubs):

| Command | Description |
|---------|-------------|
| `init` | Create vault with master password, age identity, SQLite db |
| `unlock` / `lock` | Session management with configurable TTL (default 15 min) |
| `new` | Create encrypted entry (diary / note / last_words / collection / secret) |
| `list` | List entries with optional category filter, supports `--json` |
| `show` | Decrypt and display entry content, supports `--json` |
| `edit` | Decrypt → open in `$EDITOR` → re-encrypt on save |
| `delete` | Soft-delete with confirmation (`--yes` to skip) |
| `search` | Metadata search by title substring or tag name, supports `--json` |
| `attach` | `add` / `list` / `export` encrypted attachments |
| `export` | Export entries as JSON or Markdown |
| `import` | Import from JSON or Markdown, supports `--json` |
| `backup` | `create` / `verify` / `restore` with manifest, supports `--json` |
| `doctor` | `check` / `cleanup` for vault consistency, supports `--json` |
| `ops` | `list` / `show` for querying operation audit logs, supports `--json` |

### Key Types

- `AppContext` — carries `AppPaths` (all resolved filesystem paths under `~/.cerberus/`)
- `EntryCategory` — union type: `diary | note | last_words | collection | secret`
- `CerberusConfig` — vault config with `sessionTtlMinutes` (default 15)
- `JsonEnvelope` — standardized JSON error envelope for maintenance commands

### Storage Layout (`~/.cerberus/`)

- `vault/entries/<id>.age` — encrypted entry content
- `vault/attachments/<id>.age` — encrypted attachments
- `db.sqlite` — metadata (entries, tags, entry_tags, attachments tables)
- `config.json` — vault configuration
- `keys/identity.age.enc` — age identity encrypted with master password–derived key
- `sessions/` — session files (auto-cleaned on expiry)
- `operations.log` — audit log for high-risk maintenance commands

## Agent Integration

The `src/skill/openclaw.ts` module exposes `handleSkillRequest(request: SkillRequest): Promise<SkillResponse>` for agent platforms. Supported intents: `new`, `create`, `list`, `show`, `get`, `search`, `find`, `delete`, `remove`, `edit`, `update`, `attach_add`, `attach_list`, `attach_export`. Error messages are sanitized to strip filesystem paths and sensitive data.

See `docs/history/2026-04-iteration-5/AGENT_CONVENTIONS.md` for recommended call sequences and error handling.

## Crypto Design Constraints

- **Never implement custom crypto.** All encryption/decryption goes through the `age` CLI.
- Master password is used to derive a wrapping key (Argon2id) that protects the age identity file.
- Entry content and attachments are encrypted using the age identity — never the master password directly.
- Decrypted identity must never be written to disk long-term.
- Logs/errors must never include plaintext content, master password, or decrypted paths.

## Testing

Tests use Vitest. 16 test files covering:

- **Unit** (14): CLI args, entries, attachments, session, age crypto, paths, backup, export, import, doctor, JSON envelope, ops, skill/openclaw, CLI automation
- **Integration** (2): vault entry flow, maintenance CLI contracts

Run with `npm test` (builds first) or `npm run test:watch` for development.

## TypeScript Configuration

- ES2022 target, NodeNext module resolution, strict mode
- ES modules only (`"type": "module"` in package.json)
- Import paths must use `.js` extension (NodeNext requirement)
- Requires Node.js >= 20

## Exit Codes

Stable exit codes for automation:

- `2` — invalid arguments
- `3` — vault not found or not initialized
- `9` — backup verification or restore failed
- `10` — import failed
- `12` — conflict (e.g. refusing to overwrite existing backup)
