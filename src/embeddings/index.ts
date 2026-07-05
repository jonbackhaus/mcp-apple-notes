import type { AppConfig } from "../config.js";
import { logger } from "../logger.js";
import { HashingEmbeddingProvider } from "./hashing.js";
import { TransformersEmbeddingProvider } from "./transformers.js";
import type { EmbeddingProvider } from "./types.js";

export type { EmbeddingProvider } from "./types.js";
export { HashingEmbeddingProvider } from "./hashing.js";
export { TransformersEmbeddingProvider } from "./transformers.js";

/**
 * Build and initialize the configured embedding provider.
 *
 * - `transformers`: require the local ML model (throws if unavailable).
 * - `hash`: force the deterministic offline fallback.
 * - `auto` (default): try the ML model, fall back to hashing with a warning so
 *   the server is always usable.
 */
export async function createEmbeddingProvider(
  config: Pick<AppConfig, "embeddingProvider" | "embeddingModel">,
): Promise<EmbeddingProvider> {
  if (config.embeddingProvider === "hash") {
    const provider = new HashingEmbeddingProvider();
    await provider.init();
    logger.info("Using hashing embedding provider", { id: provider.id });
    return provider;
  }

  if (config.embeddingProvider === "transformers") {
    const provider = new TransformersEmbeddingProvider(config.embeddingModel);
    await provider.init();
    return provider;
  }

  // auto
  try {
    const provider = new TransformersEmbeddingProvider(config.embeddingModel);
    await provider.init();
    return provider;
  } catch (err) {
    logger.warn(
      "Semantic model unavailable; falling back to lexical hashing embeddings. " +
        "Install the optional '@huggingface/transformers' dependency for true semantic search.",
      { error: (err as Error).message },
    );
    const provider = new HashingEmbeddingProvider();
    await provider.init();
    return provider;
  }
}
