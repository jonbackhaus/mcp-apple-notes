import { logger } from "../logger.js";
import { EmbeddingProvider } from "./types.js";

/**
 * Local semantic embeddings via transformers.js (`@huggingface/transformers`),
 * an optional dependency. Runs a sentence-transformer (default
 * all-MiniLM-L6-v2, 384-dim) fully on-device via ONNX Runtime. The model is
 * downloaded once and cached; no data leaves the machine.
 */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  private dims = 384;
  private extractor: ((input: string[], opts: unknown) => Promise<TransformersTensor>) | null =
    null;

  constructor(private readonly modelName: string) {
    this.id = `transformers:${modelName}`;
  }

  get dimensions(): number {
    return this.dims;
  }

  async init(): Promise<void> {
    if (this.extractor) return;
    // A non-literal specifier keeps the TypeScript compiler from requiring the
    // optional dependency to be installed at build time.
    const specifier = "@huggingface/transformers";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(specifier);

    const cacheDir = process.env.APPLE_NOTES_MCP_MODEL_CACHE;
    if (cacheDir && mod.env) {
      mod.env.cacheDir = cacheDir;
    }

    logger.info("Loading embedding model (first run downloads weights)", {
      model: this.modelName,
    });
    this.extractor = await mod.pipeline("feature-extraction", this.modelName);

    // Warm up to discover the true dimensionality.
    const probe = await this.extractor!(["dimension probe"], {
      pooling: "mean",
      normalize: true,
    });
    const list = probe.tolist();
    if (Array.isArray(list) && Array.isArray(list[0])) {
      this.dims = list[0].length;
    }
    logger.info("Embedding model ready", { model: this.modelName, dimensions: this.dims });
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.extractor) await this.init();
    const out: Float32Array[] = [];
    const batchSize = 16;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => t || " ");
      const tensor = await this.extractor!(batch, { pooling: "mean", normalize: true });
      const rows = tensor.tolist() as number[][];
      for (const row of rows) out.push(Float32Array.from(row));
    }
    return out;
  }
}

interface TransformersTensor {
  tolist(): number[][] | number[];
}
