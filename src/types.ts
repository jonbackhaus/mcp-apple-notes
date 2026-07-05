/**
 * Shared domain types for the Apple Notes MCP server.
 */

/** A note as returned by a {@link NotesSource}, before local processing. */
export interface RawNote {
  /** Stable identifier from the source (Apple Notes `x-coredata://…` id). */
  id: string;
  title: string;
  /** Primary textual content. May be HTML if `isHtml` is true. */
  text: string;
  /** Whether `text` is HTML and needs stripping. */
  isHtml?: boolean;
  folder: string;
  account: string;
  /** ISO-8601 timestamp, or null when the source did not provide one. */
  createdAt: string | null;
  modifiedAt: string | null;
}

/** A fully processed note as persisted in the local index. */
export interface StoredNote {
  id: string;
  title: string;
  text: string;
  folder: string;
  account: string;
  createdAt: string | null;
  modifiedAt: string | null;
  tags: string[];
  snippet: string;
}

/** A search hit returned to MCP clients (never includes full body text). */
export interface SearchResult {
  id: string;
  title: string;
  folder: string;
  account: string;
  createdAt: string | null;
  modifiedAt: string | null;
  tags: string[];
  snippet: string;
  /** Relevance score when the query type produces one (higher is better). */
  score?: number;
}

/** Summary statistics returned by a reindex operation. */
export interface ReindexStats {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  total: number;
  embeddingModel: string;
  durationMs: number;
}
