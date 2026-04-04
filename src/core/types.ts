export type EntryCategory =
  | "diary"
  | "note"
  | "last_words"
  | "collection"
  | "secret";

export interface CerberusConfig {
  version: 1;
  createdAt: string;
  sessionTtlMinutes: number;
}

export interface AppPaths {
  homeDir: string;
  appDir: string;
  vaultDir: string;
  entriesDir: string;
  attachmentsDir: string;
  configPath: string;
  dbPath: string;
  keysDir: string;
  wrappedIdentityPath: string;
  sessionsDir: string;
}

export interface AppContext {
  paths: AppPaths;
  config: CerberusConfig | undefined;
}

// ── Storage row types ──

export interface EntryRow {
  id: string;
  title: string;
  category: EntryCategory;
  contentPath: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TagRow {
  id: number;
  name: string;
}

export interface AttachmentRow {
  id: string;
  entryId: string;
  originalName: string;
  mimeType: string | null;
  encryptedPath: string;
  sizeBytes: number;
  createdAt: string;
}

