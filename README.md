# apple-notes-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that indexes
your **Apple Notes** into a local database — including a **vector database for
semantic search** — and exposes rich search tools to any MCP client (Claude
Desktop, Claude Code, etc.).

Everything runs **locally**. Notes are read through the macOS Notes scripting
interface; embeddings are computed on-device. No note ever leaves your machine.

## Search modalities

| Tool | What it does |
|------|--------------|
| `search_title` | **Fuzzy** title search (typo tolerant) |
| `search_tags` | Search by `#hashtags` (match *any* or *all*) |
| `search_semantic` | **Semantic** vector search — matches by meaning |
| `search_date` | Filter by `created` / `modified` date ranges |
| `search_metadata` | Filter by folder, account, or author |
| `get_note` | Fetch a note's full text by id |
| `list_folders` | List indexed folders + note counts |
| `index_status` | Note count, vector count, model, last reindex |
| `reindex_notes` | Sync notes from Apple Notes and (re)embed |

## How it works

```
Apple Notes ──(osascript / JXA, bulk read)──▶ Indexer ──▶ SQLite index
                                                 │            (node:sqlite)
                                                 ├─▶ tags, snippet, content hash
                                                 └─▶ EmbeddingProvider ──▶ vectors (BLOB)
                                                                              │
MCP client ◀── stdio JSON-RPC ── MCP server ── SearchService ◀── VectorStore (cosine KNN)
```

- **Storage** uses Node's built-in `node:sqlite` — no native build step.
- **Embeddings** are pluggable:
  - `transformers` — local [transformers.js](https://github.com/huggingface/transformers.js)
    running `all-MiniLM-L6-v2` (384-dim) on-device. *True semantic search.*
  - `hash` — a deterministic, offline lexical fallback so the server always
    runs (and the test suite stays hermetic) even with no model available.
  - `auto` (default) — try the model, fall back to hashing with a warning.
- **Vector search** persists normalized embeddings in SQLite and does exact
  cosine-similarity KNN in memory — fast and dependency-free for a personal
  Notes corpus.

## Requirements

- macOS with the Notes app
- Node.js ≥ 22.5 (for built-in `node:sqlite`)
- **Automation permission**: the first reindex asks macOS for permission to
  control Notes. Approve it (or grant it under *System Settings → Privacy &
  Security → Automation*). Without it, `reindex_notes` returns a clear error.

## Install & build

```bash
npm install        # core deps
npm run build      # compile TypeScript to dist/

# Optional: enable true semantic embeddings (downloads a small ML model on first use)
npm install @huggingface/transformers
```

## Usage

### 1. Build the index

```bash
npm run reindex -- --full     # first full sync of all notes
```

Or run it from within an MCP client by calling the `reindex_notes` tool.

### 2. Register with an MCP client

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "apple-notes": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-apple-notes/dist/src/index.js"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add apple-notes -- node /absolute/path/to/mcp-apple-notes/dist/src/index.js
```

Then ask things like *"search my notes for the pasta recipe"* (semantic),
*"find notes tagged #work"*, or *"what notes did I modify last week?"*.

## Configuration (environment variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `APPLE_NOTES_MCP_DB` | `~/.apple-notes-mcp/index.db` | SQLite index path |
| `APPLE_NOTES_MCP_DATA_DIR` | `~/.apple-notes-mcp` | Data directory |
| `EMBEDDINGS_PROVIDER` | `auto` | `auto` \| `transformers` \| `hash` |
| `EMBEDDINGS_MODEL` | `Xenova/all-MiniLM-L6-v2` | transformers.js model |
| `APPLE_NOTES_MCP_INDEX_ON_START` | `false` | Reindex when the server starts |
| `APPLE_NOTES_MCP_MAX_NOTES` | `0` | Cap notes per sync (0 = all) |
| `APPLE_NOTES_MCP_FETCH_TIMEOUT_MS` | `120000` | osascript read timeout |
| `APPLE_NOTES_MCP_MODEL_CACHE` | — | transformers.js cache dir |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # build + node --test (hermetic; no Notes / network needed)
```

The test suite uses a fake notes source and the deterministic hashing provider,
so it verifies the full pipeline — indexing, all five search modalities, and the
MCP server over an in-memory transport — without touching Apple Notes or the
network.

## Notes & limitations

- **Tags** are `#hashtags` extracted from note text (Apple Notes stores them
  inline; there is no scripting API for tag objects).
- **Author**: Apple Notes has no per-note author field. The closest real
  metadata is the owning **account**, so `search_metadata`'s `author` matches
  the account name.
- Password-protected (locked) notes are skipped where their content can't be
  read; the "Recently Deleted" folder is ignored.
- Reading very large libraries via AppleScript can be slow; use
  `APPLE_NOTES_MCP_MAX_NOTES` or `--limit` to bound a sync.

## License

MIT © Jonathan Backhaus
