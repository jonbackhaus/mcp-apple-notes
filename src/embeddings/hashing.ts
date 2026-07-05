import { EmbeddingProvider, normalizeInPlace } from "./types.js";

/** FNV-1a 32-bit hash with a seed, used for feature hashing. */
function fnv1a(token: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return matches ?? [];
}

/**
 * Deterministic, dependency-free, offline embedding using signed feature
 * hashing (à la scikit-learn's HashingVectorizer). This captures *lexical*
 * similarity only — it is the always-available fallback so the server runs and
 * the test suite stays hermetic even when no ML model can be loaded.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly id: string;

  constructor(dimensions = 256) {
    this.dimensions = dimensions;
    this.id = `hash-${dimensions}`;
  }

  async init(): Promise<void> {
    // Nothing to load.
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): Float32Array {
    const vec = new Float32Array(this.dimensions);
    const tokens = tokenize(text);
    for (const token of tokens) {
      const bucket = fnv1a(token, 0x811c9dc5) % this.dimensions;
      const sign = (fnv1a(token, 0x9e3779b1) & 1) === 0 ? 1 : -1;
      vec[bucket]! += sign;
      // A light positional/bigram signal: also hash the token with a suffix so
      // documents sharing rare terms score higher than pure unigram overlap.
      const bucket2 = fnv1a(`${token}$`, 0x85ebca6b) % this.dimensions;
      vec[bucket2]! += sign * 0.5;
    }
    return normalizeInPlace(vec);
  }
}
