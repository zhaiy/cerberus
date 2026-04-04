import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { generateIdentityToBuffer } from "../../src/crypto/age.js";
import { unwrapIdentityWithPassword } from "../../src/crypto/identity.js";
import { openSession } from "../../src/crypto/session.js";
import type { AppPaths } from "../../src/core/types.js";
import {
  createEntry,
  readEntryContent,
  overwriteEntryContent,
  addAttachment,
  exportAttachment,
  initializeVault,
} from "../../src/services/vault-service.js";
import { openDatabase, runMigrations } from "../../src/storage/db.js";
import {
  getEntryById,
  listEntryRecords,
  searchEntries,
  softDeleteEntry,
  updateEntryRecord,
} from "../../src/storage/entries.js";
import { ensureTag, getTagsForEntry, attachTagsToEntry } from "../../src/storage/tags.js";
import { listAttachmentsForEntry } from "../../src/storage/attachments.js";

function ageCliAvailable(): boolean {
  const age = spawnSync("age", ["-version"], { encoding: "utf8" });
  const keygen = spawnSync("age-keygen", ["-version"], { encoding: "utf8" });
  return age.status === 0 && keygen.status === 0;
}

let cliBuilt = false;

function ensureCliBuilt(): void {
  if (cliBuilt) {
    return;
  }
  const build = spawnSync("npm", ["run", "build"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(
      `Failed to build CLI for integration test.\nSTDOUT:\n${build.stdout}\nSTDERR:\n${build.stderr}`,
    );
  }
  cliBuilt = true;
}

function runCli(
  vaultDir: string,
  args: string[],
  input?: string,
): ReturnType<typeof spawnSync> {
  ensureCliBuilt();
  return spawnSync(
    "node",
    ["dist/index.js", "--vault", vaultDir, ...args],
    {
      cwd: process.cwd(),
      env: process.env,
      input,
      encoding: "utf8",
    },
  );
}

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

describe.skipIf(!ageCliAvailable())(
  "vault service integration (requires age in PATH)",
  () => {
    let root: string;
    let paths: AppPaths;
    let identity: Buffer;

    afterEach(async () => {
      if (identity) identity.fill(0);
      if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    });

    async function setup(): Promise<void> {
      root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-it-"));
      paths = tempPaths(root);
      await fs.mkdir(paths.entriesDir, { recursive: true });
      await fs.mkdir(paths.attachmentsDir, { recursive: true });
      identity = await generateIdentityToBuffer();

      const db = openDatabase(paths);
      try {
        runMigrations(db);
      } finally {
        db.close();
      }
    }

    // ── Entry CRUD ──

    it("createEntry writes ciphertext; readEntryContent restores plaintext", async () => {
      await setup();

      const id = await createEntry(paths, identity, {
        title: "IT",
        category: "note",
        content: "secret-body-üñíçødé",
        tags: [],
      });

      const onDisk = await fs.readFile(path.join(paths.entriesDir, `${id}.age`), "utf8");
      expect(onDisk).not.toContain("secret-body");

      const roundTrip = await readEntryContent(paths, identity, `${id}.age`);
      expect(roundTrip).toBe("secret-body-üñíçødé");
    });

    it("overwriteEntryContent replaces ciphertext atomically", async () => {
      await setup();

      const id = await createEntry(paths, identity, {
        title: "Edit",
        category: "diary",
        content: "original",
        tags: [],
      });

      await overwriteEntryContent(paths, identity, `${id}.age`, "updated-content");

      const content = await readEntryContent(paths, identity, `${id}.age`);
      expect(content).toBe("updated-content");
    });

    // ── Tags ──

    it("createEntry with tags stores and retrieves them", async () => {
      await setup();

      const id = await createEntry(paths, identity, {
        title: "Tagged",
        category: "secret",
        content: "tagged-content",
        tags: ["work", "personal"],
      });

      const db = openDatabase(paths);
      try {
        const tags = getTagsForEntry(db, id);
        const names = tags.map((t) => t.name).sort();
        expect(names).toEqual(["personal", "work"]);
      } finally {
        db.close();
      }
    });

    it("tags can be added after entry creation", async () => {
      await setup();

      const id = await createEntry(paths, identity, {
        title: "Late Tags",
        category: "note",
        content: "content",
        tags: [],
      });

      const db = openDatabase(paths);
      try {
        const t1 = ensureTag(db, "alpha");
        const t2 = ensureTag(db, "beta");
        attachTagsToEntry(db, id, [t1.id, t2.id]);

        const tags = getTagsForEntry(db, id);
        expect(tags.map((t) => t.name).sort()).toEqual(["alpha", "beta"]);
      } finally {
        db.close();
      }
    });

    // ── List & Category ──

    it("listEntryRecords filters by category", async () => {
      await setup();

      await createEntry(paths, identity, {
        title: "Diary",
        category: "diary",
        content: "d",
        tags: [],
      });
      await createEntry(paths, identity, {
        title: "Note",
        category: "note",
        content: "n",
        tags: [],
      });

      const db = openDatabase(paths);
      try {
        const all = listEntryRecords(db);
        expect(all).toHaveLength(2);

        const diaries = listEntryRecords(db, { category: "diary" });
        expect(diaries).toHaveLength(1);
        expect(diaries[0].title).toBe("Diary");
      } finally {
        db.close();
      }
    });

    // ── Search ──

    it("searchEntries matches title substring", async () => {
      await setup();

      await createEntry(paths, identity, {
        title: "Travel plans",
        category: "note",
        content: "going to Japan",
        tags: [],
      });
      await createEntry(paths, identity, {
        title: "Daily log",
        category: "diary",
        content: "woke up early",
        tags: [],
      });

      const db = openDatabase(paths);
      try {
        const results = searchEntries(db, "travel");
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe("Travel plans");
      } finally {
        db.close();
      }
    });

    it("searchEntries matches tag name", async () => {
      await setup();

      await createEntry(paths, identity, {
        title: "Work note",
        category: "note",
        content: "meeting",
        tags: ["work"],
      });
      await createEntry(paths, identity, {
        title: "Personal note",
        category: "note",
        content: "groceries",
        tags: ["personal"],
      });

      const db = openDatabase(paths);
      try {
        const results = searchEntries(db, "work");
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe("Work note");
      } finally {
        db.close();
      }
    });

    // ── Soft delete ──

    it("softDeleteEntry hides entry from list and show", async () => {
      await setup();

      const id = await createEntry(paths, identity, {
        title: "To Delete",
        category: "note",
        content: "bye",
        tags: [],
      });

      const db = openDatabase(paths);
      try {
        expect(getEntryById(db, id)).toBeDefined();
        expect(listEntryRecords(db)).toHaveLength(1);

        const ok = softDeleteEntry(db, id, new Date().toISOString());
        expect(ok).toBe(true);

        expect(getEntryById(db, id)).toBeUndefined();
        expect(listEntryRecords(db)).toHaveLength(0);
      } finally {
        db.close();
      }
    });

    // ── Attachments ──

    it("addAttachment encrypts file; exportAttachment restores it", async () => {
      await setup();

      const entryId = await createEntry(paths, identity, {
        title: "With Attachment",
        category: "note",
        content: "see attached",
        tags: [],
      });

      // Write a temp file to attach
      const srcFile = path.join(root, "source.txt");
      await fs.writeFile(srcFile, "hello-attachment-contents", "utf8");

      const attId = await addAttachment(paths, identity, {
        entryId,
        filePath: srcFile,
      });

      // Verify metadata
      const db = openDatabase(paths);
      try {
        const atts = listAttachmentsForEntry(db, entryId);
        expect(atts).toHaveLength(1);
        expect(atts[0].originalName).toBe("source.txt");
        expect(atts[0].sizeBytes).toBeGreaterThan(0);
      } finally {
        db.close();
      }

      // Verify encrypted file exists and is not plaintext
      const encPath = path.join(paths.attachmentsDir, `${attId}.age`);
      const encContent = await fs.readFile(encPath, "utf8");
      expect(encContent).not.toContain("hello-attachment");

      // Export and verify round-trip
      const exportPath = path.join(root, "exported.txt");
      await exportAttachment(paths, identity, attId, exportPath);

      const exported = await fs.readFile(exportPath, "utf8");
      expect(exported).toBe("hello-attachment-contents");
    });

    // ── Update metadata ──

    it("updateEntryRecord changes title and updatedAt", async () => {
      await setup();

      const id = await createEntry(paths, identity, {
        title: "Old Title",
        category: "note",
        content: "content",
        tags: [],
      });

      const db = openDatabase(paths);
      try {
        const ok = updateEntryRecord(db, id, {
          title: "New Title",
          updatedAt: new Date().toISOString(),
        });
        expect(ok).toBe(true);

        const entry = getEntryById(db, id);
        expect(entry?.title).toBe("New Title");
      } finally {
        db.close();
      }
    });

    it("session cache is reusable across separate Node processes", async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-cli-it-"));
      ensureCliBuilt();

      const openScript = `
        import { openSession } from "./dist/crypto/session.js";
        import path from "node:path";

        const root = process.env.ROOT;
        const paths = {
          homeDir: root,
          appDir: root,
          vaultDir: root,
          entriesDir: path.join(root, "entries"),
          attachmentsDir: path.join(root, "attachments"),
          configPath: path.join(root, "config.json"),
          dbPath: path.join(root, "db.sqlite"),
          keysDir: path.join(root, "keys"),
          wrappedIdentityPath: path.join(root, "keys", "id.age.enc"),
          sessionsDir: path.join(root, "sessions"),
        };
        await openSession(paths, Buffer.from("shared-identity"), 15);
        console.log("opened");
      `;
      const readScript = `
        import { getActiveSession } from "./dist/crypto/session.js";
        import path from "node:path";

        const root = process.env.ROOT;
        const paths = {
          homeDir: root,
          appDir: root,
          vaultDir: root,
          entriesDir: path.join(root, "entries"),
          attachmentsDir: path.join(root, "attachments"),
          configPath: path.join(root, "config.json"),
          dbPath: path.join(root, "db.sqlite"),
          keysDir: path.join(root, "keys"),
          wrappedIdentityPath: path.join(root, "keys", "id.age.enc"),
          sessionsDir: path.join(root, "sessions"),
        };
        const session = await getActiveSession(paths);
        console.log(session ? session.identityPlain.toString("utf8") : "missing");
      `;

      const openResult = spawnSync(
        "node",
        ["--input-type=module", "-e", openScript],
        {
          cwd: process.cwd(),
          env: { ...process.env, ROOT: root },
          encoding: "utf8",
        },
      );
      expect(openResult.status).toBe(0);
      expect(String(openResult.stdout)).toContain("opened");

      const readResult = spawnSync(
        "node",
        ["--input-type=module", "-e", readScript],
        {
          cwd: process.cwd(),
          env: { ...process.env, ROOT: root },
          encoding: "utf8",
        },
      );
      expect(readResult.status).toBe(0);
      expect(String(readResult.stdout)).toContain("shared-identity");
    });

    it("CLI supports explicit --vault override across commands", async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-cli-vault-"));
      paths = tempPaths(root);
      await initializeVault(paths, { masterPassword: "correct-horse" });

      const identityPlain = await unwrapIdentityWithPassword(
        "correct-horse",
        paths.wrappedIdentityPath,
      );
      let entryId: string;
      try {
        await openSession(paths, identityPlain, 15);
        entryId = await createEntry(paths, identityPlain, {
          title: "CLI Entry",
          category: "note",
          content: "hello from cli",
          tags: ["cli-tag"],
        });
      } finally {
        identityPlain.fill(0);
      }

      const showResult = runCli(root, ["show", entryId!]);
      expect(showResult.status).toBe(0);
      expect(String(showResult.stdout)).toContain("Title:    CLI Entry");
      expect(String(showResult.stdout)).toContain("hello from cli");

      const titleSearchResult = runCli(root, ["search", "--title", "cli-tag"]);
      expect(titleSearchResult.status).toBe(0);
      expect(String(titleSearchResult.stdout)).toContain("No matching entries found.");

      const tagSearchResult = runCli(root, ["search", "--tag", "cli-tag"]);
      expect(tagSearchResult.status).toBe(0);
      expect(String(tagSearchResult.stdout)).toContain("CLI Entry");
    });

    it("CLI init/unlock support scripted password input via --password-stdin", async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), "cerberus-cli-stdin-"));

      const initResult = runCli(
        root,
        ["init", "--password-stdin"],
        "correct-horse\ncorrect-horse\n",
      );
      expect(initResult.status).toBe(0);
      expect(String(initResult.stdout)).toContain("Vault initialized.");

      const unlockResult = runCli(
        root,
        ["unlock", "--password-stdin"],
        "correct-horse\n",
      );
      expect(unlockResult.status).toBe(0);
      expect(String(unlockResult.stdout)).toContain("Vault unlocked.");
    });
  },
);
