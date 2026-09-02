import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const WORKSPACE_SCHEMA_VERSION = 1;

type WorkspaceMigration = (database: DatabaseSync) => void;

const assertWorkspaceStateSchema = (database: DatabaseSync): void => {
  const columns = database.prepare("PRAGMA table_info(workspace_state)").all() as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;
  const columnsByName = new Map(columns.map((column) => [column.name, column]));
  const invalidColumns = [
    { name: "id", type: "INTEGER", notnull: 0, pk: 1 },
    { name: "payload_json", type: "TEXT", notnull: 1, pk: 0 },
    { name: "updated_at", type: "TEXT", notnull: 1, pk: 0 },
  ].filter((expected) => {
    const actual = columnsByName.get(expected.name);
    return !actual
      || actual.type.trim().toUpperCase() !== expected.type
      || actual.notnull !== expected.notnull
      || actual.pk !== expected.pk;
  });
  if (invalidColumns.length > 0) {
    throw new Error(
      `Incompatible legacy workspace schema: workspace_state has invalid columns ${invalidColumns.map(({ name }) => name).join(", ")}`,
    );
  }
};

const WORKSPACE_MIGRATIONS: ReadonlyMap<number, WorkspaceMigration> = new Map([
  [
    0,
    (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS workspace_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      assertWorkspaceStateSchema(database);
    },
  ],
]);

const migrateWorkspaceDatabase = (database: DatabaseSync, currentVersion: number): void => {
  let version = currentVersion;
  while (version < WORKSPACE_SCHEMA_VERSION) {
    const migration = WORKSPACE_MIGRATIONS.get(version);
    if (!migration) throw new Error(`No workspace migration is registered for schema ${version}`);

    database.exec("BEGIN IMMEDIATE");
    try {
      migration(database);
      version += 1;
      database.exec(`PRAGMA user_version=${version}`);
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the migration error if SQLite already ended the transaction.
      }
      throw error;
    }
  }
};

const openWorkspaceDatabase = (databasePath: string): DatabaseSync => {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    const row = database.prepare("PRAGMA user_version").get() as { user_version: number };
    if (row.user_version > WORKSPACE_SCHEMA_VERSION) {
      throw new Error(`Workspace schema ${row.user_version} is newer than this application supports`);
    }
    database.exec("PRAGMA journal_mode=WAL");
    migrateWorkspaceDatabase(database, row.user_version);
    assertWorkspaceStateSchema(database);
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
