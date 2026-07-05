import type { DatabaseSync } from "node:sqlite";
import { blobToVector, vectorToBlob } from "./database.js";
import type { SearchResult, StoredNote } from "../types.js";

/** A note ready to be written to the index (post-processing). */
export interface NoteUpsert {
  id: string;
  title: string;
  text: string;
  folder: string;
  account: string;
  createdAt: string | null;
  modifiedAt: string | null;
  tags: string[];
  snippet: string;
  contentHash: string;
  embedding: Float32Array | null;
  embeddingModel: string | null;
  indexedAt: string;
}

/** Existing per-note fingerprint used to decide whether re-embedding is needed. */
export interface NoteFingerprint {
  contentHash: string;
  embeddingModel: string | null;
  hasEmbedding: boolean;
}

interface NoteRow {
  id: string;
  title: string;
  text: string;
  folder: string;
  account: string;
  created_at: string | null;
  modified_at: string | null;
  tags: string;
  snippet: string;
  content_hash: string;
  embedding: Uint8Array | null;
  embedding_model: string | null;
  embedding_dims: number | null;
  indexed_at: string | null;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToResult(row: NoteRow): SearchResult {
  return {
    id: row.id,
    title: row.title,
    folder: row.folder,
    account: row.account,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
    tags: parseTags(row.tags),
    snippet: row.snippet,
  };
}

/**
 * Data gateway over the `notes` table. Owns an in-memory `generation` counter
 * that increments on every write so caches (fuzzy index, vector store) can
 * cheaply detect staleness.
 */
export class NotesRepo {
  private generationValue = 0;

  constructor(private readonly db: DatabaseSync) {}

  get generation(): number {
    return this.generationValue;
  }

  private touch(): void {
    this.generationValue += 1;
  }

  upsert(note: NoteUpsert): void {
    const stmt = this.db.prepare(`
      INSERT INTO notes (
        id, title, text, folder, account, created_at, modified_at,
        tags, snippet, content_hash, embedding, embedding_model, embedding_dims, indexed_at
      ) VALUES (
        $id, $title, $text, $folder, $account, $created_at, $modified_at,
        $tags, $snippet, $content_hash, $embedding, $embedding_model, $embedding_dims, $indexed_at
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        text = excluded.text,
        folder = excluded.folder,
        account = excluded.account,
        created_at = excluded.created_at,
        modified_at = excluded.modified_at,
        tags = excluded.tags,
        snippet = excluded.snippet,
        content_hash = excluded.content_hash,
        embedding = excluded.embedding,
        embedding_model = excluded.embedding_model,
        embedding_dims = excluded.embedding_dims,
        indexed_at = excluded.indexed_at
    `);
    stmt.run({
      $id: note.id,
      $title: note.title,
      $text: note.text,
      $folder: note.folder,
      $account: note.account,
      $created_at: note.createdAt,
      $modified_at: note.modifiedAt,
      $tags: JSON.stringify(note.tags),
      $snippet: note.snippet,
      $content_hash: note.contentHash,
      $embedding: note.embedding ? vectorToBlob(note.embedding) : null,
      $embedding_model: note.embeddingModel,
      $embedding_dims: note.embedding ? note.embedding.length : null,
      $indexed_at: note.indexedAt,
    });
    this.touch();
  }

  deleteByIds(ids: string[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const stmt = this.db.prepare(`DELETE FROM notes WHERE id IN (${placeholders})`);
    const info = stmt.run(...ids);
    this.touch();
    return Number(info.changes);
  }

  fingerprints(): Map<string, NoteFingerprint> {
    const rows = this.db
      .prepare("SELECT id, content_hash, embedding_model, embedding FROM notes")
      .all() as unknown as Array<
      Pick<NoteRow, "id" | "content_hash" | "embedding_model" | "embedding">
    >;
    const map = new Map<string, NoteFingerprint>();
    for (const row of rows) {
      map.set(row.id, {
        contentHash: row.content_hash,
        embeddingModel: row.embedding_model,
        hasEmbedding: row.embedding != null,
      });
    }
    return map;
  }

  allIds(): Set<string> {
    const rows = this.db.prepare("SELECT id FROM notes").all() as unknown as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM notes").get() as unknown as {
      n: number;
    };
    return Number(row.n);
  }

  getStoredNote(id: string): StoredNote | undefined {
    const row = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as unknown as
      | NoteRow
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      title: row.title,
      text: row.text,
      folder: row.folder,
      account: row.account,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
      tags: parseTags(row.tags),
      snippet: row.snippet,
    };
  }

  getResult(id: string): SearchResult | undefined {
    const row = this.db
      .prepare(
        "SELECT id, title, folder, account, created_at, modified_at, tags, snippet FROM notes WHERE id = ?",
      )
      .get(id) as unknown as NoteRow | undefined;
    return row ? rowToResult(row) : undefined;
  }

  /** All notes as lightweight results (no body text). For in-memory filtering. */
  allResults(): SearchResult[] {
    const rows = this.db
      .prepare(
        "SELECT id, title, folder, account, created_at, modified_at, tags, snippet FROM notes",
      )
      .all() as unknown as NoteRow[];
    return rows.map(rowToResult);
  }

  /**
   * Every stored embedding, for loading into the in-memory vector store.
   * When `model` is given, only vectors produced by that embedding model are
   * returned (mixing models would make cosine distances meaningless).
   */
  allEmbeddings(model?: string): Array<{ id: string; vector: Float32Array }> {
    const sql = model
      ? "SELECT id, embedding FROM notes WHERE embedding IS NOT NULL AND embedding_model = ?"
      : "SELECT id, embedding FROM notes WHERE embedding IS NOT NULL";
    const rows = (model
      ? this.db.prepare(sql).all(model)
      : this.db.prepare(sql).all()) as unknown as Array<{ id: string; embedding: Uint8Array }>;
    return rows.map((r) => ({ id: r.id, vector: blobToVector(r.embedding) }));
  }

  queryByDate(
    field: "created" | "modified",
    from: string | null,
    to: string | null,
    limit: number,
  ): SearchResult[] {
    const column = field === "created" ? "created_at" : "modified_at";
    const clauses: string[] = [`${column} IS NOT NULL`];
    const params: string[] = [];
    if (from) {
      clauses.push(`${column} >= ?`);
      params.push(from);
    }
    if (to) {
      clauses.push(`${column} <= ?`);
      params.push(to);
    }
    const rows = this.db
      .prepare(
        `SELECT id, title, folder, account, created_at, modified_at, tags, snippet
         FROM notes WHERE ${clauses.join(" AND ")}
         ORDER BY ${column} DESC LIMIT ?`,
      )
      .all(...params, limit) as unknown as NoteRow[];
    return rows.map(rowToResult);
  }

  queryByMetadata(
    filters: { folder?: string; account?: string; author?: string; text?: string },
    limit: number,
  ): SearchResult[] {
    const clauses: string[] = ["1 = 1"];
    const params: string[] = [];
    if (filters.folder) {
      clauses.push("LOWER(folder) LIKE ?");
      params.push(`%${filters.folder.toLowerCase()}%`);
    }
    // "author" has no first-class field in Apple Notes; the closest real
    // metadata is the owning account, so we match author against account.
    const accountNeedle = filters.account ?? filters.author;
    if (accountNeedle) {
      clauses.push("LOWER(account) LIKE ?");
      params.push(`%${accountNeedle.toLowerCase()}%`);
    }
    if (filters.text) {
      clauses.push("(LOWER(title) LIKE ? OR LOWER(folder) LIKE ? OR LOWER(account) LIKE ?)");
      const needle = `%${filters.text.toLowerCase()}%`;
      params.push(needle, needle, needle);
    }
    const rows = this.db
      .prepare(
        `SELECT id, title, folder, account, created_at, modified_at, tags, snippet
         FROM notes WHERE ${clauses.join(" AND ")}
         ORDER BY modified_at DESC LIMIT ?`,
      )
      .all(...params, limit) as unknown as NoteRow[];
    return rows.map(rowToResult);
  }

  distinctFolders(): Array<{ folder: string; account: string; count: number }> {
    const rows = this.db
      .prepare(
        `SELECT folder, account, COUNT(*) AS count
         FROM notes GROUP BY folder, account ORDER BY account, folder`,
      )
      .all() as unknown as Array<{ folder: string; account: string; count: number }>;
    return rows.map((r) => ({ folder: r.folder, account: r.account, count: Number(r.count) }));
  }

  metaGet(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as unknown as
      | { value: string }
      | undefined;
    return row?.value;
  }

  metaSet(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }
}
