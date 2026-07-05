import fs from "node:fs/promises";
import path from "node:path";

const EMPTY_STORE = {
  conversations: [],
  messages: []
};

export class FileStore {
  constructor(filePath = process.env.CHAT_DATA_FILE || "data/chat-store.json") {
    this.filePath = path.resolve(filePath);
  }

  async read() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        messages: Array.isArray(parsed.messages) ? parsed.messages : []
      };
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(EMPTY_STORE);
      throw error;
    }
  }

  async write(data) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}

export class UpstashStore {
  constructor({
    url = process.env.UPSTASH_REDIS_REST_URL,
    token = process.env.UPSTASH_REDIS_REST_TOKEN,
    key = process.env.UPSTASH_REDIS_KEY || "secured-chat-store"
  } = {}) {
    this.url = url?.replace(/\/$/, "");
    this.token = token;
    this.key = key;
  }

  async read() {
    const response = await fetch(`${this.url}/get/${encodeURIComponent(this.key)}`, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    if (!response.ok) throw new Error(`Upstash read failed: ${response.status}`);

    const payload = await response.json();
    if (!payload.result) return structuredClone(EMPTY_STORE);
    return JSON.parse(payload.result);
  }

  async write(data) {
    const response = await fetch(`${this.url}/set/${encodeURIComponent(this.key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(JSON.stringify(data))
    });
    if (!response.ok) throw new Error(`Upstash write failed: ${response.status}`);
  }
}

export function createStore() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return new UpstashStore();
  }
  return new FileStore();
}
