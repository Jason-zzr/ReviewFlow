import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const WORKSPACE_SCHEMA_VERSION = 1;

const openWorkspaceDatabase = (databasePath: string): DatabaseSync => {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    const row = database.prepare("PRAGMA user_version").get() as { user_version: number };
    if (row.user_version > WORKSPACE_SCHEMA_VERSION) {
      throw new Error(`Workspace schema ${row.user_version} is newer than this application supports`);
    }
    database.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS workspace_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version=${WORKSPACE_SCHEMA_VERSION};
    `);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
};

export const loadWorkspacePayload = (databasePath: string): unknown => {
  const database = openWorkspaceDatabase(databasePath);
  try {
    const row = database.prepare("SELECT payload_json FROM workspace_state WHERE id = 1").get() as
      | { payload_json: string }
      | undefined;
    return row ? JSON.parse(row.payload_json) as unknown : null;
  } finally {
    database.close();
  }
};

export const saveWorkspacePayload = (databasePath: string, payload: unknown): void => {
  const serialized = JSON.stringify(payload);
  if (serialized.length > 5_000_000) throw new Error("Workspace payload exceeds the 5 MB safety limit");
  const database = openWorkspaceDatabase(databasePath);
  try {
    database.prepare(`
      INSERT INTO workspace_state(id, payload_json, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at
    `).run(serialized, new Date().toISOString());
  } finally {
    database.close();
  }
};
