import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface AiConfig {
  baseUrl: string;
  model: string;
}

export interface PublicAiConfig extends AiConfig {
  hasKey: boolean;
}

export interface CredentialCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const defaultConfig: AiConfig = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
};

export class AiConfigStore {
  readonly #configPath: string;
  readonly #secretPath: string;
  readonly #cipher: CredentialCipher;

  constructor(userDataPath: string, cipher: CredentialCipher) {
    this.#configPath = join(userDataPath, "ai-config.json");
    this.#secretPath = join(userDataPath, "secrets.bin");
    this.#cipher = cipher;
  }

  #writeAtomic(path: string, data: string | Buffer): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, data);
    renameSync(temporary, path);
  }

  #restore(path: string, previous: Buffer | undefined): void {
    if (previous) {
      this.#writeAtomic(path, previous);
      return;
    }
    rmSync(path, { force: true });
  }

  getConfig(): AiConfig {
    try {
      const parsed = JSON.parse(readFileSync(this.#configPath, "utf8")) as Partial<AiConfig>;
      if (typeof parsed.baseUrl !== "string" || typeof parsed.model !== "string") return { ...defaultConfig };
      return { baseUrl: parsed.baseUrl, model: parsed.model };
    } catch {
      return { ...defaultConfig };
    }
  }

  getApiKey(): string {
    if (!this.#cipher.isEncryptionAvailable() || !existsSync(this.#secretPath)) return "";
    try {
      return this.#cipher.decryptString(readFileSync(this.#secretPath));
    } catch {
      return "";
    }
  }

  getSummary(): PublicAiConfig {
    return { ...this.getConfig(), hasKey: Boolean(this.getApiKey()) };
  }

  save(input: AiConfig & { apiKey?: string }): PublicAiConfig {
    const baseUrl = new URL(input.baseUrl);
    if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "127.0.0.1" && baseUrl.hostname !== "localhost") {
      throw new Error("AI base URL must use HTTPS or localhost");
    }
    const config = { baseUrl: input.baseUrl.replace(/\/$/, ""), model: input.model };
    let encryptedApiKey: Buffer | undefined;
    if (input.apiKey) {
      if (!this.#cipher.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable");
      encryptedApiKey = this.#cipher.encryptString(input.apiKey);
    }

    const previousConfig = existsSync(this.#configPath) ? readFileSync(this.#configPath) : undefined;
    const previousSecret = encryptedApiKey && existsSync(this.#secretPath) ? readFileSync(this.#secretPath) : undefined;
    try {
      if (encryptedApiKey) this.#writeAtomic(this.#secretPath, encryptedApiKey);
      this.#writeAtomic(this.#configPath, JSON.stringify(config));
    } catch (error) {
      this.#restore(this.#configPath, previousConfig);
      if (encryptedApiKey) this.#restore(this.#secretPath, previousSecret);
      throw error;
    }
    return this.getSummary();
  }
}
