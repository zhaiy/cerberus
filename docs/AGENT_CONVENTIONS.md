# Cerberus Agent Calling Conventions

This document provides recommended call sequences and operational procedures for automated agents interacting with the Cerberus CLI. An agent that follows these conventions can reliably manage vaults without reading source code.

## Quick Reference

### Command Exit Codes

| Code | Meaning | Retryable |
|------|---------|-----------|
| 0 | Success | - |
| 1 | Unknown error | No |
| 2 | Invalid arguments (including unknown flags) | No |
| 3 | Vault not found or not initialized | No |
| 4 | Vault already exists | No |
| 5 | Configuration error | No |
| 6 | Vault state invalid (inconsistent files) | No |
| 7 | Session locked (vault not unlocked) | Yes |
| 8 | Session expired (TTL exceeded) | Yes |
| 9 | Backup failed (verification or restore) | No |
| 10 | Import failed | No |
| 11 | I/O error (disk, permissions) | Yes |
| 12 | Conflict (would overwrite existing data) | No |

### JSON Output Modes

Commands that support `--json` produce stable, parseable output. In `--json` mode, **failures also produce structured JSON** instead of free-form stderr:

```json
{
  "version": 1,
  "status": "error",
  "error": {
    "code": "BACKUP_FAILED",
    "message": "Backup verification failed: 3 error(s)",
    "retryable": false
  }
}
```

Always check `status === "error"` and use `error.code` for programmatic decisions. Do not parse `error.message` — it is human-readable and may change.

### Global Options

- `--vault <path>` — Use an explicit vault root instead of `~/.cerberus`
- `--home <path>` — Override the home directory for resolving `~/.cerberus`

## Session Lifecycle

Cerberus uses a session model. Most commands require an active session.

```
init → unlock → (use commands) → lock
```

- **Session TTL**: 15 minutes by default (configurable in `config.json`)
- **Session expiry**: exit code 8, `retryable: true`. Re-run `unlock`.
- **Session locked**: exit code 7. Run `unlock` first.

When automating, use `--password-stdin` to pipe passwords:

```bash
printf 'correct-horse\n' | cerberus unlock --password-stdin
```

## Scenario: New Vault Initialization

### Prerequisites

- `age` and `age-keygen` installed and in PATH
- Node.js >= 20
- Target directory does not exist or is empty

### Steps

1. **Initialize the vault**

   ```bash
   printf 'my-password\nmy-password\n' | cerberus init --password-stdin
   ```

   Expected: exit 0, text output confirming vault creation.

2. **Unlock the vault**

   ```bash
   printf 'my-password\n' | cerberus unlock --password-stdin
   ```

   Expected: exit 0, session active.

3. **Verify the vault is ready**

   ```bash
   cerberus list --json
   ```

   Expected: exit 0, JSON array (may be empty if no entries yet).

### Failure Recovery

- Exit 4 (`VAULT_ALREADY_EXISTS`): vault was already initialized. Proceed to `unlock`.
- Exit 2 (`INVALID_ARGS`): password too short (minimum 8 characters).

## Scenario: Daily Use

### Prerequisites

- Vault is initialized
- Session is active (run `unlock` if expired)

### Steps

1. **Check session is active**

   ```bash
   cerberus list --json
   ```

   If exit 7 or 8: re-run `unlock --password-stdin`.

2. **Create an entry**

   ```bash
   echo "Today's note content" | cerberus new --title "Daily Note" --category note --tags daily
   ```

   Expected: exit 0, output includes the new entry ID.

3. **List entries**

   ```bash
   cerberus list --category note --json
   ```

   Expected: exit 0, JSON array of matching entries.

4. **Search entries**

   ```bash
   cerberus search --title "keyword" --tag daily
   ```

5. **Lock when done**

   ```bash
   cerberus lock
   ```

   Expected: exit 0. Session cleared.

## Scenario: Backup and Verify

### Prerequisites

- Vault is initialized
- At least one entry exists (so backup has content)

### Steps

1. **Create a backup**

   ```bash
   cerberus backup create --output /path/to/backup-dir
   ```

   Expected: exit 0, text output confirming backup location.
   The output directory will be created. Must not already exist (exit 12 if it does).

2. **Verify the backup**

   ```bash
   cerberus backup verify --dir /path/to/backup-dir --json
   ```

   Expected: exit 0, JSON:
   ```json
   { "version": 1, "status": "valid", "totalFiles": 5, "errors": [] }
   ```

   If `status` is `"error"`: the backup is corrupt. Re-create it.

3. **Check the operation was logged**

   ```bash
   cerberus ops list --command backup --last 2 --json
   ```

   Expected: JSON with at least one backup operation.

### Failure Recovery

- `BACKUP_FAILED` (exit 9): backup is corrupt. Delete it and re-create.
- `CONFLICT` (exit 12): output directory already exists. Use a different path or remove the existing directory.
- `IO_FAILED` (exit 11): disk issue. Check available space and permissions. Retryable.

## Scenario: Restore from Backup

### Prerequisites

- A verified backup exists
- The target directory does not exist or is empty

### Steps

1. **Verify the backup first**

   ```bash
   cerberus backup verify --dir /path/to/backup-dir --json
   ```

   If `status` is not `"valid"`: stop. Do not attempt restore.

2. **Preview the restore plan (dry-run)**

   ```bash
   cerberus backup restore --from /path/to/backup-dir --output /path/to/new-vault --dry-run --json
   ```

   Expected: exit 0, JSON with `dryRun: true` and file list.

3. **Execute the restore**

   ```bash
   cerberus backup restore --from /path/to/backup-dir --output /path/to/new-vault --json
   ```

   Expected: exit 0, JSON with `totalFiles` and `totalBytes`.

4. **Validate the restored vault**

   ```bash
   cerberus --vault /path/to/new-vault unlock --password-stdin
   cerberus --vault /path/to/new-vault list --json
   cerberus --vault /path/to/new-vault doctor check --json
   ```

   All should exit 0.

### Failure Recovery

- `VAULT_ALREADY_EXISTS` (exit 4): target directory is not empty. Use a clean directory.
- `BACKUP_FAILED` (exit 9): backup is corrupt or incomplete. Re-verify and re-create the backup.

## Scenario: Export and Import Round-Trip

### Prerequisites

- Vault is initialized and unlocked
- At least one entry exists

### Steps

1. **Export entries**

   ```bash
   cerberus export --all --format json --output /path/to/export-dir
   ```

   Expected: exit 0. JSON files written to the export directory.

2. **Verify export files exist**

   Check that `entries.json` exists in the export directory.

3. **Import into a fresh vault**

   ```bash
   cerberus import --format json --input /path/to/export-dir --json
   ```

   Expected: exit 0, JSON:
   ```json
   { "version": 1, "success": 5, "skipped": 0, "conflict": 0 }
   ```

4. **Verify import**

   ```bash
   cerberus list --json
   ```

   Confirm the entry count matches the export.

### Failure Recovery

- `IMPORT_FAILED` (exit 10): check the input directory exists and contains valid export files.
- `CONFLICT` (exit 12): entries with the same IDs already exist. Import creates new IDs for new entries; conflicts are reported but not an error.

## Scenario: Doctor Check and Cleanup

### Prerequisites

- Vault is initialized

### Steps

1. **Check vault consistency**

   ```bash
   cerberus doctor check --json
   ```

   Expected: exit 0, JSON with `ok: true` and empty `issues` array.

   If `ok: false`: review `issues` array for details.

2. **Preview cleanup (dry-run)**

   ```bash
   cerberus doctor cleanup --json
   ```

   Expected: exit 0, JSON with `dryRun: true` and `actions` array.
   If `totalActions: 0`: nothing to clean up.

3. **Review planned actions carefully**

   Only `delete_orphan_entry_file` actions are planned. These are ciphertext files with no corresponding database record. Doctor will never delete database records or modify existing entries.

4. **Apply cleanup**

   ```bash
   cerberus doctor cleanup --apply --json
   ```

   Expected: exit 0, JSON with `applied: true`.

5. **Verify cleanup**

   ```bash
   cerberus doctor check --json
   ```

   Should now report `ok: true`.

### Important Notes

- **Always dry-run first.** Never skip the preview step.
- **Doctor is conservative.** It only removes unambiguous orphan files.
- **Cleanup logs to operations.log.** Use `ops list --command doctor` to review past cleanups.

## Operational Queries with `ops`

### List Recent Operations

```bash
cerberus ops list --last 10 --json
```

Returns the 10 most recent operations with timestamps, commands, and results.

### Find Failed Operations

```bash
cerberus ops list --result failed --json
```

### Check a Specific Operation

```bash
cerberus ops show op_abc123 --json
```

Returns full details for a single operation. The `targetPath` field is never exposed in output.

### Filter by Command Type

```bash
cerberus ops list --command backup --json
cerberus ops list --command import --json
cerberus ops list --command doctor --json
```

## Anti-Patterns

### Forgetting to Unlock

Most commands require an active session. If you get exit code 7, run `unlock` first.

```
# Wrong
cerberus new --title "Test"   # exit 7

# Right
printf 'password\n' | cerberus unlock --password-stdin
cerberus new --title "Test"
```

### Restoring into a Non-Empty Directory

`backup restore` requires the target directory to be empty or missing.

```
# Wrong: /existing-vault already has files
cerberus backup restore --from /backup --output /existing-vault  # exit 4 or 12

# Right: use a fresh directory
cerberus backup restore --from /backup --output /new-vault-location
```

### Skipping Backup Verification

Always verify a backup before restoring from it. A corrupt backup will produce a broken vault.

```
# Wrong
cerberus backup restore --from /maybe-corrupt --output /target

# Right
cerberus backup verify --dir /maybe-corrupt --json
# check status === "valid" first
cerberus backup restore --from /maybe-corrupt --output /target
```

### Running Cleanup Without Dry-Run

Always preview cleanup actions before applying them. Although cleanup is conservative, reviewing the plan prevents surprises.

```
# Wrong
cerberus doctor cleanup --apply

# Right
cerberus doctor cleanup --json          # review first
cerberus doctor cleanup --apply --json  # then apply
```

### Parsing stderr for Error Information

In `--json` mode, failures produce structured JSON on **stdout**, not stderr. Do not parse stderr.

```
# Wrong: parsing stderr
result=$(cerberus backup verify --dir /backup --json 2>&1)

# Right: capture stdout, check exit code
cerberus backup verify --dir /backup --json
exit_code=$?
```

## JSON Contract Reference

### Success Outputs

**backup verify --json**
```json
{ "version": 1, "status": "valid", "totalFiles": 5, "errors": [], "summary": "..." }
```

**backup restore --json**
```json
{ "version": 1, "dryRun": false, "backupRoot": "...", "targetRoot": "...", "totalFiles": 5, "totalBytes": 1024, "files": [...], "summary": "..." }
```

**import --json**
```json
{ "version": 1, "success": 5, "skipped": 0, "conflict": 0, "summary": "..." }
```

**doctor cleanup --json**
```json
{ "version": 1, "applied": false, "dryRun": true, "totalActions": 1, "actions": [...], "summary": "..." }
```

**ops list --json**
```json
{ "version": 1, "total": 2, "operations": [...] }
```

**ops show --json**
```json
{ "version": 1, "id": "op_abc", "timestamp": "...", "command": "backup", "result": "success", "summary": "..." }
```

### Error Output (all --json commands)

```json
{ "version": 1, "status": "error", "error": { "code": "ERROR_CODE", "message": "...", "retryable": false } }
```
