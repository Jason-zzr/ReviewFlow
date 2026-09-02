import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importMediaFiles, isManagedMediaPath } from "./media-library.js";

const temporaryRoots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "reviewflow-media-test-"));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("managed media library", () => {
  it("copies selected media into the managed library with a collision-safe name", () => {
    const root = temporaryRoot();
    const source = join(root, "source", "测试 素材.mp4");
    const library = join(root, "user-data", "media");
    mkdirSync(join(root, "source"));
    writeFileSync(source, "fixture", { flag: "wx" });
    const [managed] = importMediaFiles([source], library);
    expect(managed).toBeDefined();
    expect(isManagedMediaPath(managed as string, library)).toBe(true);
    expect(readFileSync(managed as string, "utf8")).toBe("fixture");
    expect(managed).toMatch(/测试-素材\.mp4$/u);
  });

  it("rejects unsupported files before they enter the library", () => {
    const root = temporaryRoot();
    const source = join(root, "payload.exe");
    writeFileSync(source, "fixture");
    expect(() => importMediaFiles([source], join(root, "media"))).toThrow(/不支持的素材格式/);
  });

  it("does not accept sibling paths that merely share the library prefix", () => {
    const root = temporaryRoot();
    const library = join(root, "media");
    const sibling = join(root, "media-other", "clip.mp4");
    mkdirSync(join(root, "media-other"));
    writeFileSync(sibling, "fixture", { flag: "wx" });
    expect(isManagedMediaPath(sibling, library)).toBe(false);
  });
});
