import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  handleSkillRequest,
  type SkillResponse,
} from "../../src/skill/openclaw.js";
import type { AppPaths } from "../../src/core/types.js";
import { openDatabase, runMigrations } from "../../src/storage/db.js";
import { createEntryRecord } from "../../src/storage/entries.js";
import {
  openSession,
} from "../../src/crypto/session.js";

function tempPaths(root: string): AppPaths {
  return {
    homeDir: root,
    appDir: root,
    vaultDir: path.join(root, "vault"),
    entriesDir: path.join(root, "vault", "entries"),
    attachmentsDir: path.join(root, "vault", "attachments"),
    configPath: path.join(root, "config.json"),
    dbPath: path.join(root, "db.sqlite"),
    keysDir: path.join(root, "keys"),
    wrappedIdentityPath: path.join(root, "keys", "identity.age.enc"),
    sessionsDir: path.join(root, "sessions"),
  };
}

/** Set up a minimal vault with DB and config (no age encryption). */
async function setupVault(root: string): Promise<AppPaths> {
  const paths = tempPaths(root);
  await fs.mkdir(paths.entriesDir, { recursive: true });
  await fs.mkdir(paths.attachmentsDir, { recursive: true });
  await fs.mkdir(paths.keysDir, { recursive: true });
  await fs.mkdir(paths.sessionsDir, { recursive: true });

  // Config
  await fs.writeFile(
    paths.configPath,
    JSON.stringify({ version: 1, createdAt: new Date().toISOString(), sessionTtlMinutes: 15 }),
    "utf8",
  );

  // DB
  const db = openDatabase(paths);
  try {
    runMigrations(db);
  } finally {
    db.close();
  }

  // Fake wrapped identity (>= 32 bytes)
  await fs.writeFile(paths.wrappedIdentityPath, Buffer.alloc(64, 0xab));

  // Open a fake session with a dummy identity
  await openSession(paths, Buffer.from("test-identity-for-skill"), 15);

  return paths;
}

function insertEntry(
  paths: AppPaths,
  opts: { id: string; title: string; category: string; contentPath: string },
): void {
  const now = new Date().toISOString();
  const db = openDatabase(paths);
  try {
    createEntryRecord(db, {
      id: opts.id,
      title: opts.title,
      category: opts.category as "note",
      contentPath: opts.contentPath,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    db.close();
  }
}

describe("skill intents — delete", () => {
  let root: string;
  let paths: AppPaths;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("returns error when id is missing", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    const res = await handleSkillRequest({
      intent: "delete",
      payload: {},
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("id");
  });

  it("returns error when entry not found", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    const res = await handleSkillRequest({
      intent: "delete",
      payload: { id: "nonexistent" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("not found");
  });

  it("soft-deletes an existing entry", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    insertEntry(paths, {
      id: "e-del-1",
      title: "To Delete",
      category: "note",
      contentPath: "e-del-1.age",
    });
    // Write fake content file
    await fs.writeFile(path.join(paths.entriesDir, "e-del-1.age"), "content", "utf8");

    const res = await handleSkillRequest({
      intent: "delete",
      payload: { id: "e-del-1" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(true);
    expect(res.message).toContain("deleted");

    // Verify soft-deleted: list should not include it
    const listRes = await handleSkillRequest({
      intent: "list",
      payload: {},
      vaultPath: paths.appDir,
    });
    expect(listRes.ok).toBe(true);
    const data = listRes.data as { id: string }[] | undefined;
    expect(data ?? []).not.toContainEqual(expect.objectContaining({ id: "e-del-1" }));
  });

  it("'remove' alias works the same", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    insertEntry(paths, {
      id: "e-rm-1",
      title: "Remove Me",
      category: "note",
      contentPath: "e-rm-1.age",
    });

    const res = await handleSkillRequest({
      intent: "remove",
      payload: { id: "e-rm-1" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(true);
  });
});

describe("skill intents — edit", () => {
  let root: string;
  let paths: AppPaths;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("returns error when id is missing", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    const res = await handleSkillRequest({
      intent: "edit",
      payload: { content: "new" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("id");
  });

  it("returns error when nothing to update", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    const res = await handleSkillRequest({
      intent: "edit",
      payload: { id: "e-1" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Nothing to update");
  });

  it("returns error when entry not found", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    const res = await handleSkillRequest({
      intent: "edit",
      payload: { id: "nonexistent", title: "New Title" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("not found");
  });

  it("updates title only", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    insertEntry(paths, {
      id: "e-edit-1",
      title: "Old Title",
      category: "note",
      contentPath: "e-edit-1.age",
    });

    const res = await handleSkillRequest({
      intent: "edit",
      payload: { id: "e-edit-1", title: "New Title" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(true);
    expect(res.message).toContain("updated");

    // Verify via show
    // (show requires age decryption, so we verify via DB directly)
    const db = openDatabase(paths);
    try {
      const { getEntryById } = await import("../../src/storage/entries.js");
      const entry = getEntryById(db, "e-edit-1");
      expect(entry?.title).toBe("New Title");
    } finally {
      db.close();
    }
  });

  it("'update' alias works", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    insertEntry(paths, {
      id: "e-upd-1",
      title: "Old",
      category: "note",
      contentPath: "e-upd-1.age",
    });

    const res = await handleSkillRequest({
      intent: "update",
      payload: { id: "e-upd-1", title: "Updated" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(true);
  });
});

describe("skill intents — attach list", () => {
  let root: string;
  let paths: AppPaths;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("returns error when entryId is missing", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    const res = await handleSkillRequest({
      intent: "attach_list",
      payload: {},
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("entryId");
  });

  it("returns empty when no attachments", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    insertEntry(paths, {
      id: "e-att",
      title: "With Att",
      category: "note",
      contentPath: "e-att.age",
    });

    const res = await handleSkillRequest({
      intent: "attach_list",
      payload: { entryId: "e-att" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(true);
    expect(res.message).toContain("No attachments");
  });

  it("lists existing attachments", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    insertEntry(paths, {
      id: "e-att2",
      title: "Att Entry",
      category: "note",
      contentPath: "e-att2.age",
    });

    // Insert attachment record directly
    const db = openDatabase(paths);
    try {
      const { createAttachmentRecord } = await import("../../src/storage/attachments.js");
      createAttachmentRecord(db, {
        id: "att-001",
        entryId: "e-att2",
        originalName: "photo.jpg",
        mimeType: "image/jpeg",
        encryptedPath: "att-001.age",
        sizeBytes: 1024,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    } finally {
      db.close();
    }

    const res = await handleSkillRequest({
      intent: "attach_list",
      payload: { entryId: "e-att2" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(true);
    expect(res.message).toContain("1 attachment");
    const data = res.data as { id: string; originalName: string }[];
    expect(data[0].id).toBe("att-001");
    expect(data[0].originalName).toBe("photo.jpg");
  });
});

describe("skill intents — unknown intent", () => {
  let root: string;
  let paths: AppPaths;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("returns error for unknown intent with list of valid ones", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    const res = await handleSkillRequest({
      intent: "bogus_intent",
      payload: {},
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Unknown intent");
    expect(res.message).toContain("delete");
    expect(res.message).toContain("edit");
    expect(res.message).toContain("attach_add");
  });
});

describe("skill intents — error path sanitization", () => {
  let root: string;
  let paths: AppPaths;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("does not leak vault paths in error messages", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-"));
    paths = await setupVault(root);

    // Show a nonexistent entry — the error might contain paths internally
    const res = await handleSkillRequest({
      intent: "show",
      payload: { id: "nonexistent" },
      vaultPath: paths.appDir,
    });
    expect(res.ok).toBe(false);
    // Ensure the error message does not contain the vault root path
    expect(res.message).not.toContain(root);
  });

  it("does not leak custom file paths from attachment errors", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-skill-custom-"));
    paths = await setupVault(root);

    insertEntry(paths, {
      id: "e-att-custom",
      title: "Attachment Entry",
      category: "note",
      contentPath: "e-att-custom.age",
    });

    const missingFile = path.join(root, "sensitive", "missing.txt");
    const res = await handleSkillRequest({
      intent: "attach_add",
      payload: {
        entryId: "e-att-custom",
        filePath: missingFile,
      },
      vaultPath: paths.appDir,
    });

    expect(res.ok).toBe(false);
    expect(res.message).not.toContain(missingFile);
    expect(res.message).not.toContain(root);
  });
});
