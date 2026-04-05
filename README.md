# Cerberus

Local-first encrypted private vault CLI. Stores sensitive notes, attachments, and final messages on disk using `age` encryption. Single user, no cloud, no network.

## Prerequisites

- Node.js >= 20
- [age](https://age-encryption.org/) (`age` and `age-keygen`) installed and in PATH

## Install & Build

```bash
npm install
npm run build
node dist/index.js --help
```

Global overrides:

```bash
cerberus --vault /path/to/vault init
cerberus --home /tmp/test-home init
```

`--vault` points Cerberus at an explicit vault root. `--home` changes how the default `~/.cerberus` path is resolved, which is useful for tests and isolated environments.

## Commands

### Initialize the vault

```bash
cerberus init
cerberus --vault ~/.cerberus-work init
printf 'correct-horse\ncorrect-horse\n' | cerberus --vault ~/.cerberus-work init --password-stdin
```

Prompts for a master password (minimum 8 characters) and creates `~/.cerberus/` with encrypted identity, SQLite database, and config.

### Unlock the vault

```bash
cerberus unlock
cerberus --vault ~/.cerberus-work unlock
printf 'correct-horse\n' | cerberus --vault ~/.cerberus-work unlock --password-stdin
```

Prompts for master password. Opens a session valid for 15 minutes (configurable). Most commands below require an active session.

### Create an entry

```bash
cerberus new --title "My Secret" --category note --tags personal,idea
```

If `--title` or `--category` are omitted, you'll be prompted interactively. Content is read from stdin (type and press Ctrl+D to finish, or pipe it).

### List entries

```bash
cerberus list                          # All entries
cerberus list --category diary         # Filter by category
```

Valid categories: `diary`, `note`, `last_words`, `collection`, `secret`.

### Show an entry

```bash
cerberus show <entry-id>
```

Displays metadata (title, category, tags, timestamps) and decrypted content.

### Edit an entry

```bash
cerberus edit <entry-id>
```

Opens the decrypted content in `$VISUAL` / `$EDITOR` / `vi`. On save, content is re-encrypted and `updated_at` is updated. If no changes are detected, nothing is written.

### Delete an entry

```bash
cerberus delete <entry-id>            # Interactive confirmation
cerberus delete <entry-id> --yes      # Skip confirmation
```

Soft-deletes the entry (sets `deleted_at`). The encrypted `.age` file is retained on disk.

### Search entries

```bash
cerberus search --title "keyword"     # Search by title substring
cerberus search --tag life            # Search by tag name
```

Search operates on metadata only. Encrypted content is never scanned.

### Export and import (plaintext)

```bash
cerberus export --all --format json --output /path/to/out
cerberus import --format json --input /path/to/out
cerberus import --format markdown --input /path/to/markdown-dir
```

Import reads only from the directory you pass. New entries always get new IDs; import reports success, skipped, and duplicate-ID conflicts inside `entries.json`.

### Doctor (consistency and cleanup)

```bash
cerberus doctor check
cerberus doctor check --json
cerberus doctor cleanup              # dry-run: list actions only
cerberus doctor cleanup --apply      # delete orphan ciphertext files only
```

`doctor check` compares SQLite metadata to files under `vault/entries` and `vault/attachments` without modifying the vault. `doctor cleanup` defaults to a dry-run; use `--apply` to remove only unambiguous orphan ciphertext files.

### Attachments

```bash
cerberus attach add <entry-id> <file-path>    # Encrypt and attach a file
cerberus attach list <entry-id>               # List attachments for an entry
cerberus attach export <attachment-id> <path>  # Decrypt and export to target path
```

Attachments are encrypted with the same age identity as entries. Export requires an explicit target path — no files are left in temp directories.

### Backup and restore

```bash
cerberus backup create --output /path/to/backup-dir   # Full vault snapshot + manifest
cerberus backup verify --dir /path/to/backup-dir      # Check manifest and file digests
cerberus backup restore --from /path/to/backup-dir --output /path/to/new-vault-root [--dry-run]
```

Restore verifies the backup before writing anything. The `--output` directory must be missing or empty. Use `--dry-run` to print the restore plan without copying files.

## Development

```bash
npm run dev -- --help     # Run via ts-node (no build needed)
npm run check             # Type-check without emitting
npm run start -- --help   # Run the built output
npm test                  # Run unit + integration tests
```

## Storage Layout

```
~/.cerberus/
├── vault/
│   ├── entries/<id>.age          # Encrypted entry content
│   └── attachments/<id>.age     # Encrypted attachments
├── db.sqlite                     # Metadata (SQLite)
├── config.json                   # Vault config
├── keys/identity.age.enc         # Age identity (encrypted with master password)
└── sessions/                     # Session files (auto-cleaned on expiry)
```

Metadata (title, category, tags, timestamps) is stored unencrypted in SQLite for fast search. Entry content and attachments are always encrypted on disk.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `Encryption tools are not available` | `age` not in PATH | Install age: `brew install age` (macOS) or see [age-encryption.org](https://age-encryption.org/) |
| `Vault is locked` | No active session | Run `cerberus unlock` first |
| `Vault is not initialized` | `~/.cerberus/` missing or incomplete | Run `cerberus init` |
| `Session expired` | Session TTL (default 15 min) passed | Run `cerberus unlock` again |
| `Refusing to delete without confirmation` | Non-interactive mode without `--yes` | Add `--yes` flag or run in a TTY |
| `Could not unlock protected key material` | Wrong master password | Re-enter the correct password |

## Security Notes

- Master password is never stored directly — it derives a wrapping key via Argon2id
- All content encryption uses the `age` CLI with a native age identity
- Decrypted identity is held only in memory during an active session
- Temporary files use mode `0o600` and are cleaned up in `finally` blocks
- Entry content overwrite is atomic (write temp, then rename)
- Logs and error messages never include plaintext content
