# Recovery Drill Report — DRILL-001

## Drill Information

- **Date**: 2026-04-11
- **Drill ID**: DRILL-001
- **Objective**: Verify cross-directory backup and restore with full data integrity
- **Operator**: Automated (Claude Code)

## Environment

| Item | Value |
|------|-------|
| Operating System | macOS (Darwin 25.4.0) |
| Node.js Version | v25.5.0 |
| Cerberus Version | 0.1.0 |
| age Version | v1.3.1 |
| Vault Location (source) | /tmp/cerberus-drill-source |
| Backup Location | /tmp/cerberus-drill-backup |
| Restore Location (target) | /tmp/cerberus-drill-restored |

## Pre-Conditions

- [x] age CLI is installed and in PATH
- [x] Node.js >= 20
- [x] Source vault initialized with 3 test entries (diary, note, last_words)
- [x] Backup directory did not exist
- [x] Restore target directory did not exist

## Steps

### 1. Prepare Source Vault

**Commands:**
```bash
mkdir -p /tmp/cerberus-drill-source
printf 'drill-password-2026\ndrill-password-2026\n' | cerberus --vault /tmp/cerberus-drill-source init --password-stdin
printf 'drill-password-2026\n' | cerberus --vault /tmp/cerberus-drill-source unlock --password-stdin
echo "..." | cerberus --vault /tmp/cerberus-drill-source new --title "Drill Diary" --category diary --tags drill,test
echo "..." | cerberus --vault /tmp/cerberus-drill-source new --title "Backup Test Note" --category note --tags drill
echo "..." | cerberus --vault /tmp/cerberus-drill-source new --title "Last Words Entry" --category last_words
```

**Actual Output:** All commands exited 0. 3 entries created with IDs:
- `60498e90-95c5-4e6f-84b4-376acd9b0508` (Drill Diary)
- `dc0ca861-804f-4cee-92f2-f9d773c7856d` (Backup Test Note)
- `d72ec502-0603-4b2e-97e4-927aa29c85eb` (Last Words Entry)

**Result:** PASS

**Notes:** The vault root directory must exist before `init`. The `init` command does not create parent directories for the `--vault` path.

### 2. Create Backup

**Command:**
```bash
cerberus --vault /tmp/cerberus-drill-source backup create --output /tmp/cerberus-drill-backup
```

**Actual Output:** `Backup created at: /tmp/cerberus-drill-backup`

**Result:** PASS

### 3. Verify Backup

**Command:**
```bash
cerberus --vault /tmp/cerberus-drill-source backup verify --dir /tmp/cerberus-drill-backup --json
```

**Actual Output:**
```json
{
  "version": 1,
  "status": "valid",
  "totalFiles": 6,
  "errors": [],
  "summary": "Backup verified: 6 file(s) OK"
}
```

**Result:** PASS

### 4. Restore to Different Directory

**Command:**
```bash
cerberus --vault /tmp/cerberus-drill-source backup restore --from /tmp/cerberus-drill-backup --output /tmp/cerberus-drill-restored --json
```

**Actual Output:**
```json
{
  "version": 1,
  "dryRun": false,
  "totalFiles": 6,
  "totalBytes": 41993,
  "summary": "Restore completed: 6 file(s), 41993 bytes"
}
```

**Result:** PASS

### 5. Validate Restored Vault

**Commands:**
```bash
cerberus --vault /tmp/cerberus-drill-restored unlock --password-stdin
cerberus --vault /tmp/cerberus-drill-restored list --json
cerberus --vault /tmp/cerberus-drill-restored doctor check --json
cerberus --vault /tmp/cerberus-drill-restored show <entry-id>
```

**Actual Results:**
- `unlock`: PASS (exit 0)
- `list --json`: PASS — 3 entries with identical IDs, titles, categories, tags, and timestamps as source vault
- `doctor check --json`: PASS — `{"ok": true, "issues": []}`
- `show 60498e90...`: PASS — Content `"This is my secret diary entry for the drill."` matches original

**Result:** PASS

### 6. Verify Operation Log

**Command:**
```bash
cerberus --vault /tmp/cerberus-drill-source ops list --command backup --json
```

**Actual Output:**
```json
{
  "version": 1,
  "total": 2,
  "operations": [
    {
      "id": "op_6fef4695-ab91-4890-a47a-82154da7c955",
      "timestamp": "2026-04-11T11:59:54.160Z",
      "command": "backup",
      "subcommand": "create",
      "result": "success",
      "summary": "Backup created: 6 file(s), 41993 bytes",
      "durationMs": 12
    },
    {
      "id": "op_4f853b58-706f-4386-b6ea-a25087d80bdd",
      "timestamp": "2026-04-11T12:00:24.781Z",
      "command": "backup",
      "subcommand": "restore",
      "result": "success",
      "summary": "Restore completed: 6 file(s), 41993 bytes from <path>",
      "durationMs": 9
    }
  ]
}
```

**Result:** PASS — Both create and restore operations logged. No sensitive data in output.

## Results Summary

| Step | Result | Notes |
|------|--------|-------|
| 1. Prepare source vault | PASS | 3 entries created across 3 categories |
| 2. Create backup | PASS | 6 files backed up |
| 3. Verify backup | PASS | `status: "valid"`, 0 errors |
| 4. Restore to different directory | PASS | 6 files, 41993 bytes restored |
| 5. Validate restored vault | PASS | Entries, content, doctor check all match |
| 6. Verify operation log | PASS | Both operations logged, no sensitive data |

**Overall: 6/6 PASS**

## Anomalies

1. **Vault init requires existing parent directory.** When using `--vault /tmp/cerberus-drill-source`, the directory `/tmp/cerberus-drill-source` must already exist. The `init` command creates subdirectories (vault/, keys/, sessions/) but not the root itself. This is expected behavior but worth noting for automation scripts.

2. **No anomalies in the backup-verify-restore cycle.** All operations completed on first attempt.

## Rollback Points

- After Step 2 (backup created): backup directory can be deleted if drill needs restart
- After Step 4 (restore completed): restore directory can be deleted without affecting source vault
- Source vault remained untouched throughout the drill

## Timing

- Total drill duration: approximately 2 minutes (including manual verification)
- Backup creation: 12ms
- Backup restore: 9ms

## Conclusion

The full backup-verify-restore-validate cycle completed successfully with zero data loss. All 3 entries with their metadata (IDs, titles, categories, tags, timestamps) and encrypted content were perfectly preserved through the round-trip. The restored vault passes `doctor check` with no issues.

## Release Threshold Recommendation

- [x] Full recovery cycle passes — suitable for release
- [ ] Minor issues found — fixable without blocking release
- [ ] Major issues found — must fix before release

**Recommendation**: Approve. The backup/restore pipeline is reliable and suitable for release. The only operational note is that automation scripts should pre-create the vault root directory before `init`.
