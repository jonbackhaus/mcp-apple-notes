import assert from "node:assert/strict";
import { test } from "node:test";
import { VectorStore } from "../src/search/vectorStore.js";

function unit(x: number, y: number): Float32Array {
  const v = new Float32Array([x, y]);
  const n = Math.hypot(x, y) || 1;
  v[0]! /= n;
  v[1]! /= n;
  return v;
}

test("returns nearest neighbours in descending score order", () => {
  const store = new VectorStore(2);
  store.set("east", unit(1, 0));
  store.set("north", unit(0, 1));
  store.set("northeast", unit(1, 1));
  const hits = store.search(unit(1, 0.1), 3);
  assert.equal(hits.length, 3);
  assert.equal(hits[0]!.id, "east");
  // Scores are sorted descending.
  assert.ok(hits[0]!.score >= hits[1]!.score);
  assert.ok(hits[1]!.score >= hits[2]!.score);
});

test("respects k and never exceeds the store size", () => {
  const store = new VectorStore(2);
  store.set("a", unit(1, 0));
  store.set("b", unit(0, 1));
  assert.equal(store.search(unit(1, 0), 1).length, 1);
  assert.equal(store.search(unit(1, 0), 10).length, 2);
  assert.equal(store.search(unit(1, 0), 0).length, 0);
});

test("set updates existing vectors in place", () => {
  const store = new VectorStore(2);
  store.set("a", unit(1, 0));
  store.set("a", unit(0, 1));
  assert.equal(store.size, 1);
  const hit = store.search(unit(0, 1), 1)[0]!;
  assert.equal(hit.id, "a");
  assert.ok(hit.score > 0.99);
});

test("delete removes a vector and keeps the index consistent", () => {
  const store = new VectorStore(2);
  store.set("a", unit(1, 0));
  store.set("b", unit(0, 1));
  store.set("c", unit(1, 1));
  assert.equal(store.delete("a"), true);
  assert.equal(store.delete("a"), false);
  assert.equal(store.size, 2);
  const ids = store.search(unit(1, 1), 5).map((h) => h.id).sort();
  assert.deepEqual(ids, ["b", "c"]);
});

test("load replaces the whole index", () => {
  const store = new VectorStore(2);
  store.set("old", unit(1, 0));
  store.load([
    { id: "x", vector: unit(1, 0) },
    { id: "y", vector: unit(0, 1) },
  ]);
  assert.equal(store.size, 2);
  assert.equal(store.search(unit(1, 0), 1)[0]!.id, "x");
});
