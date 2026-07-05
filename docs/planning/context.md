# Planning Context — apple-notes-mcp

> Artifact for `man-mol-4al` (Prepare planning context), planning-base / basic
> methodology, interactive posture. Feeds the requirements step (`man-mol-w6a`).
> Prepared 2026-07-05.

## What this project is

An MCP (Model Context Protocol) server that indexes local **Apple Notes** into a
local SQLite database — including a **vector store for semantic search** — and
exposes search tools to any MCP client (Claude Desktop, Claude Code, etc.).
Everything runs locally; no note content leaves the machine. Package name
`apple-notes-mcp`, version `0.1.0`, MIT, author Jonathan Backhaus.

## Current state (baseline)

Feature-complete for a v0.1.0. This is **scope-what's-next**, not greenfield.

- **~1,775 LOC TypeScript**, ESM, Node ≥ 22.5 (uses built-in `node:sqlite` — no
  native build step).
- **Health: green.** `tsc --noEmit` passes; `npm test` = **39/39 pass**,
  hermetic (fake notes source + deterministic hash embeddings, no Notes/network).
- **Deps installed** (132 pkgs). Runtime deps: `@modelcontextprotocol/sdk`,
  `fuse.js`, `zod`.
- **⚠️ Entire implementation is UNCOMMITTED.** Git history is only the LICENSE
  "Initial commit" (`9922c75`); `src/`, `test/`, `package.json`, `README.md`,
  etc. are all untracked. Committing a clean baseline is an open decision (see
  below) — held under the conservative profile pending your authority.

## Architecture

```
Apple Notes ──(osascript/JXA bulk read)──▶ Indexer ──▶ SQLite index (node:sqlite)
                                              ├─▶ tags, snippet, content hash
                                              └─▶ EmbeddingProvider ──▶ vectors (BLOB)
MCP client ◀── stdio JSON-RPC ── MCP server ── SearchService ◀── VectorStore (cosine KNN)
```

- **Storage**: `node:sqlite` (built-in).
- **Embeddings (pluggable)**: `transformers` (transformers.js `all-MiniLM-L6-v2`,
  384-dim, on-device) · `hash` (deterministic offline lexical fallback, keeps
  tests hermetic) · `auto` (default: try model, fall back to hash).
- **Vector search**: normalized embeddings persisted in SQLite, exact in-memory
  cosine KNN. Fine for a personal corpus; not ANN-indexed.
- **Layout**: `db/` (database, notesRepo) · `embeddings/` (index, transformers,
  hashing, types) · `notes/` (appleNotes source, source iface, text) · `search/`
  (searchService, indexer, vectorStore, fuzzy) · `server.ts` (MCP tools) ·
  `index.ts` (wiring + stdio + `reindex` CLI) · `config.ts` · `logger.ts`.

## MCP surface (9 tools)

| Tool | Purpose |
|------|---------|
| `reindex_notes` | Pull from Apple Notes + (re)embed; incremental, `full=true` rebuilds |
| `search_title` | Fuzzy title search (typo tolerant, fuse.js) |
| `search_tags` | `#hashtag` search, match any/all |
| `search_semantic` | Vector/meaning search (cosine) |
| `search_date` | created/modified range filter |
| `search_metadata` | folder / account / author(=account) filter |
| `get_note` | Full note text by id |
| `list_folders` | Indexed folders + counts |
| `index_status` | Note/vector counts, model, last reindex |

## Known limitations (from README)

- Tags are `#hashtags` parsed from text (no scripting API for tag objects).
- No per-note author in Apple Notes → `author` matches the owning account.
- Locked/password-protected notes skipped; "Recently Deleted" ignored.
- Large libraries via AppleScript can be slow (bounded by `--limit` /
  `APPLE_NOTES_MCP_MAX_NOTES`).

## Open questions for the requirements step

These are the decisions the requirements phase (`man-mol-w6a`) should resolve —
what does "next" mean for this project?

1. **Goal of this planning cycle** — harden/ship v0.1.0 as-is? add features?
   fix a specific pain point? Publish to npm (the `bin` + `files` fields suggest
   distribution intent)?
2. **Baseline commit** — commit the current green tree as the v0.1.0 baseline
   before any new work? (Requires your go-ahead; conservative profile.)
3. **Real-Notes validation** — tests are hermetic; has the server been run
   against an actual Apple Notes library end-to-end (Automation permission,
   large-library timing, locked-note handling)?
4. **Semantic path** — `transformers` is optional/lazy-installed; is true
   semantic search a first-class requirement or is `hash` fallback acceptable
   for now? Model download/cache UX?
5. **Distribution** — npm publish? README says `dist/src` + `bin`; is a release
   pipeline in scope?
6. **Feature gaps** — anything wanted beyond the 9 tools? (e.g. write/create
   notes, full-text keyword search, folder/account scoping on every tool,
   pagination, result ranking blends.)
7. **Scale/perf** — is exact in-memory KNN sufficient for the target corpus, or
   is ANN/indexing a requirement?

## Pointers

- README: `README.md` (139 lines, thorough — install, config, usage, limits).
- Config/env vars: `src/config.ts` + README "Configuration" table.
- MCP tools: `src/server.ts`.
- Wiring & CLI: `src/index.ts`.
- Tests: `test/` (7 files, 39 cases; `helpers.ts` = fake source + hash provider).
