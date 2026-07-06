import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/db/database.js";
import { NotesRepo } from "../src/db/notesRepo.js";
import { HashingEmbeddingProvider } from "../src/embeddings/hashing.js";
import { AppleNotesSource, NotesPermissionError } from "../src/notes/appleNotes.js";
import { Indexer } from "../src/search/indexer.js";
import { VectorStore } from "../src/search/vectorStore.js";

/**
 * Build an Indexer wired to a real {@link AppleNotesSource} whose osascript
 * runner is stubbed, so the reindex path can be exercised hermetically.
 */
async function buildIndexer(source: AppleNotesSource): Promise<Indexer> {
  const db = openDatabase(":memory:");
  const repo = new NotesRepo(db);
  const embeddings = new HashingEmbeddingProvider(256);
  await embeddings.init();
  const vectors = new VectorStore(embeddings.dimensions);
  const indexer = new Indexer(source, repo, embeddings, vectors);
  indexer.loadVectors();
  return indexer;
}

test("fetchNotes raises NotesPermissionError when osascript reports a -1743 denial", async () => {
  // JXA's top-level authorization failure surfaces as a structured sentinel
  // instead of an empty array.
  const denial = JSON.stringify({
    __error: "execution error: Not authorized to send Apple events to Notes. (-1743)",
  });
  const source = new AppleNotesSource(1000, async () => denial);

  await assert.rejects(
    () => source.fetchNotes(),
    (err: unknown) => {
      assert.ok(
        err instanceof NotesPermissionError,
        `expected NotesPermissionError, got ${(err as Error)?.name}: ${(err as Error)?.message}`,
      );
      assert.match((err as Error).message, /System Settings/);
      assert.match((err as Error).message, /Automation/);
      return true;
    },
  );
});

test("fetchNotes returns no notes for an empty but authorized Notes library", async () => {
  const source = new AppleNotesSource(1000, async () => "[]");
  const notes = await source.fetchNotes();
  assert.deepEqual(notes, []);
});

test("fetchNotes still parses a normal note array", async () => {
  const payload = JSON.stringify([
    {
      id: "n1",
      title: "Hi",
      text: "hello",
      isHtml: false,
      folder: "Notes",
      account: "iCloud",
      createdAt: null,
      modifiedAt: null,
    },
  ]);
  const source = new AppleNotesSource(1000, async () => payload);
  const notes = await source.fetchNotes();
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.id, "n1");
});

test("reindex fails with NotesPermissionError on a -1743 denial", async () => {
  const denial = JSON.stringify({
    __error: "execution error: Not authorized to send Apple events to Notes. (-1743)",
  });
  const indexer = await buildIndexer(new AppleNotesSource(1000, async () => denial));
  await assert.rejects(() => indexer.reindex(), NotesPermissionError);
});

test("reindex of an empty but authorized library succeeds with total 0", async () => {
  const indexer = await buildIndexer(new AppleNotesSource(1000, async () => "[]"));
  const stats = await indexer.reindex();
  assert.equal(stats.added, 0);
  assert.equal(stats.total, 0);
});
