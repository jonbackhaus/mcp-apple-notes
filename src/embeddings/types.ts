/**
 * An embedding backend turns text into fixed-length unit vectors so that
 * cosine similarity (== dot product for normalized vectors) measures semantic
 * closeness.
 */
export interface EmbeddingProvider {
  /** Stable identity, e.g. `hash-256` or `transformers:Xenova/all-MiniLM-L6-v2`. */
  readonly id: string;
  /** Output vector length. Valid after {@link init} resolves. */
  readonly dimensions: number;
  /** Warm up / load the model. Safe to call more than once. */
  init(): Promise<void>;
  /** Embed a batch of texts into L2-normalized vectors (order preserved). */
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** L2-normalize a vector in place and return it. Zero vectors are left as-is. */
export function normalizeInPlace(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i]! * vec[i]!;
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] = vec[i]! / norm;
  }
  return vec;
}
