import type { PublicationStatus, PublishManifest } from "./types.js";

const transitions: Record<PublicationStatus, PublicationStatus[]> = {
  draft: ["awaiting_confirmation"],
  awaiting_confirmation: ["submitted"],
  submitted: ["processing", "failed", "unknown"],
  processing: ["published", "failed", "unknown"],
  published: [],
  failed: ["awaiting_confirmation"],
  unknown: ["processing", "published", "failed"],
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const digestManifest = async (manifest: PublishManifest): Promise<string> => {
  const canonical = stableJson({ ...manifest, digest: undefined });
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const sealManifest = async (manifest: PublishManifest): Promise<PublishManifest> => ({
  ...manifest,
  digest: await digestManifest(manifest),
});

export const assertConfirmedManifest = async (
  manifest: PublishManifest,
  confirmationDigest: string,
): Promise<void> => {
  const expected = await digestManifest(manifest);
  if (!manifest.digest || manifest.digest !== expected || confirmationDigest !== expected) {
    throw new Error("Publish manifest changed after preview; generate and confirm a new preview");
  }
};

export const transitionPublication = (
  current: PublicationStatus,
  next: PublicationStatus,
): PublicationStatus => {
  if (!transitions[current].includes(next)) {
    throw new Error(`Invalid publication transition: ${current} -> ${next}`);
  }
  return next;
};

