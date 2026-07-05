import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "../src/server.js";
import { buildTestServices } from "./helpers.js";

async function connectClient() {
  const { services } = await buildTestServices();
  const server = createMcpServer(services);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

function parse(result: CallToolResult): unknown {
  assert.ok(!result.isError, `tool returned error: ${JSON.stringify(result.content)}`);
  const first = result.content[0];
  assert.ok(first && first.type === "text");
  return JSON.parse((first as { text: string }).text);
}

test("server exposes all documented tools", async () => {
  const { client, server } = await connectClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "get_note",
    "index_status",
    "list_folders",
    "reindex_notes",
    "search_date",
    "search_metadata",
    "search_semantic",
    "search_tags",
    "search_title",
  ]);
  await client.close();
  await server.close();
});

test("end-to-end: reindex then search over MCP", async () => {
  const { client, server } = await connectClient();

  const reindex = parse(
    (await client.callTool({ name: "reindex_notes", arguments: { full: true } })) as CallToolResult,
  ) as { added: number; total: number };
  assert.equal(reindex.added, 4);
  assert.equal(reindex.total, 4);

  const title = parse(
    (await client.callTool({
      name: "search_title",
      arguments: { query: "grocary" },
    })) as CallToolResult,
  ) as Array<{ id: string }>;
  assert.equal(title[0]!.id, "n1");

  const semantic = parse(
    (await client.callTool({
      name: "search_semantic",
      arguments: { query: "boil pasta tomato sauce", limit: 2 },
    })) as CallToolResult,
  ) as Array<{ id: string }>;
  assert.equal(semantic[0]!.id, "n3");

  const tags = parse(
    (await client.callTool({
      name: "search_tags",
      arguments: { tags: ["work"] },
    })) as CallToolResult,
  ) as Array<{ id: string }>;
  assert.deepEqual(tags.map((t) => t.id).sort(), ["n2", "n4"]);

  await client.close();
  await server.close();
});

test("get_note on a missing id returns an error result", async () => {
  const { client, server } = await connectClient();
  const result = (await client.callTool({
    name: "get_note",
    arguments: { id: "does-not-exist" },
  })) as CallToolResult;
  assert.ok(result.isError);
  await client.close();
  await server.close();
});
