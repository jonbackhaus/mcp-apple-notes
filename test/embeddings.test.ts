import assert from "node:assert/strict";
import { test } from "node:test";
import { HashingEmbeddingProvider } from "../src/embeddings/hashing.js";
import { normalizeInPlace } from "../src/embeddings/types.js";

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

test("hashing provider is deterministic and normalized", async () => {
  const p = new HashingEmbeddingProvider(256);
  await p.init();
  const [a] = await p.embed(["the quick brown fox"]);
  const [b] = await p.embed(["the quick brown fox"]);
  assert.ok(a && b);
  assert.equal(a!.length, 256);
  assert.deepEqual(Array.from(a!), Array.from(b!));
  // Unit length.
  const norm = Math.sqrt(cosine(a!, a!));
  assert.ok(Math.abs(norm - 1) < 1e-5, `expected unit vector, got norm ${norm}`);
});

test("hashing provider ranks lexical overlap higher", async () => {
  const p = new HashingEmbeddingProvider(512);
  await p.init();
  const [q, related, unrelated] = await p.embed([
    "boil pasta with tomato sauce",
    "pasta recipe: boil water then add tomato",
    "quarterly financial budget planning",
  ]);
  assert.ok(cosine(q!, related!) > cosine(q!, unrelated!));
});

test("normalizeInPlace leaves the zero vector untouched", () => {
  const z = new Float32Array([0, 0, 0]);
  normalizeInPlace(z);
  assert.deepEqual(Array.from(z), [0, 0, 0]);
});
