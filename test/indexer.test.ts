import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTestServices, sampleNotes } from "./helpers.js";

test("initial reindex adds every note and builds vectors", async () => {
  const { services } = await buildTestServices();
  const stats = await services.indexer.reindex({ full: false });
  assert.equal(stats.added, 4);
  assert.equal(stats.updated, 0);
  assert.equal(stats.total, 4);
  assert.equal(services.vectors.size, 4);
  assert.equal(services.repo.count(), 4);
});

test("incremental reindex skips unchanged notes", async () => {
  const { services } = await buildTestServices();
  await services.indexer.reindex();
  const second = await services.indexer.reindex();
  assert.equal(second.added, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 4);
});

test("changed note is re-embedded on next reindex", async () => {
  const { services, source } = await buildTestServices();
  await services.indexer.reindex();
  source.notes[0]!.text = "Completely different content about astronomy telescopes";
  source.notes[0]!.modifiedAt = "2024-06-01T00:00:00.000Z";
  const stats = await services.indexer.reindex();
  assert.equal(stats.updated, 1);
  assert.equal(stats.unchanged, 3);
});

test("full reindex prunes notes removed from the source", async () => {
  const { services, source } = await buildTestServices();
  await services.indexer.reindex();
  source.notes = source.notes.filter((n) => n.id !== "n1");
  const stats = await services.indexer.reindex({ full: true });
  assert.equal(stats.removed, 1);
  assert.equal(stats.total, 3);
  assert.equal(services.vectors.size, 3);
  assert.equal(services.repo.getStoredNote("n1"), undefined);
});

test("limit caps how many notes are pulled", async () => {
  const { services } = await buildTestServices(sampleNotes());
  const stats = await services.indexer.reindex({ limit: 2 });
  assert.equal(stats.added, 2);
  assert.equal(stats.total, 2);
});
