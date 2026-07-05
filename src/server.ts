import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { NotesRepo } from "./db/notesRepo.js";
import type { EmbeddingProvider } from "./embeddings/index.js";
import { logger } from "./logger.js";
import type { Indexer } from "./search/indexer.js";
import type { SearchService } from "./search/searchService.js";
import type { VectorStore } from "./search/vectorStore.js";

/** The wired-up runtime services the MCP tools operate on. */
export interface AppServices {
  repo: NotesRepo;
  embeddings: EmbeddingProvider;
  vectors: VectorStore;
  indexer: Indexer;
  search: SearchService;
}

const PKG_VERSION = "0.1.0";

function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Wrap a tool handler so thrown errors become clean MCP error results. */
function guard<T>(
  handler: (args: T) => Promise<CallToolResult> | CallToolResult,
): (args: T) => Promise<CallToolResult> {
  return async (args: T) => {
    try {
      return await handler(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Tool handler failed", { message });
      return errorResult(message);
    }
  };
}

const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Maximum number of results to return (default 20, max 100).");

/**
 * Build an MCP server exposing the Apple Notes search tools over the given
 * services. Pure with respect to transport — the caller connects it to stdio
 * (production) or an in-memory transport (tests).
 */
export function createMcpServer(services: AppServices): McpServer {
  const { search, indexer } = services;
  const server = new McpServer(
    { name: "apple-notes", version: PKG_VERSION },
    {
      instructions:
        "Search a local index of Apple Notes. Run `reindex_notes` once to build " +
        "the index (requires macOS Automation permission for Notes), then use the " +
        "search_* tools. Results contain a snippet only; call `get_note` for full text.",
    },
  );

  server.registerTool(
    "reindex_notes",
    {
      title: "Reindex Apple Notes",
      description:
        "Pull notes from the Apple Notes app into the local index and (re)compute " +
        "embeddings. Incremental by default (only changed notes are re-embedded). " +
        "Set full=true to rebuild everything. Requires macOS Automation permission " +
        "to control Notes.",
      inputSchema: {
        full: z
          .boolean()
          .optional()
          .describe("Rebuild every note and prune deleted notes (default false)."),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Only pull up to this many notes (for testing/large libraries)."),
      },
    },
    guard(async ({ full, limit }) => {
      const stats = await indexer.reindex({ full: full ?? false, limit: limit ?? 0 });
      return jsonResult(stats);
    }),
  );

  server.registerTool(
    "search_title",
    {
      title: "Fuzzy title search",
      description:
        "Find notes whose title fuzzy-matches the query (typo tolerant). Returns " +
        "notes ranked by title relevance.",
      inputSchema: {
        query: z.string().min(1).describe("Text to fuzzy-match against note titles."),
        limit: limitSchema,
      },
    },
    guard(({ query, limit }) => jsonResult(search.searchTitle(query, limit ?? 20))),
  );

  server.registerTool(
    "search_tags",
    {
      title: "Tag search",
      description:
        "Find notes by their hashtags (e.g. #work, #idea). The leading '#' is " +
        "optional. Use match='all' to require every tag, 'any' (default) for any.",
      inputSchema: {
        tags: z.array(z.string()).min(1).describe("Tags to match (with or without '#')."),
        match: z
          .enum(["any", "all"])
          .optional()
          .describe("Whether a note must contain any (default) or all of the tags."),
        limit: limitSchema,
      },
    },
    guard(({ tags, match, limit }) =>
      jsonResult(search.searchTags(tags, match ?? "any", limit ?? 20)),
    ),
  );

  server.registerTool(
    "search_semantic",
    {
      title: "Semantic search",
      description:
        "Find notes by meaning using vector embeddings — matches related concepts " +
        "even when the wording differs. Scores are cosine similarity (higher = closer).",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language description of what to find."),
        limit: limitSchema,
      },
    },
    guard(async ({ query, limit }) =>
      jsonResult(await search.searchSemantic(query, limit ?? 20)),
    ),
  );

  server.registerTool(
    "search_date",
    {
      title: "Date search",
      description:
        "Find notes created or modified within a date range. Dates may be " +
        "'YYYY-MM-DD' or full ISO-8601 timestamps; either bound may be omitted.",
      inputSchema: {
        field: z
          .enum(["created", "modified"])
          .optional()
          .describe("Which timestamp to filter on (default 'modified')."),
        from: z.string().optional().describe("Inclusive start date/timestamp."),
        to: z.string().optional().describe("Inclusive end date/timestamp."),
        limit: limitSchema,
      },
    },
    guard(({ field, from, to, limit }) =>
      jsonResult(search.searchDate(field ?? "modified", from ?? null, to ?? null, limit ?? 20)),
    ),
  );

  server.registerTool(
    "search_metadata",
    {
      title: "Metadata search",
      description:
        "Find notes by structured metadata: folder, account, or author. In Apple " +
        "Notes the closest thing to an author is the owning account, so 'author' " +
        "matches the account name. 'query' matches loosely across title/folder/account.",
      inputSchema: {
        folder: z.string().optional().describe("Folder name (substring match)."),
        account: z.string().optional().describe("Account name (substring match)."),
        author: z
          .string()
          .optional()
          .describe("Author — matched against the owning account name."),
        query: z
          .string()
          .optional()
          .describe("Free-text matched across title, folder, and account."),
        limit: limitSchema,
      },
    },
    guard(({ folder, account, author, query, limit }) =>
      jsonResult(
        search.searchMetadata({ folder, account, author, text: query }, limit ?? 20),
      ),
    ),
  );

  server.registerTool(
    "get_note",
    {
      title: "Get note",
      description: "Fetch a single note's full contents (plain text) by its id.",
      inputSchema: {
        id: z.string().min(1).describe("The note id returned by a search tool."),
      },
    },
    guard(({ id }) => {
      const note = search.getNote(id);
      return note ? jsonResult(note) : errorResult(`No note found with id: ${id}`);
    }),
  );

  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description: "List all indexed folders with their account and note counts.",
      inputSchema: {},
    },
    guard(() => jsonResult(search.listFolders())),
  );

  server.registerTool(
    "index_status",
    {
      title: "Index status",
      description:
        "Report index health: note count, vector count, embedding model, and last " +
        "reindex time.",
      inputSchema: {},
    },
    guard(() => jsonResult(search.status())),
  );

  return server;
}
