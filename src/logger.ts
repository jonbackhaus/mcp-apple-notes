/**
 * Minimal stderr logger.
 *
 * The MCP stdio transport owns stdout for JSON-RPC framing, so every diagnostic
 * message MUST go to stderr. Never use `console.log` in server code.
 */

type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return order[(raw as Level)] ?? order.info;
}

function emit(level: Level, msg: string, meta?: unknown): void {
  if (order[level] < threshold()) return;
  const prefix = `[apple-notes-mcp] ${level.toUpperCase()}`;
  if (meta === undefined) {
    process.stderr.write(`${prefix} ${msg}\n`);
  } else {
    process.stderr.write(`${prefix} ${msg} ${safeJson(meta)}\n`);
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
  info: (msg: string, meta?: unknown) => emit("info", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
  error: (msg: string, meta?: unknown) => emit("error", msg, meta),
};
