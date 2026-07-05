import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/db/database.js";
import { NotesRepo, type NoteUpsert } from "../src/db/notesRepo.js";

function upsert(overrides: Partial<NoteUpsert> = {}): NoteUpsert {
  return {
    id: "x",
    title: "Title",
    text: "body text",
    folder: "Folder",
    account: "iCloud",
    createdAt: "2024-01-01T00:00:00.000Z",
    modifiedAt: "2024-01-02T00:00:00.000Z",
    tags: ["a"],
    snippet: "body text",
    contentHash: "hash",
    embedding: new Float32Array([1, 0, 0, 0]),
    embeddingModel: "hash-4",
    indexedAt: "2024-01-03T00:00:00.000Z",
    ...overrides,
  };
}

test("upsert inserts then updates and bumps generation", () => {
  const repo = new NotesRepo(openDatabase(":memory:"));
  const g0 = repo.generation;
  repo.upsert(upsert({ id: "a", title: "First" }));
  assert.ok(repo.generation > g0);
  assert.equal(repo.count(), 1);
  repo.upsert(upsert({ id: "a", title: "Second" }));
  assert.equal(repo.count(), 1);
  assert.equal(repo.getStoredNote("a")!.title, "Second");
});

test("embeddings round-trip through BLOB storage", () => {
  const repo = new NotesRepo(openDatabase(":memory:"));
  repo.upsert(upsert({ id: "a", embedding: new Float32Array([0.5, -0.25, 1, 0.125]) }));
  const [entry] = repo.allEmbeddings("hash-4");
  assert.ok(entry);
  assert.deepEqual(Array.from(entry!.vector), [0.5, -0.25, 1, 0.125]);
});

test("allEmbeddings filters by model", () => {
  const repo = new NotesRepo(openDatabase(":memory:"));
  repo.upsert(upsert({ id: "a", embeddingModel: "hash-4" }));
  repo.upsert(upsert({ id: "b", embeddingModel: "other-model" }));
  assert.equal(repo.allEmbeddings("hash-4").length, 1);
  assert.equal(repo.allEmbeddings().length, 2);
});

test("queryByDate filters inclusively and orders desc", () => {
  const repo = new NotesRepo(openDatabase(":memory:"));
  repo.upsert(upsert({ id: "jan", createdAt: "2024-01-15T00:00:00.000Z" }));
  repo.upsert(upsert({ id: "mar", createdAt: "2024-03-15T00:00:00.000Z" }));
  repo.upsert(upsert({ id: "may", createdAt: "2024-05-15T00:00:00.000Z" }));
  const hits = repo.queryByDate(
    "created",
    "2024-02-01T00:00:00.000Z",
    "2024-04-01T00:00:00.000Z",
    10,
  );
  assert.deepEqual(hits.map((h) => h.id), ["mar"]);
});

test("queryByMetadata matches folder and account/author substrings", () => {
  const repo = new NotesRepo(openDatabase(":memory:"));
  repo.upsert(upsert({ id: "w", folder: "Work Projects", account: "iCloud" }));
  repo.upsert(upsert({ id: "p", folder: "Personal", account: "On My Mac" }));
  assert.deepEqual(repo.queryByMetadata({ folder: "work" }, 10).map((h) => h.id), ["w"]);
  assert.deepEqual(repo.queryByMetadata({ author: "my mac" }, 10).map((h) => h.id), ["p"]);
});

test("deleteByIds removes rows", () => {
  const repo = new NotesRepo(openDatabase(":memory:"));
  repo.upsert(upsert({ id: "a" }));
  repo.upsert(upsert({ id: "b" }));
  assert.equal(repo.deleteByIds(["a"]), 1);
  assert.equal(repo.count(), 1);
  assert.deepEqual([...repo.allIds()], ["b"]);
});

test("meta get/set persists values", () => {
  const repo = new NotesRepo(openDatabase(":memory:"));
  assert.equal(repo.metaGet("k"), undefined);
  repo.metaSet("k", "v1");
  repo.metaSet("k", "v2");
  assert.equal(repo.metaGet("k"), "v2");
});
