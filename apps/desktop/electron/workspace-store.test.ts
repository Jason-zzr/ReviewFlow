import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadWorkspacePayload,
  saveWorkspacePayload,
  WORKSPACE_SCHEMA_VERSION,
} from "./workspace-store.js";

const temporaryRoots: string[] = [];

const databaseFixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), "reviewflow-workspace-test-"));
  temporaryRoots.push(root);
  return join(root, "data", "reviewflow.sqlite3");
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("workspace SQLite migrations", () => {
  it("persists workspace data and records the migration version", () => {
    const path = databaseFixture();
    saveWorkspacePayload(path, { contentId: "content-1" });
    expect(loadWorkspacePayload(path)).toEqual({ contentId: "content-1" });
    const database = new DatabaseSync(path);
    const row = database.prepare("PRAGMA user_version").get() as { user_version: number };
    database.close();
    expect(row.user_version).toBe(WORKSPACE_SCHEMA_VERSION);
  });

  it("refuses to silently downgrade a workspace created by a newer app", () => {
    const path = databaseFixture();
    mkdirSync(dirname(path), { recursive: true });
    const database = new DatabaseSync(path);
    database.exec(`PRAGMA user_version=${WORKSPACE_SCHEMA_VERSION + 1}`);
    database.close();
    expect(() => loadWorkspacePayload(path)).toThrow(/newer than this application supports/);
  });
});
