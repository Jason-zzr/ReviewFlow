import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importMediaFiles, isManagedMediaPath } from "./media-library.js";
import {
  exportWorkspaceBundle,
  importWorkspaceBundle,
  WORKSPACE_BUNDLE_MANIFEST,
} from "./workspace-transfer.js";

const temporaryRoots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "reviewflow-transfer-test-"));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("portable workspace bundles", () => {
  it("round-trips managed media into a different local library", async () => {
    const root = temporaryRoot();
    const sourceDirectory = join(root, "source");
    const sourceLibrary = join(root, "source-user-data", "media");
    mkdirSync(sourceDirectory, { recursive: true });
    const selectedMedia = join(sourceDirectory, "launch-video.mp4");
    writeFileSync(selectedMedia, "portable-media-fixture");
    const [managedMedia] = importMediaFiles([selectedMedia], sourceLibrary);
    expect(managedMedia).toBeDefined();

    const workspace = {
      content: { id: "content-1", mediaPaths: [managedMedia] },
      onboardingComplete: true,
    };
    const exported = await exportWorkspaceBundle({
      workspace,
      mediaLibraryRoot: sourceLibrary,
      destinationRoot: join(root, "exports"),
      exportedAt: new Date("2026-09-02T08:00:00.000Z"),
    });

    expect(exported.mediaCount).toBe(1);
    expect(exported.manifestPath).toBe(join(exported.bundlePath, WORKSPACE_BUNDLE_MANIFEST));
    expect(existsSync(exported.manifestPath)).toBe(true);
    expect(readFileSync(exported.manifestPath, "utf8")).not.toContain(managedMedia as string);

    const destinationLibrary = join(root, "destination-user-data", "media");
    const imported = await importWorkspaceBundle(exported.manifestPath, destinationLibrary);
    const importedWorkspace = imported.workspace as typeof workspace;
    const [importedMedia] = importedWorkspace.content.mediaPaths;

    expect(imported.sourceVersion).toBe(2);
    expect(importedMedia).toBeDefined();
    expect(isManagedMediaPath(importedMedia as string, destinationLibrary)).toBe(true);
    expect(readFileSync(importedMedia as string, "utf8")).toBe("portable-media-fixture");
    expect(importedWorkspace.onboardingComplete).toBe(true);
  });

  it("keeps legacy JSON exports importable", async () => {
    const root = temporaryRoot();
    const legacyPath = join(root, "legacy-workspace.json");
    const workspace = { content: { id: "legacy", mediaPaths: [] }, onboardingComplete: false };
    writeFileSync(legacyPath, JSON.stringify({ version: 1, workspace }));

    const imported = await importWorkspaceBundle(legacyPath, join(root, "media"));

    expect(imported).toEqual({ workspace, importedMediaPaths: [], sourceVersion: 1 });
  });

  it("rejects bundle media that resolves outside the selected bundle", async () => {
    const root = temporaryRoot();
    const bundle = join(root, "untrusted-bundle");
    const outside = join(root, "outside-media");
    mkdirSync(bundle);
    mkdirSync(outside);
    const bytes = "outside-bundle";
    const fileName = "payload.mp4";
    writeFileSync(join(outside, fileName), bytes);
    symlinkSync(outside, join(bundle, "media"), process.platform === "win32" ? "junction" : "dir");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const reference = `reviewflow-media://${fileName}`;
    writeFileSync(join(bundle, WORKSPACE_BUNDLE_MANIFEST), JSON.stringify({
      version: 2,
      exportedAt: "2026-09-02T08:00:00.000Z",
      workspace: { content: { mediaPaths: [reference] } },
      media: [{ reference, fileName, size: Buffer.byteLength(bytes), sha256 }],
    }));

    await expect(importWorkspaceBundle(
      join(bundle, WORKSPACE_BUNDLE_MANIFEST),
      join(root, "destination-media"),
    )).rejects.toThrow(/outside the workspace bundle/i);
  });
});
