import { openDatabase } from "../src/db/database.js";
import { NotesRepo } from "../src/db/notesRepo.js";
import { HashingEmbeddingProvider } from "../src/embeddings/hashing.js";
import type { FetchOptions, NotesSource } from "../src/notes/source.js";
import { Indexer } from "../src/search/indexer.js";
import { SearchService } from "../src/search/searchService.js";
import { VectorStore } from "../src/search/vectorStore.js";
import type { AppServices } from "../src/server.js";
import type { RawNote } from "../src/types.js";

/** In-memory notes source for hermetic tests. */
export class FakeNotesSource implements NotesSource {
  readonly name = "fake";
  constructor(public notes: RawNote[]) {}
  async fetchNotes(options: FetchOptions = {}): Promise<RawNote[]> {
    const limit = options.limit ?? 0;
    const all = this.notes.slice();
    return limit > 0 ? all.slice(0, limit) : all;
  }
}

/** A small, representative fixture that exercises every search modality. */
export function sampleNotes(): RawNote[] {
  return [
    {
      id: "n1",
      title: "Grocery shopping list",
      text: "Buy milk eggs bread and coffee. #errands #home",
      isHtml: false,
      folder: "Personal",
      account: "iCloud",
      createdAt: "2024-01-05T10:00:00.000Z",
      modifiedAt: "2024-02-01T12:00:00.000Z",
    },
    {
      id: "n2",
      title: "Project roadmap",
      text: "Quarterly planning for the mobile app launch. #work #planning",
      isHtml: false,
      folder: "Work",
      account: "iCloud",
      createdAt: "2024-03-10T09:00:00.000Z",
      modifiedAt: "2024-03-15T09:00:00.000Z",
    },
    {
      id: "n3",
      title: "Pasta recipe",
      text:
        "<div>Boil water, add pasta, cook for ten minutes.</div>" +
        "<p>Serve with tomato sauce &amp; basil.</p><p>#recipe #food</p>",
      isHtml: true,
      folder: "Recipes",
      account: "On My Mac",
      createdAt: "2023-11-20T18:00:00.000Z",
      modifiedAt: "2023-12-01T18:00:00.000Z",
    },
    {
      id: "n4",
      title: "Meeting notes with Alice",
      text: "Discussed budget and hiring plans for next quarter. #work",
      isHtml: false,
      folder: "Work",
      account: "iCloud",
      createdAt: "2024-04-01T14:00:00.000Z",
      modifiedAt: "2024-04-02T14:00:00.000Z",
    },
  ];
}

export interface TestHarness {
  services: AppServices;
  source: FakeNotesSource;
}

/** Build fully-wired services backed by an in-memory DB + hashing embeddings. */
export async function buildTestServices(notes: RawNote[] = sampleNotes()): Promise<TestHarness> {
  const db = openDatabase(":memory:");
  const repo = new NotesRepo(db);
  const embeddings = new HashingEmbeddingProvider(256);
  await embeddings.init();
  const vectors = new VectorStore(embeddings.dimensions);
  const source = new FakeNotesSource(notes);
  const indexer = new Indexer(source, repo, embeddings, vectors);
  indexer.loadVectors();
  const search = new SearchService(repo, embeddings, vectors);
  return { services: { repo, embeddings, vectors, indexer, search }, source };
}
