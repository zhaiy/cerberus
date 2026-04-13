# Recovery Drill Template

Use this template to document a real recovery drill. A drill exercises the full backup-verify-restore-validate cycle with real commands and real data.

## Drill Information

- **Date**:
- **Drill ID**: (e.g., DRILL-001)
- **Objective**: (e.g., "Verify cross-directory backup and restore")
- **Operator**: (name or system)

## Environment

| Item | Value |
|------|-------|
| Operating System | |
| Node.js Version | |
| Cerberus Version | |
| age Version | |
| Vault Location (source) | |
| Backup Location | |
| Restore Location (target) | |

## Pre-Conditions

- [ ] age CLI is installed and in PATH
- [ ] Node.js >= 20
- [ ] Source vault is initialized and contains test data
- [ ] Backup directory does not exist
- [ ] Restore target directory does not exist

## Steps

### 1. Prepare Source Vault

```bash
# Commands and expected output
```

Result: PASS / FAIL

Notes:

### 2. Create Backup

```bash
cerberus backup create --output <backup-dir>
```

Result: PASS / FAIL

Notes:

### 3. Verify Backup

```bash
cerberus backup verify --dir <backup-dir> --json
```

Result: PASS / FAIL

Expected: `status: "valid"`

Notes:

### 4. Restore to Different Directory

```bash
cerberus backup restore --from <backup-dir> --output <restore-dir> --json
```

Result: PASS / FAIL

Notes:

### 5. Validate Restored Vault

```bash
cerberus --vault <restore-dir> unlock --password-stdin
cerberus --vault <restore-dir> list --json
cerberus --vault <restore-dir> doctor check --json
```

Result: PASS / FAIL

Expected: all commands exit 0, entry count matches source vault.

Notes:

### 6. Verify Operation Log

```bash
cerberus ops list --command backup --last 5 --json
```

Result: PASS / FAIL

Expected: log entries for create and restore operations.

Notes:

## Results Summary

| Step | Result | Notes |
|------|--------|-------|
| 1. Prepare | | |
| 2. Backup | | |
| 3. Verify | | |
| 4. Restore | | |
| 5. Validate | | |
| 6. Log Check | | |

## Anomalies

(List any unexpected behavior, errors, or deviations from expected output)

## Rollback Points

(List points where the drill could be safely reversed if something went wrong)

## Conclusion

- Did the full backup-verify-restore-validate cycle complete without data loss?
- Were any issues discovered that need fixing before release?

## Release Threshold Recommendation

Based on this drill:

- [ ] Full recovery cycle passes — suitable for release
- [ ] Minor issues found — fixable without blocking release
- [ ] Major issues found — must fix before release

**Recommendation**: (approve / conditionally approve / block)
