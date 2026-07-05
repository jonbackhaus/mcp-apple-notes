import type { EmbeddingProvider } from "../embeddings/index.js";
import { logger } from "../logger.js";
import type { NotesRepo, NoteUpsert } from "../db/notesRepo.js";
import type { NotesSource } from "../notes/source.js";
import { contentHash, extractTags, makeSnippet, toPlainText } from "../notes/text.js";
import type { ReindexStats } from "../types.js";
import type { VectorStore } from "./vectorStore.js";

export interface ReindexOptions {
  /** Re-embed and re-store every note, ignoring content hashes. */
  full?: boolean;
  /** Cap notes pulled from the source (0 = unlimited). */
  limit?: number;
}

/** Max characters of note text fed to the embedding model. */
const EMBED_CHAR_CAP = 4000;
/** How many texts to embed per chunk (bounds memory + enables progress logs). */
const EMBED_CHUNK = 256;

/**
 * Pulls notes from a {@link NotesSource}, processes them, computes embeddings
 * for new/changed notes, and keeps the SQLite index and in-memory vector store
 * in sync. Incremental by default via per-note content hashes.
 */
export class Indexer {
  constructor(
    private readonly source: NotesSource,
    private readonly repo: NotesRepo,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectors: VectorStore,
  ) {}

  /** Rebuild the in-memory vector store from persisted embeddings. */
  loadVectors(): void {
    this.vectors.load(this.repo.allEmbeddings(this.embeddings.id));
    logger.info("Vector store loaded", {
      vectors: this.vectors.size,
      model: this.embeddings.id,
    });
  }

  async reindex(options: ReindexOptions = {}): Promise<ReindexStats> {
    const startedAt = Date.now();
    const full = options.full ?? false;
    const limit = options.limit ?? 0;

    const existing = this.repo.fingerprints();
    const raw = await this.source.fetchNotes({ limit });
    const seen = new Set<string>();

    interface Pending {
      base: Omit<NoteUpsert, "embedding" | "embeddingModel">;
      embedText: string;
      isNew: boolean;
    }
    const pending: Pending[] = [];
    let unchanged = 0;
    const now = new Date().toISOString();

    for (const note of raw) {
      if (!note.id) continue;
      seen.add(note.id);
      const plain = toPlainText(note);
      const tags = extractTags(`${note.title}\n${plain}`);
      const hash = contentHash({
        title: note.title,
        text: plain,
        folder: note.folder,
        account: note.account,
        modifiedAt: note.modifiedAt,
      });

      const fp = existing.get(note.id);
      const needsEmbed =
        full ||
        !fp ||
        fp.contentHash !== hash ||
        fp.embeddingModel !== this.embeddings.id ||
        !fp.hasEmbedding;

      if (!needsEmbed) {
        unchanged += 1;
        continue;
      }

      pending.push({
        base: {
          id: note.id,
          title: note.title,
          text: plain,
          folder: note.folder,
          account: note.account,
          createdAt: note.createdAt,
          modifiedAt: note.modifiedAt,
          tags,
          snippet: makeSnippet(plain),
          contentHash: hash,
          indexedAt: now,
        },
        embedText: `${note.title}\n${plain}`.slice(0, EMBED_CHAR_CAP),
        isNew: !fp,
      });
    }

    let added = 0;
    let updated = 0;
    for (let i = 0; i < pending.length; i += EMBED_CHUNK) {
      const chunk = pending.slice(i, i + EMBED_CHUNK);
      const vectors = await this.embeddings.embed(chunk.map((p) => p.embedText));
      for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j]!;
        const vector = vectors[j]!;
        this.repo.upsert({
          ...item.base,
          embedding: vector,
          embeddingModel: this.embeddings.id,
        });
        this.vectors.set(item.base.id, vector);
        if (item.isNew) added += 1;
        else updated += 1;
      }
      if (pending.length > EMBED_CHUNK) {
        logger.info("Embedding progress", {
          done: Math.min(i + EMBED_CHUNK, pending.length),
          total: pending.length,
        });
      }
    }

    // Remove notes that vanished from the source — only on a full pull, since a
    // limited/incremental pull does not observe the entire corpus.
    let removed = 0;
    if (full && limit === 0) {
      const toRemove = [...existing.keys()].filter((id) => !seen.has(id));
      if (toRemove.length > 0) {
        removed = this.repo.deleteByIds(toRemove);
        for (const id of toRemove) this.vectors.delete(id);
      }
    }

    // Ensure the vector store reflects exactly the current-model embeddings
    // (covers model switches and any drift).
    this.loadVectors();

    this.repo.metaSet("last_reindex", now);
    this.repo.metaSet("embedding_model", this.embeddings.id);

    const stats: ReindexStats = {
      added,
      updated,
      unchanged,
      removed,
      total: this.repo.count(),
      embeddingModel: this.embeddings.id,
      durationMs: Date.now() - startedAt,
    };
    logger.info("Reindex complete", stats);
    return stats;
  }
}
