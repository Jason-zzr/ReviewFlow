import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { importMediaFiles, isManagedMediaPath } from "./media-library.js";

export const WORKSPACE_BUNDLE_MANIFEST = "workspace.reviewflow.json";
const WORKSPACE_BUNDLE_VERSION = 2;
const MEDIA_REFERENCE_PREFIX = "reviewflow-media://";
const MAX_MANIFEST_BYTES = 5_000_000;

interface BundleMediaEntry {
  reference: string;
  fileName: string;
  size: number;
  sha256: string;
}

interface WorkspaceBundleManifest {
  version: typeof WORKSPACE_BUNDLE_VERSION;
  exportedAt: string;
  workspace: unknown;
  media: BundleMediaEntry[];
}

interface LegacyWorkspaceExport {
  version: 1;
  workspace: unknown;
}

export interface ExportWorkspaceBundleOptions {
  workspace: unknown;
  mediaLibraryRoot: string;
  destinationRoot: string;
  exportedAt?: Date;
}

export interface ExportWorkspaceBundleResult {
  bundlePath: string;
  manifestPath: string;
  mediaCount: number;
}

export interface ImportWorkspaceBundleResult {
  workspace: unknown;
  importedMediaPaths: string[];
  sourceVersion: number;
}

const hashFile = (path: string): Promise<string> => new Promise((resolveHash, rejectHash) => {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.once("error", rejectHash);
  stream.once("end", () => resolveHash(hash.digest("hex")));
});

const isPathInside = (candidatePath: string, rootPath: string): boolean => {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath !== ""
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
};

const rewriteMediaPaths = async (
  value: unknown,
  rewrite: (path: string) => Promise<string>,
): Promise<unknown> => {
  if (Array.isArray(value)) return Promise.all(value.map((item) => rewriteMediaPaths(item, rewrite)));
  if (!value || typeof value !== "object") return value;
  const rewritten: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "mediaPaths") {
      if (!Array.isArray(child) || child.some((path) => typeof path !== "string")) {
        throw new Error("Workspace media paths are invalid");
      }
      rewritten[key] = await Promise.all(child.map((path) => rewrite(path as string)));
    } else {
      rewritten[key] = await rewriteMediaPaths(child, rewrite);
    }
  }
  return rewritten;
};

export const exportWorkspaceBundle = async (
  options: ExportWorkspaceBundleOptions,
): Promise<ExportWorkspaceBundleResult> => {
  if (!options.workspace || typeof options.workspace !== "object") throw new Error("Workspace is empty");
  mkdirSync(options.destinationRoot, { recursive: true });
  const destinationRoot = realpathSync(options.destinationRoot);
  const exportedAt = options.exportedAt ?? new Date();
  const name = `reviewflow-workspace-${exportedAt.toISOString().replace(/[:.]/g, "-")}`;
  const bundlePath = existsSync(join(destinationRoot, name))
    ? join(destinationRoot, `${name}-${randomUUID()}`)
    : join(destinationRoot, name);
  const temporaryPath = join(destinationRoot, `.${basename(bundlePath)}.${randomUUID()}.exporting`);
  const mediaDirectory = join(temporaryPath, "media");
  const mediaByReference = new Map<string, BundleMediaEntry>();

  mkdirSync(mediaDirectory, { recursive: true });
  try {
    const workspace = await rewriteMediaPaths(options.workspace, async (candidatePath) => {
      let source: string;
      try {
        source = realpathSync(candidatePath);
      } catch {
        throw new Error("Workspace media is missing; select it again before exporting");
      }
      if (!statSync(source).isFile() || !isManagedMediaPath(source, options.mediaLibraryRoot)) {
        throw new Error("Workspace media must come from the ReviewFlow media library");
      }
      const sha256 = await hashFile(source);
      const fileName = `${sha256}${extname(source).toLocaleLowerCase()}`;
      const reference = `${MEDIA_REFERENCE_PREFIX}${fileName}`;
      if (!mediaByReference.has(reference)) {
        copyFileSync(source, join(mediaDirectory, fileName), constants.COPYFILE_EXCL);
        mediaByReference.set(reference, { reference, fileName, size: statSync(source).size, sha256 });
      }
      return reference;
    });

    const manifest: WorkspaceBundleManifest = {
      version: WORKSPACE_BUNDLE_VERSION,
      exportedAt: exportedAt.toISOString(),
      workspace,
      media: [...mediaByReference.values()],
    };
    const manifestPath = join(temporaryPath, WORKSPACE_BUNDLE_MANIFEST);
    const serialized = JSON.stringify(manifest, null, 2);
    if (Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES) {
      throw new Error("Workspace manifest exceeds the 5 MB safety limit");
    }
    writeFileSync(manifestPath, serialized, { flag: "wx" });
    renameSync(temporaryPath, bundlePath);
    return {
      bundlePath,
      manifestPath: join(bundlePath, WORKSPACE_BUNDLE_MANIFEST),
      mediaCount: mediaByReference.size,
    };
  } catch (error) {
    rmSync(temporaryPath, { recursive: true, force: true });
    throw error;
  }
};

const parseBundleManifest = (manifestPath: string): WorkspaceBundleManifest | LegacyWorkspaceExport => {
  const source = realpathSync(manifestPath);
  const metadata = statSync(source);
  if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) {
    throw new Error("Workspace import exceeds the 5 MB safety limit");
  }
  const parsed = JSON.parse(readFileSync(source, "utf8")) as Partial<WorkspaceBundleManifest | LegacyWorkspaceExport>;
  if (!parsed.workspace || typeof parsed.workspace !== "object") {
    throw new Error("Unsupported ReviewFlow workspace bundle");
  }
  if (parsed.version === 1) return parsed as LegacyWorkspaceExport;
  if (parsed.version !== WORKSPACE_BUNDLE_VERSION || !("media" in parsed) || !Array.isArray(parsed.media)) {
    throw new Error("Unsupported ReviewFlow workspace bundle");
  }
  return parsed as WorkspaceBundleManifest;
};

export const importWorkspaceBundle = async (
  manifestPath: string,
  mediaLibraryRoot: string,
): Promise<ImportWorkspaceBundleResult> => {
  const manifest = parseBundleManifest(manifestPath);
  if (manifest.version === 1) {
    return { workspace: manifest.workspace, importedMediaPaths: [], sourceVersion: 1 };
  }
  const bundleRoot = dirname(realpathSync(manifestPath));
  const bundleMediaRoot = realpathSync(join(bundleRoot, "media"));
  if (!isPathInside(bundleMediaRoot, bundleRoot)) {
    throw new Error("Workspace media resolves outside the workspace bundle");
  }
  const sources: string[] = [];
  const references: string[] = [];
  for (const entry of manifest.media) {
    if (
      !entry
      || typeof entry.reference !== "string"
      || typeof entry.fileName !== "string"
      || entry.fileName !== basename(entry.fileName)
      || !entry.reference.startsWith(MEDIA_REFERENCE_PREFIX)
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error("Workspace media manifest is invalid");
    }
    const source = realpathSync(join(bundleMediaRoot, entry.fileName));
    if (!isPathInside(source, bundleMediaRoot)) {
      throw new Error("Workspace media resolves outside the workspace bundle");
    }
    if (!statSync(source).isFile() || statSync(source).size !== entry.size || await hashFile(source) !== entry.sha256) {
      throw new Error("Workspace media failed integrity verification");
    }
    sources.push(source);
    references.push(entry.reference);
  }

  const importedMediaPaths = importMediaFiles(sources, mediaLibraryRoot);
  const importedByReference = new Map(references.map((reference, index) => [reference, importedMediaPaths[index] as string]));
  const workspace = await rewriteMediaPaths(manifest.workspace, async (reference) => {
    const imported = importedByReference.get(reference);
    if (!imported) throw new Error("Workspace contains an unresolved media reference");
    return imported;
  });
  return { workspace, importedMediaPaths, sourceVersion: WORKSPACE_BUNDLE_VERSION };
};
