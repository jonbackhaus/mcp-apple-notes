import type { EmbeddingProvider } from "../embeddings/index.js";
import type { NotesRepo } from "../db/notesRepo.js";
import type { SearchResult, StoredNote } from "../types.js";
import { FuzzyTitleIndex } from "./fuzzy.js";
import type { VectorStore } from "./vectorStore.js";

export type DateField = "created" | "modified";
export type TagMatch = "any" | "all";

export interface MetadataFilters {
  folder?: string;
  account?: string;
  author?: string;
  text?: string;
}

export interface IndexStatus {
  totalNotes: number;
  vectorCount: number;
  embeddingModel: string | null;
  lastReindex: string | null;
}

/**
 * Read-side query API over the local index. Each method corresponds to one of
 * the required search modalities. All results omit full body text (only a
 * snippet is returned); use {@link getNote} to fetch a note's contents.
 */
export class SearchService {
  private readonly fuzzy = new FuzzyTitleIndex();

  constructor(
    private readonly repo: NotesRepo,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectors: VectorStore,
  ) {}

  /** Fuzzy match against note titles. */
  searchTitle(query: string, limit = 20): SearchResult[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return this.fuzzy.search(trimmed, limit, this.repo.allResults(), this.repo.generation);
  }

  /** Match notes by their extracted hashtags. */
  searchTags(tags: string[], match: TagMatch = "any", limit = 20): SearchResult[] {
    const wanted = tags
      .map((t) => t.trim().replace(/^#/, "").toLowerCase())
      .filter((t) => t.length > 0);
    if (wanted.length === 0) return [];

    const scored: SearchResult[] = [];
    for (const note of this.repo.allResults()) {
      const noteTags = new Set(note.tags.map((t) => t.toLowerCase()));
      const matched = wanted.filter((t) => noteTags.has(t));
      const ok = match === "all" ? matched.length === wanted.length : matched.length > 0;
      if (ok) {
        scored.push({ ...note, score: Number((matched.length / wanted.length).toFixed(4)) });
      }
    }
    scored.sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0) || cmpDateDesc(a.modifiedAt, b.modifiedAt),
    );
    return scored.slice(0, limit);
  }

  /** Semantic (embedding) search over note contents. */
  async searchSemantic(query: string, limit = 20): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const [vector] = await this.embeddings.embed([trimmed]);
    if (!vector) return [];
    const hits = this.vectors.search(vector, limit);
    const results: SearchResult[] = [];
    for (const hit of hits) {
      const note = this.repo.getResult(hit.id);
      if (note) results.push({ ...note, score: Number(hit.score.toFixed(4)) });
    }
    return results;
  }

  /** Filter notes by a created/modified date range (inclusive). */
  searchDate(
    field: DateField,
    from: string | null,
    to: string | null,
    limit = 20,
  ): SearchResult[] {
    const normFrom = from ? normalizeBoundary(from, false) : null;
    const normTo = to ? normalizeBoundary(to, true) : null;
    return this.repo.queryByDate(field, normFrom, normTo, limit);
  }

  /** Filter notes by structured metadata (folder, account/author, free text). */
  searchMetadata(filters: MetadataFilters, limit = 20): SearchResult[] {
    return this.repo.queryByMetadata(filters, limit);
  }

  getNote(id: string): StoredNote | undefined {
    return this.repo.getStoredNote(id);
  }

  listFolders(): Array<{ folder: string; account: string; count: number }> {
    return this.repo.distinctFolders();
  }

  status(): IndexStatus {
    return {
      totalNotes: this.repo.count(),
      vectorCount: this.vectors.size,
      embeddingModel: this.repo.metaGet("embedding_model") ?? this.embeddings.id,
      lastReindex: this.repo.metaGet("last_reindex") ?? null,
    };
  }
}

function cmpDateDesc(a: string | null, b: string | null): number {
  return (b ?? "").localeCompare(a ?? "");
}

/**
 * Normalize a user-supplied date boundary. A bare `YYYY-MM-DD` is expanded to
 * the start (or end, for the upper bound) of that UTC day so ranges are
 * inclusive; full timestamps are passed through. Throws on unparseable input.
 */
export function normalizeBoundary(value: string, isUpper: boolean): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return isUpper ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: "${value}". Use YYYY-MM-DD or an ISO-8601 timestamp.`);
  }
  return parsed.toISOString();
}
