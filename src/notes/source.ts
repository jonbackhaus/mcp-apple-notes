import type { RawNote } from "../types.js";

/** Options accepted by a notes source when fetching. */
export interface FetchOptions {
  /** Cap on the number of notes to return (0/undefined = unlimited). */
  limit?: number;
}

/**
 * Abstraction over "somewhere notes come from". The real implementation reads
 * Apple Notes via osascript; tests inject an in-memory fake.
 */
export interface NotesSource {
  /** Human-readable name of the source, for diagnostics. */
  readonly name: string;
  /** Fetch all available notes (optionally capped). */
  fetchNotes(options?: FetchOptions): Promise<RawNote[]>;
}
