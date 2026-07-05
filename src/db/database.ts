import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Opens (creating if needed) the SQLite index database and applies the schema.
 *
 * Uses Node's built-in `node:sqlite` module so there is no native build step.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  applySchema(db);
  return db;
}

function applySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL DEFAULT '',
      text           TEXT NOT NULL DEFAULT '',
      folder         TEXT NOT NULL DEFAULT '',
      account        TEXT NOT NULL DEFAULT '',
      created_at     TEXT,
      modified_at    TEXT,
      tags           TEXT NOT NULL DEFAULT '[]',
      snippet        TEXT NOT NULL DEFAULT '',
      content_hash   TEXT NOT NULL DEFAULT '',
      embedding      BLOB,
      embedding_model TEXT,
      embedding_dims INTEGER,
      indexed_at     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_notes_modified ON notes(modified_at);
    CREATE INDEX IF NOT EXISTS idx_notes_created  ON notes(created_at);
    CREATE INDEX IF NOT EXISTS idx_notes_folder   ON notes(folder);
    CREATE INDEX IF NOT EXISTS idx_notes_account  ON notes(account);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/** Serialize a Float32Array to a Buffer for BLOB storage. */
export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** Deserialize a BLOB (Uint8Array/Buffer) back into a Float32Array (copied). */
export function blobToVector(blob: Uint8Array): Float32Array {
  const out = new Float32Array(Math.floor(blob.byteLength / 4));
  new Uint8Array(out.buffer).set(blob.subarray(0, out.byteLength * 4));
  return out;
}
