import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { annotateBlock, newAnnotationState } from "./src/annotate.js";
import { detectPatterns } from "./src/patterns.js";
import { saveTrace } from "./src/store.js";
import { refineTrace, llmAvailable } from "./src/llm-annotate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const PORT = process.env.PORT || 4173;
const FOLLOW = process.env.FOLLOW ? path.resolve(process.env.FOLLOW) : null;
const MAX_SESSIONS = 12;
const SEED_COUNT = 5;
const SEED_MAX_AGE_MS = 48 * 3600 * 1000;

const sessions = new Map(); // file path -> session state
const clients = new Set();  // SSE responses; res.watch = "auto" | session id

function newSession(file) {
  return {
    file,
    id: path.basename(file, ".jsonl"),
    offset: 0,
    buf: "",
    state: newAnnotationState(),
    rawBlocks: [],
    refinedUpTo: 0,
    refining: false,
    lastActivity: 0,
    trace: { task: "(untitled session)", source: file.replace(os.homedir(), "~"), moves: [], quality: "heuristic" },
  };
}

function mostActive() {
  let best = null;
  for (const s of sessions.values()) if (!best || s.lastActivity > best.lastActivity) best = s;
  return best;
}

function summaries() {
  return [...sessions.values()]
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map((s) => ({
      id: s.id,
      task: s.trace.task,
      moves: s.trace.moves.length,
      quality: s.trace.quality,
      lastActivity: s.lastActivity,
    }));
}

function send(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastSessions() {
  const payload = { type: "sessions", sessions: summaries(), auto: mostActive()?.id ?? null };
  for (const res of clients) send(res, payload);
}

function broadcastTrace(s) {
  const payload = { type: "trace", session: s.id, ...s.trace };
  const autoId = mostActive()?.id;
  for (const res of clients) {
    if (res.watch === s.id || (res.watch === "auto" && s.id === autoId)) send(res, payload);
  }
}

function prune() {
  while (sessions.size > MAX_SESSIONS) {
    let oldest = null;
    for (const s of sessions.values()) if (!oldest || s.lastActivity < oldest.lastActivity) oldest = s;
    clearTimeout(oldest.refineTimer);
    sessions.delete(oldest.file);
  }
}

async function consume(file) {
  let s = sessions.get(file);
  if (!s) {
    s = newSession(file);
    sessions.set(file, s);
    console.error("[live] tracking", s.id);
  }
  const st = await fsp.stat(file).catch(() => null);
  if (!st || st.size <= s.offset) return;
  const fh = await fsp.open(file, "r");
  const { buffer, bytesRead } = await fh.read(Buffer.alloc(st.size - s.offset), 0, st.size - s.offset, s.offset);
  await fh.close();
  s.offset += bytesRead;
  s.buf += buffer.toString("utf-8", 0, bytesRead);
  const lines = s.buf.split("\n");
  s.buf = lines.pop() ?? "";
  let changed = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "custom-title" || o.type === "ai-title") {
      if (o.title) { s.trace.task = o.title; changed = true; }
    } else if (o.type === "user") {
      const c = o.message?.content;
      const text = typeof c === "string" ? c : c?.find?.((b) => b.type === "text")?.text;
      if (text && !text.startsWith("<") && s.trace.task === "(untitled session)") {
        s.trace.task = text.slice(0, 90);
        changed = true;
      }
    } else if (o.type === "assistant") {
      for (const b of o.message?.content || []) {
        if (b.type === "thinking" && b.thinking?.trim()) {
          s.rawBlocks.push(b.thinking.trim());
          s.trace.moves.push(...annotateBlock(b.thinking, s.state));
          s.trace.quality = "heuristic";
          changed = true;
        }
      }
    }
  }
  if (changed) {
    s.lastActivity = st.mtimeMs;
    s.trace.patterns = detectPatterns(s.trace.moves);
    prune();
    broadcastSessions();
    broadcastTrace(s);
    scheduleRefine(s);
  }
}

async function runRefine(s) {
  if (!llmAvailable || s.refining) return;
  const n = s.rawBlocks.length;
  if (n === 0 || n === s.refinedUpTo) return;
  s.refining = true;
  try {
    const moves = await refineTrace(s.trace.task, s.rawBlocks);
    if (!sessions.has(s.file)) return;
    s.trace.moves = moves;
    s.trace.quality = "llm";
    s.trace.patterns = detectPatterns(moves);
    s.refinedUpTo = n;
    broadcastSessions();
    broadcastTrace(s);
    saveTrace(s.trace).catch(() => {});
    console.error(`[live] ${s.id}: refined ${n} blocks -> ${moves.length} moves via LLM`);
  } catch (e) {
    console.error(`[live] ${s.id}: refine failed, keeping heuristic:`, e.message);
  } finally {
    s.refining = false;
    if (sessions.has(s.file) && s.rawBlocks.length > s.refinedUpTo) scheduleRefine(s);
  }
}

function scheduleRefine(s) {
  clearTimeout(s.refineTimer);
  s.refineTimer = setTimeout(() => runRefine(s), 6000);
}

async function seedSessions() {
  if (FOLLOW) { await consume(FOLLOW); return; }
  const found = [];
  const cutoff = Date.now() - SEED_MAX_AGE_MS;
  for (const proj of await fsp.readdir(PROJECTS_DIR).catch(() => [])) {
    const dir = path.join(PROJECTS_DIR, proj);
    for (const f of await fsp.readdir(dir).catch(() => [])) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dir, f);
      const st = await fsp.stat(full).catch(() => null);
      if (st?.isFile() && st.mtimeMs > cutoff) found.push({ full, mtime: st.mtimeMs });
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  for (const f of found.slice(0, SEED_COUNT)) await consume(f.full);
}

const pending = new Set();
let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (pending.size) {
      const files = [...pending];
      pending.clear();
      for (const f of files) await consume(f);
    }
  } finally { pumping = false; }
}

fs.watch(PROJECTS_DIR, { recursive: true }, (_ev, rel) => {
  if (!rel || !rel.endsWith(".jsonl")) return;
  const full = path.join(PROJECTS_DIR, rel);
  if (FOLLOW && full !== FOLLOW) return;
  pending.add(full);
  setTimeout(pump, 150);
});

const app = express();
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "dist", "live.html")));
app.get("/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.watch = typeof req.query.session === "string" && req.query.session !== "auto" ? req.query.session : "auto";
  clients.add(res);
  req.on("close", () => clients.delete(res));
  send(res, { type: "sessions", sessions: summaries(), auto: mostActive()?.id ?? null });
  const target = res.watch === "auto" ? mostActive() : [...sessions.values()].find((s) => s.id === res.watch);
  if (target) send(res, { type: "trace", session: target.id, ...target.trace });
});

await seedSessions();
app.listen(PORT, () =>
  console.error(`[live] reasoning map at http://localhost:${PORT} — ${sessions.size} session(s), watching ${FOLLOW || PROJECTS_DIR}`),
);
