import { randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, statSync } from "node:fs";
import { basename, extname, join, sep } from "node:path";

const supportedExtensions = new Set([".mp4", ".mov", ".mkv", ".jpg", ".jpeg", ".png", ".webp"]);

export const isManagedMediaPath = (candidatePath: string, libraryRoot: string): boolean => {
  if (!existsSync(candidatePath) || !existsSync(libraryRoot)) return false;
  const candidate = realpathSync(candidatePath).toLocaleLowerCase();
  const root = realpathSync(libraryRoot).toLocaleLowerCase().replace(/[\\/]+$/, "");
  return candidate === root || candidate.startsWith(`${root}${sep}`);
};

export const importMediaFiles = (sourcePaths: string[], libraryRoot: string): string[] => {
  mkdirSync(libraryRoot, { recursive: true });
  const resolvedRoot = realpathSync(libraryRoot);
  return sourcePaths.map((sourcePath) => {
    const source = realpathSync(sourcePath);
    if (!statSync(source).isFile()) throw new Error("素材必须是普通文件");
    const extension = extname(source).toLocaleLowerCase();
    if (!supportedExtensions.has(extension)) throw new Error(`不支持的素材格式：${extension || "无扩展名"}`);
    const originalStem = basename(source, extname(source));
    const safeStem = originalStem.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "media";
    const fileName = `${randomUUID()}-${safeStem}${extension}`;
    const destination = join(resolvedRoot, fileName);
    const temporary = `${destination}.importing`;
    copyFileSync(source, temporary, constants.COPYFILE_EXCL);
    renameSync(temporary, destination);
    if (!isManagedMediaPath(destination, resolvedRoot)) throw new Error("素材导入路径越界");
    return realpathSync(destination);
  });
};
