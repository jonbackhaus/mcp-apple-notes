import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeBoundary } from "../src/search/searchService.js";
import { buildTestServices } from "./helpers.js";

async function indexedServices() {
  const harness = await buildTestServices();
  await harness.services.indexer.reindex({ full: true });
  return harness.services;
}

test("searchTitle tolerates typos", async () => {
  const s = await indexedServices();
  const hits = s.search.searchTitle("grocary list");
  assert.ok(hits.length >= 1);
  assert.equal(hits[0]!.id, "n1");
  assert.ok(hits[0]!.score !== undefined);
});

test("searchTags matches any/all", async () => {
  const s = await indexedServices();
  const anyWork = s.search.searchTags(["work"]);
  assert.deepEqual(anyWork.map((h) => h.id).sort(), ["n2", "n4"]);

  const allWorkPlanning = s.search.searchTags(["work", "planning"], "all");
  assert.deepEqual(allWorkPlanning.map((h) => h.id), ["n2"]);

  // Leading '#' is tolerated.
  assert.equal(s.search.searchTags(["#food"]).length, 1);
});

test("searchSemantic ranks the conceptually closest note first", async () => {
  const s = await indexedServices();
  const hits = await s.search.searchSemantic("boil pasta with tomato sauce", 3);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0]!.id, "n3");
  assert.ok(hits[0]!.score !== undefined);
});

test("searchDate filters by created range inclusively", async () => {
  const s = await indexedServices();
  const hits = s.search.searchDate("created", "2024-03-01", "2024-03-31");
  assert.deepEqual(hits.map((h) => h.id), ["n2"]);
});

test("searchDate with only a lower bound on modified", async () => {
  const s = await indexedServices();
  const hits = s.search.searchDate("modified", "2024-03-01", null);
  assert.deepEqual(hits.map((h) => h.id).sort(), ["n2", "n4"]);
});

test("searchMetadata filters by folder and account/author", async () => {
  const s = await indexedServices();
  assert.deepEqual(
    s.search.searchMetadata({ folder: "Work" }).map((h) => h.id).sort(),
    ["n2", "n4"],
  );
  assert.deepEqual(
    s.search.searchMetadata({ author: "On My Mac" }).map((h) => h.id),
    ["n3"],
  );
});

test("getNote returns full text; listFolders and status report the index", async () => {
  const s = await indexedServices();
  const note = s.search.getNote("n3");
  assert.ok(note);
  assert.match(note!.text, /tomato sauce & basil/);
  assert.deepEqual(note!.tags.sort(), ["food", "recipe"]);

  const folders = s.search.listFolders();
  assert.ok(folders.some((f) => f.folder === "Work" && f.count === 2));

  const status = s.search.status();
  assert.equal(status.totalNotes, 4);
  assert.equal(status.vectorCount, 4);
});

test("normalizeBoundary expands bare dates and rejects garbage", () => {
  assert.equal(normalizeBoundary("2024-01-01", false), "2024-01-01T00:00:00.000Z");
  assert.equal(normalizeBoundary("2024-01-01", true), "2024-01-01T23:59:59.999Z");
  assert.throws(() => normalizeBoundary("not-a-date", false));
});
