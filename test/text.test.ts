import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contentHash,
  decodeEntities,
  extractTags,
  htmlToText,
  makeSnippet,
} from "../src/notes/text.js";

test("htmlToText strips tags and preserves line structure", () => {
  const html = "<div>Line one</div><p>Line two</p>Line three";
  const text = htmlToText(html);
  assert.equal(text, "Line one\nLine two\nLine three");
});

test("htmlToText treats a paragraph break plus <br> as a blank line", () => {
  assert.equal(htmlToText("<p>one</p><br>two"), "one\n\ntwo");
});

test("htmlToText decodes entities", () => {
  assert.equal(htmlToText("<p>Salt &amp; pepper &lt;3</p>"), "Salt & pepper <3");
});

test("decodeEntities handles numeric and hex references", () => {
  assert.equal(decodeEntities("&#65;&#x42;&amp;"), "AB&");
});

test("extractTags finds unique lowercased hashtags", () => {
  const tags = extractTags("Planning #Work and #work and #idea-2 (#Home)");
  assert.deepEqual(tags.sort(), ["home", "idea-2", "work"]);
});

test("extractTags ignores markdown headings and url fragments", () => {
  const tags = extractTags("## Heading\nSee https://x.com/page#section for details");
  assert.deepEqual(tags, []);
});

test("makeSnippet truncates and collapses whitespace", () => {
  const snippet = makeSnippet("hello    world\n\nfoo", 100);
  assert.equal(snippet, "hello world foo");
  const long = makeSnippet("a".repeat(300), 50);
  assert.equal(long.length, 50);
  assert.ok(long.endsWith("…"));
});

test("contentHash is stable and sensitive to changes", () => {
  const base = {
    title: "T",
    text: "body",
    folder: "F",
    account: "A",
    modifiedAt: "2024-01-01T00:00:00.000Z",
  };
  assert.equal(contentHash(base), contentHash({ ...base }));
  assert.notEqual(contentHash(base), contentHash({ ...base, text: "changed" }));
  assert.notEqual(
    contentHash(base),
    contentHash({ ...base, modifiedAt: "2024-01-02T00:00:00.000Z" }),
  );
});
