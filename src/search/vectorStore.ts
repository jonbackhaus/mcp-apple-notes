import { normalizeInPlace } from "../embeddings/types.js";

export interface VectorHit {
  id: string;
  score: number;
}

/**
 * In-memory nearest-neighbour index over unit vectors. Because every vector is
 * L2-normalized, cosine similarity reduces to a dot product. Exact (brute
 * force) search is O(N·d) per query, which is more than fast enough for a
 * personal Notes corpus (thousands to low tens of thousands of notes). The
 * vectors themselves are persisted in SQLite; this class is rebuilt from the
 * database and kept in sync on reindex.
 */
export class VectorStore {
  private ids: string[] = [];
  private vectors: Float32Array[] = [];
  private slot = new Map<string, number>();

  constructor(readonly dimensions: number) {}

  get size(): number {
    return this.ids.length;
  }

  clear(): void {
    this.ids = [];
    this.vectors = [];
    this.slot.clear();
  }

  /** Replace the entire index with the given entries. */
  load(entries: Array<{ id: string; vector: Float32Array }>): void {
    this.clear();
    for (const entry of entries) this.set(entry.id, entry.vector);
  }

  /** Insert or update the vector for an id. */
  set(id: string, vector: Float32Array): void {
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.dimensions}, got ${vector.length}`,
      );
    }
    const existing = this.slot.get(id);
    if (existing !== undefined) {
      this.vectors[existing] = vector;
      return;
    }
    this.slot.set(id, this.ids.length);
    this.ids.push(id);
    this.vectors.push(vector);
  }

  delete(id: string): boolean {
    const idx = this.slot.get(id);
    if (idx === undefined) return false;
    const lastIdx = this.ids.length - 1;
    const lastId = this.ids[lastIdx]!;
    // Swap the last element into the freed slot to keep the arrays dense.
    this.ids[idx] = lastId;
    this.vectors[idx] = this.vectors[lastIdx]!;
    this.slot.set(lastId, idx);
    this.ids.pop();
    this.vectors.pop();
    this.slot.delete(id);
    return true;
  }

  /** Return the top-k ids by cosine similarity to `query` (descending score). */
  search(query: Float32Array, k: number): VectorHit[] {
    if (k <= 0 || this.ids.length === 0) return [];
    const q =
      query.length === this.dimensions
        ? normalizeCopy(query)
        : padOrTruncate(query, this.dimensions);

    const top: VectorHit[] = [];
    let minScore = -Infinity;
    for (let i = 0; i < this.vectors.length; i++) {
      const score = dot(q, this.vectors[i]!);
      if (top.length < k) {
        top.push({ id: this.ids[i]!, score });
        if (top.length === k) {
          top.sort((a, b) => a.score - b.score);
          minScore = top[0]!.score;
        }
      } else if (score > minScore) {
        // Replace the current minimum, then re-establish the min.
        top[0] = { id: this.ids[i]!, score };
        top.sort((a, b) => a.score - b.score);
        minScore = top[0]!.score;
      }
    }
    return top.sort((a, b) => b.score - a.score);
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i]! * b[i]!;
  return sum;
}

function normalizeCopy(vec: Float32Array): Float32Array {
  return normalizeInPlace(Float32Array.from(vec));
}

function padOrTruncate(vec: Float32Array, dims: number): Float32Array {
  const out = new Float32Array(dims);
  out.set(vec.subarray(0, dims));
  return normalizeInPlace(out);
}
