import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { detectPatterns, aggregate } from "./src/patterns.js";
import { saveTrace, loadTraces } from "./src/store.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

const server = new McpServer({ name: "CoT Reasoning Map", version: "0.2.0" });
const resourceUri = "ui://cot-spike/mcp-app.html";
const patternsResourceUri = "ui://cot-spike/patterns.html";

const MOVE_TYPES = [
  "framing", "decomposition", "hypothesis", "verification",
  "backtrack", "self_correction", "insight", "action", "conclusion",
];

// ---------- transcript ingestion ----------

async function* jsonlEntries(file) {
  const raw = await fs.readFile(file, "utf-8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { yield JSON.parse(line); } catch { /* skip malformed */ }
  }
}

async function scanSession(file) {
  const info = { path: file, title: null, firstPrompt: null, thinking: 0, turns: 0, toolCalls: 0 };
  for await (const o of jsonlEntries(file)) {
    if (o.type === "custom-title" || o.type === "ai-title") info.title = o.title || info.title;
    else if (o.type === "user") {
      info.turns++;
      const c = o.message?.content;
      const text = typeof c === "string" ? c : c?.find?.((b) => b.type === "text")?.text;
      if (!info.firstPrompt && text && !text.startsWith("<")) info.firstPrompt = text.slice(0, 160);
    } else if (o.type === "assistant") {
      for (const b of o.message?.content || []) {
        if (b.type === "thinking") info.thinking++;
        else if (b.type === "tool_use") info.toolCalls++;
      }
    }
  }
  return info;
}

server.registerTool(
  "list_sessions",
  {
    title: "List Claude Code sessions",
    description:
      "Lists recent Claude Code session transcripts on this machine that contain extended-thinking blocks, newest first. Use to let the user pick a session to map. Returns transcript paths for get_thinking.",
    inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("Max sessions to return (default 10)") },
  },
  async ({ limit = 10 }) => {
    const files = [];
    for (const proj of await fs.readdir(PROJECTS_DIR).catch(() => [])) {
      const dir = path.join(PROJECTS_DIR, proj);
      for (const f of await fs.readdir(dir).catch(() => [])) {
        if (!f.endsWith(".jsonl")) continue;
        const full = path.join(dir, f);
        const st = await fs.stat(full).catch(() => null);
        if (st?.isFile()) files.push({ full, mtime: st.mtimeMs, project: proj });
      }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    const out = [];
    for (const f of files) {
      if (out.length >= limit) break;
      const info = await scanSession(f.full);
      if (info.thinking === 0) continue;
      out.push({
        path: f.full,
        project: f.project.replace(/^-Users-[^-]+-?/, "") || "(home)",
        modified: new Date(f.mtime).toISOString(),
        title: info.title || info.firstPrompt || "(untitled)",
        thinkingBlocks: info.thinking,
        turns: info.turns,
        toolCalls: info.toolCalls,
      });
    }
    return {
      content: [{ type: "text", text: out.length ? JSON.stringify(out, null, 2) : "No sessions with thinking blocks found." }],
    };
  },
);

server.registerTool(
  "get_thinking",
  {
    title: "Get thinking blocks from a session",
    description:
      "Extracts the chain-of-thought (thinking blocks) plus tool-call skeleton from a Claude Code transcript, as numbered blocks [T1]..[Tn]. " +
      "After calling this, annotate the thinking into typed reasoning moves and call show_reasoning_map to render it. " +
      `Move types: ${MOVE_TYPES.join(", ")}.`,
    inputSchema: {
      session_path: z.string().describe("Transcript path from list_sessions"),
      max_chars: z.number().int().optional().describe("Cap on returned characters (default 30000)"),
    },
  },
  async ({ session_path, max_chars = 30000 }) => {
    const resolved = path.resolve(session_path);
    if (!resolved.startsWith(PROJECTS_DIR + path.sep)) {
      return { content: [{ type: "text", text: "Refused: path is outside ~/.claude/projects" }], isError: true };
    }
    const parts = [];
    let t = 0;
    for await (const o of jsonlEntries(resolved)) {
      if (o.type === "user") {
        const c = o.message?.content;
        const text = typeof c === "string" ? c : c?.find?.((b) => b.type === "text")?.text;
        if (text && !text.startsWith("<")) parts.push(`\n=== user: ${text.slice(0, 200)} ===`);
      } else if (o.type === "assistant") {
        for (const b of o.message?.content || []) {
          if (b.type === "thinking" && b.thinking?.trim()) parts.push(`[T${++t}] ${b.thinking.trim()}`);
          else if (b.type === "tool_use") parts.push(`  -> tool: ${b.name}`);
        }
      }
    }
    let text = parts.join("\n");
    if (text.length > max_chars) text = text.slice(0, max_chars) + `\n[...truncated at ${max_chars} chars]`;
    return { content: [{ type: "text", text: text || "No thinking blocks in this transcript." }] };
  },
);

// ---------- rendering ----------

const moveSchema = z.object({
  type: z.enum(MOVE_TYPES).describe("Reasoning move type"),
  summary: z.string().describe("Move label, <=8 words"),
  excerpt: z.string().describe("Verbatim quote from the thinking text that best shows this move"),
  depends_on: z.array(z.number().int()).optional().describe("1-based indices of earlier moves this builds on"),
  discards: z.array(z.number().int()).optional().describe("1-based indices of earlier moves this abandons/refutes"),
  weight: z.number().min(1).max(5).optional().describe("Relative effort spent, 1-5"),
});

const SAMPLE_TRACE = {
  task: "Demo: intermittent test failure in payment flow",
  source: "sample data",
  moves: [
    { type: "framing", summary: "Frame the problem", excerpt: "The test fails roughly 1 in 5 runs. Intermittent failures usually mean timing, shared state, or external dependencies.", weight: 2 },
    { type: "hypothesis", summary: "Hypothesis A: race condition", excerpt: "If the assertion runs before the async job commits, we'd see exactly this flakiness.", depends_on: [1], weight: 2 },
    { type: "verification", summary: "Check the logs", excerpt: "The job completion timestamp is BEFORE the assertion timestamp in all five failures. That contradicts the race hypothesis.", depends_on: [2], weight: 3 },
    { type: "backtrack", summary: "Discard hypothesis A", excerpt: "Wait, that can't be right. If the job finished first, timing isn't the issue. What else is shared?", discards: [2], weight: 1 },
    { type: "hypothesis", summary: "Hypothesis B: stale cache", excerpt: "The balance lookup goes through a read cache with a 2s TTL. That fits the 1-in-5 pattern.", depends_on: [1, 4], weight: 2 },
    { type: "verification", summary: "Verify with experiment", excerpt: "Ran the suite 30 times with cache clearing — zero failures. Removed it — 6 failures. Confirmed.", depends_on: [5], weight: 4 },
    { type: "conclusion", summary: "Root cause: cache pollution", excerpt: "Fix: scope the cache per test. Confidence: high — the experiment isolates the variable cleanly.", depends_on: [6], weight: 1 },
  ],
};

registerAppTool(
  server,
  "show_reasoning_map",
  {
    title: "Show reasoning map",
    description:
      "Renders an interactive reasoning map of annotated chain-of-thought moves as an inline widget. " +
      "Typical flow: list_sessions -> get_thinking -> YOU annotate the thinking into moves -> show_reasoning_map. " +
      "Excerpts must be verbatim quotes. Call with no arguments for a demo with sample data.",
    inputSchema: {
      task: z.string().optional().describe("One-line description of what the session was doing"),
      source: z.string().optional().describe("Where the CoT came from, e.g. session title or path"),
      moves: z.array(moveSchema).optional().describe("Ordered reasoning moves; omit for demo data"),
    },
    _meta: { ui: { resourceUri } },
  },
  async ({ task, source, moves }) => {
    const trace = moves?.length ? { task: task || "Reasoning map", source: source || "", moves } : { ...SAMPLE_TRACE };
    trace.patterns = detectPatterns(trace.moves);
    if (moves?.length) await saveTrace(trace).catch(() => {});
    const counts = {};
    for (const m of trace.moves) counts[m.type] = (counts[m.type] || 0) + 1;
    return {
      content: [{
        type: "text",
        text:
          `Reasoning map for: ${trace.task}\n` +
          trace.moves.map((m, i) => `${i + 1}. [${m.type}] ${m.summary}`).join("\n") +
          `\n(${trace.moves.length} moves: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")})` +
        `\nPatterns: ${trace.patterns.map((p) => p.name).join(", ") || "none"}`,
      }],
      structuredContent: trace,
    };
  },
);

registerAppTool(
  server,
  "show_pattern_library",
  {
    title: "Show pattern library",
    description:
      "Renders the cross-trace reasoning pattern library as an inline widget: named recurring reasoning shapes " +
      "(evidence loop, hypothesis elimination, leap of faith, ...) with frequency across all stored traces, learning notes, and examples. " +
      "Use when the user asks about their reasoning patterns, what they can learn across sessions, or the pattern library.",
    inputSchema: {},
    _meta: { ui: { resourceUri: patternsResourceUri } },
  },
  async () => {
    const traces = await loadTraces();
    const patterns = aggregate(traces);
    const seen = patterns.filter((p) => p.traceCount > 0);
    return {
      content: [{
        type: "text",
        text:
          `Pattern library across ${traces.length} stored traces:\n` +
          (seen.map((p) => `- ${p.name}${p.anti ? " (anti-pattern)" : ""}: in ${p.traceCount} traces (${p.occurrences}x)`).join("\n") || "(no traces stored yet — render some reasoning maps first)"),
      }],
      structuredContent: { traceCount: traces.length, patterns },
    };
  },
);

registerAppResource(
  server,
  patternsResourceUri,
  patternsResourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => {
    const html = await fs.readFile(path.join(__dirname, "dist", "patterns.html"), "utf-8");
    return { contents: [{ uri: patternsResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  },
);

registerAppResource(
  server,
  resourceUri,
  resourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => {
    const html = await fs.readFile(path.join(__dirname, "dist", "mcp-app.html"), "utf-8");
    return { contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  },
);

if (process.argv.includes("--http")) {
  const { default: express } = await import("express");
  const { default: cors } = await import("cors");
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.listen(3001, () => console.error("HTTP MCP server on http://localhost:3001/mcp"));
} else {
  await server.connect(new StdioServerTransport());
  console.error("CoT reasoning-map MCP server on stdio");
}
