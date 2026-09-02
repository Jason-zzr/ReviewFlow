import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AiConfigStore } from "./ai-config-store.js";

const temporaryRoots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "reviewflow-ai-config-test-"));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("AI configuration isolation", () => {
  it("returns only key presence to the renderer while keeping the decryptable key in the main process", () => {
    const root = temporaryRoot();
    const cipher = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`protected:${[...value].reverse().join("")}`, "utf8"),
      decryptString: (value: Buffer) => [...value.toString("utf8").replace(/^protected:/, "")].reverse().join(""),
    };
    const store = new AiConfigStore(root, cipher);
    const apiKey = "sk-private-renderer-regression-key";

    const summary = store.save({
      baseUrl: "https://models.example.test/v1/",
      model: "creator-model",
      apiKey,
    });

    expect(summary).toEqual({
      baseUrl: "https://models.example.test/v1",
      model: "creator-model",
      hasKey: true,
    });
    expect(summary).not.toHaveProperty("apiKey");
    expect(store.getApiKey()).toBe(apiKey);
    expect(readFileSync(join(root, "secrets.bin"))).not.toContain(apiKey);
  });

  it("does not update public configuration when credential encryption fails", () => {
    const root = temporaryRoot();
    let encryptionShouldFail = false;
    const cipher = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => {
        if (encryptionShouldFail) throw new Error("credential encryption failed");
        return Buffer.from(`protected:${value}`, "utf8");
      },
      decryptString: (value: Buffer) => value.toString("utf8").replace(/^protected:/, ""),
    };
    const store = new AiConfigStore(root, cipher);
    store.save({ baseUrl: "https://old.example.test/v1", model: "old-model", apiKey: "old-key" });
    const previousConfig = readFileSync(join(root, "ai-config.json"));
    const previousSecret = readFileSync(join(root, "secrets.bin"));

    encryptionShouldFail = true;
    expect(() =>
      store.save({ baseUrl: "https://new.example.test/v1", model: "new-model", apiKey: "new-key" }),
    ).toThrow("credential encryption failed");

    expect(readFileSync(join(root, "ai-config.json"))).toEqual(previousConfig);
    expect(readFileSync(join(root, "secrets.bin"))).toEqual(previousSecret);
  });

  it("treats a damaged encrypted credential as unavailable", () => {
    const root = temporaryRoot();
    const cipher = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value, "utf8"),
      decryptString: () => {
        throw new Error("credential cannot be decrypted");
      },
    };
    const store = new AiConfigStore(root, cipher);
    writeFileSync(join(root, "secrets.bin"), "damaged-secret");

    expect(store.getSummary()).toEqual({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      hasKey: false,
    });
    expect(store.getApiKey()).toBe("");
  });
});
