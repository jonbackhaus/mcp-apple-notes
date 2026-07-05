#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type AppConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { NotesRepo } from "./db/notesRepo.js";
import { createEmbeddingProvider } from "./embeddings/index.js";
import { logger } from "./logger.js";
import { AppleNotesSource } from "./notes/appleNotes.js";
import { Indexer } from "./search/indexer.js";
import { SearchService } from "./search/searchService.js";
import { VectorStore } from "./search/vectorStore.js";
import { createMcpServer, type AppServices } from "./server.js";

/** Wire up all runtime services against the real Apple Notes source. */
export async function buildServices(config: AppConfig): Promise<AppServices> {
  const db = openDatabase(config.dbPath);
  const repo = new NotesRepo(db);
  const embeddings = await createEmbeddingProvider(config);
  const vectors = new VectorStore(embeddings.dimensions);
  const source = new AppleNotesSource(config.fetchTimeoutMs);
  const indexer = new Indexer(source, repo, embeddings, vectors);
  indexer.loadVectors();
  const search = new SearchService(repo, embeddings, vectors);
  return { repo, embeddings, vectors, indexer, search };
}

async function runReindexCli(config: AppConfig, argv: string[]): Promise<void> {
  const full = argv.includes("--full");
  const limitFlag = argv.indexOf("--limit");
  const limit =
    limitFlag >= 0 && argv[limitFlag + 1] ? Number.parseInt(argv[limitFlag + 1]!, 10) : 0;

  const services = await buildServices(config);
  const stats = await services.indexer.reindex({ full, limit: Number.isFinite(limit) ? limit : 0 });
  // CLI mode: stdout is not an MCP channel here, so printing the report is fine.
  process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
}

async function runServer(config: AppConfig): Promise<void> {
  const services = await buildServices(config);

  if (config.indexOnStart) {
    try {
      await services.indexer.reindex({ full: false });
    } catch (err) {
      logger.warn("Index-on-start failed; continuing with existing index", {
        error: (err as Error).message,
      });
    }
  }

  const server = createMcpServer(services);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("apple-notes MCP server ready on stdio", {
    notes: services.repo.count(),
    model: services.embeddings.id,
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const argv = process.argv.slice(2);

  if (argv[0] === "reindex") {
    await runReindexCli(config, argv.slice(1));
    return;
  }

  await runServer(config);
}

main().catch((err) => {
  logger.error("Fatal error", { error: err instanceof Error ? err.stack ?? err.message : err });
  process.exit(1);
});
