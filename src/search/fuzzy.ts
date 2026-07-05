import Fuse from "fuse.js";
import type { SearchResult } from "../types.js";

/**
 * Fuzzy title search backed by fuse.js. The underlying Fuse index is rebuilt
 * lazily whenever the repository generation changes, so repeated queries
 * between reindexes are cheap.
 */
export class FuzzyTitleIndex {
  private fuse: Fuse<SearchResult> | null = null;
  private builtFor = -1;

  private ensure(results: SearchResult[], generation: number): Fuse<SearchResult> {
    if (this.fuse && this.builtFor === generation) return this.fuse;
    this.fuse = new Fuse(results, {
      keys: ["title"],
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.45,
      minMatchCharLength: 1,
    });
    this.builtFor = generation;
    return this.fuse;
  }

  search(
    query: string,
    limit: number,
    results: SearchResult[],
    generation: number,
  ): SearchResult[] {
    const fuse = this.ensure(results, generation);
    return fuse
      .search(query, { limit })
      .map((hit) => ({
        ...hit.item,
        // Fuse score: 0 = perfect, 1 = worst. Convert to a relevance score.
        score: hit.score === undefined ? undefined : Number((1 - hit.score).toFixed(4)),
      }));
  }
}
