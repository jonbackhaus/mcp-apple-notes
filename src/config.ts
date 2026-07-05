import { homedir } from "node:os";
import { join } from "node:path";

/** Runtime configuration, resolved from environment variables with defaults. */
export interface AppConfig {
  /** Absolute path to the SQLite index database. */
  dbPath: string;
  /** Which embedding backend to use. */
  embeddingProvider: "auto" | "transformers" | "hash";
  /** Model name for the transformers.js backend. */
  embeddingModel: string;
  /** Run a reindex automatically when the server starts. */
  indexOnStart: boolean;
  /** Max notes to pull from Apple Notes per reindex (0 = unlimited). */
  maxNotes: number;
  /** Timeout in ms for the osascript call that reads Apple Notes. */
  fetchTimeoutMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir =
    process.env.APPLE_NOTES_MCP_DATA_DIR ??
    join(homedir(), ".apple-notes-mcp");

  const providerRaw = (process.env.EMBEDDINGS_PROVIDER ?? "auto").toLowerCase();
  const embeddingProvider =
    providerRaw === "transformers" || providerRaw === "hash"
      ? (providerRaw as AppConfig["embeddingProvider"])
      : "auto";

  return {
    dbPath: process.env.APPLE_NOTES_MCP_DB ?? join(dataDir, "index.db"),
    embeddingProvider,
    embeddingModel:
      process.env.EMBEDDINGS_MODEL ?? "Xenova/all-MiniLM-L6-v2",
    indexOnStart: envBool("APPLE_NOTES_MCP_INDEX_ON_START", false),
    maxNotes: envInt("APPLE_NOTES_MCP_MAX_NOTES", 0),
    fetchTimeoutMs: envInt("APPLE_NOTES_MCP_FETCH_TIMEOUT_MS", 120_000),
    ...overrides,
  };
}
