import { execFile } from "node:child_process";
import { logger } from "../logger.js";
import type { RawNote } from "../types.js";
import type { FetchOptions, NotesSource } from "./source.js";

/**
 * JXA (JavaScript for Automation) script executed by `osascript`. It walks every
 * account → folder → subfolder and bulk-reads note properties, which is far
 * faster than per-note Apple Event round-trips. It prints a JSON array.
 *
 * argv[0] (optional) is a max-note cap; 0 means unlimited.
 */
const JXA_SCRIPT = String.raw`
function run(argv) {
  var limit = argv && argv.length > 0 ? parseInt(argv[0], 10) : 0;
  if (!isFinite(limit)) limit = 0;
  var Notes = Application('Notes');
  var results = [];
  var SKIP_FOLDERS = { 'Recently Deleted': true };

  function isoOf(d) {
    try { return d ? d.toISOString() : null; } catch (e) { return null; }
  }

  function describeError(e) {
    var parts = [];
    try { parts.push(String(e)); } catch (x) {}
    try { if (e && e.errorNumber != null) parts.push('errorNumber ' + e.errorNumber); } catch (x) {}
    return parts.join(' ') || 'unknown Notes automation error';
  }

  function processFolder(folder, accountName) {
    if (limit > 0 && results.length >= limit) return;
    var fname = '';
    try { fname = folder.name() || ''; } catch (e) {}
    if (SKIP_FOLDERS[fname]) return;

    var ref;
    try { ref = folder.notes; } catch (e) { return; }
    var ids, names, created, modified, plains, bodies;
    try {
      ids = ref.id();
      names = ref.name();
      created = ref.creationDate();
      modified = ref.modificationDate();
    } catch (e) { return; }
    try { plains = ref.plaintext(); } catch (e) { plains = null; }
    if (!plains) { try { bodies = ref.body(); } catch (e) { bodies = null; } }

    for (var i = 0; i < ids.length; i++) {
      if (limit > 0 && results.length >= limit) return;
      var text = '';
      var isHtml = false;
      if (plains && plains[i] != null) {
        text = String(plains[i]);
      } else if (bodies && bodies[i] != null) {
        text = String(bodies[i]);
        isHtml = true;
      }
      results.push({
        id: String(ids[i]),
        title: names[i] == null ? '' : String(names[i]),
        text: text,
        isHtml: isHtml,
        folder: fname,
        account: accountName,
        createdAt: isoOf(created[i]),
        modifiedAt: isoOf(modified[i])
      });
    }

    var subs = [];
    try { subs = folder.folders(); } catch (e) { subs = []; }
    for (var j = 0; j < subs.length; j++) processFolder(subs[j], accountName);
  }

  var accounts = [];
  try {
    accounts = Notes.accounts();
  } catch (e) {
    // Top-level authorization failure (e.g. Apple Event -1743 when Automation
    // access is denied). Emit a structured sentinel instead of swallowing to []
    // so the caller can distinguish "denied" from "empty library" and raise
    // NotesPermissionError. Per-folder/per-note reads below still swallow so one
    // locked folder cannot abort the whole read.
    return JSON.stringify({ __error: describeError(e) });
  }
  for (var a = 0; a < accounts.length; a++) {
    if (limit > 0 && results.length >= limit) break;
    var acctName = '';
    try { acctName = accounts[a].name() || ''; } catch (e) {}
    var folders = [];
    try { folders = accounts[a].folders(); } catch (e) { folders = []; }
    for (var f = 0; f < folders.length; f++) processFolder(folders[f], acctName);
  }

  return JSON.stringify(results);
}
`;

/** Error thrown when macOS denies Automation access to the Notes app. */
export class NotesPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotesPermissionError";
  }
}

/**
 * Runs the JXA script under `osascript` and resolves its raw stdout. Injectable
 * so tests can feed canned output without touching the real Notes app.
 */
export type OsascriptRunner = (limit: string) => Promise<string>;

/** Reads notes from the local Apple Notes app via `osascript`. */
export class AppleNotesSource implements NotesSource {
  readonly name = "Apple Notes (osascript)";
  private readonly runner: OsascriptRunner;

  constructor(
    private readonly timeoutMs: number = 120_000,
    runner?: OsascriptRunner,
  ) {
    this.runner = runner ?? ((limit) => this.runOsascript(limit));
  }

  async fetchNotes(options: FetchOptions = {}): Promise<RawNote[]> {
    const limit = options.limit && options.limit > 0 ? String(options.limit) : "0";
    logger.info("Reading notes from Apple Notes via osascript", { limit });

    let stdout: string;
    try {
      stdout = await this.runner(limit);
    } catch (err) {
      throw this.translateError(err);
    }

    const trimmed = stdout.trim();
    if (!trimmed) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `Failed to parse osascript output as JSON: ${(err as Error).message}`,
      );
    }
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && "__error" in parsed) {
      // The JXA script emits this sentinel when the top-level Notes.accounts()
      // call fails (e.g. Apple Event -1743 when Automation access is denied).
      // Route it through translateError so a denial raises NotesPermissionError
      // with System Settings guidance instead of masquerading as an empty library.
      const detail = String((parsed as { __error?: unknown }).__error ?? "unknown error");
      const sentinelError = Object.assign(new Error(`Notes automation failed: ${detail}`), {
        stderr: detail,
      });
      throw this.translateError(sentinelError);
    }
    if (!Array.isArray(parsed)) {
      throw new Error("osascript did not return a JSON array of notes");
    }
    const notes = parsed as RawNote[];
    logger.info("Apple Notes returned notes", { count: notes.length });
    return notes;
  }

  private runOsascript(limit: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        "osascript",
        ["-l", "JavaScript", "-e", JXA_SCRIPT, limit],
        { timeout: this.timeoutMs, maxBuffer: 512 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            (error as Error & { stderr?: string }).stderr = stderr;
            reject(error);
            return;
          }
          resolve(stdout);
        },
      );
    });
  }

  private translateError(err: unknown): Error {
    const error = err as Error & { stderr?: string; code?: number; killed?: boolean };
    const stderr = error.stderr ?? "";
    const combined = `${error.message ?? ""} ${stderr}`;
    if (
      /not authori[sz]ed|-1743|not allowed to send apple events|execution error/i.test(combined) &&
      /notes|apple event|authori/i.test(combined)
    ) {
      return new NotesPermissionError(
        "macOS denied Automation access to the Notes app. Grant permission under " +
          "System Settings → Privacy & Security → Automation (allow your terminal/host " +
          "to control Notes), then reindex. Original error: " +
          combined.trim(),
      );
    }
    if (error.killed) {
      return new Error(
        `Reading Apple Notes timed out after ${this.timeoutMs}ms. Increase ` +
          "APPLE_NOTES_MCP_FETCH_TIMEOUT_MS or set APPLE_NOTES_MCP_MAX_NOTES to index fewer notes.",
      );
    }
    return new Error(`osascript failed: ${combined.trim()}`);
  }
}
