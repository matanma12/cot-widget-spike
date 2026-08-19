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

const clients = new Set();
let active = null; // { file, offset, buf, state, trace }

function broadcast() {
  if (!active) return;
  const payload = `data: ${JSON.stringify({ ...active.trace, session: path.basename(active.file, ".jsonl") })}\n\n`;
  for (const res of clients) res.write(payload);
}

function freshTrace(file) {
  return {
    file,
    offset: 0,
    buf: "",
    state: newAnnotationState(),
    rawBlocks: [],
    refinedUpTo: 0,
    refining: false,
    trace: { task: "Live session", source: file.replace(os.homedir(), "~"), moves: [], quality: "heuristic" },
  };
}

async function runRefine(session) {
  if (!llmAvailable || session.refining) return;
  const n = session.rawBlocks.length;
  if (n === 0 || n === session.refinedUpTo) return;
  session.refining = true;
  try {
    const moves = await refineTrace(session.trace.task, session.rawBlocks);
    if (active !== session) return;
    session.trace.moves = moves;
    session.trace.quality = "llm";
    session.trace.patterns = detectPatterns(moves);
    session.refinedUpTo = n;
    broadcast();
    saveTrace(session.trace).catch(() => {});
    console.error(`[live] refined ${n} blocks -> ${moves.length} moves via LLM`);
  } catch (e) {
    console.error("[live] refine failed, keeping heuristic:", e.message);
  } finally {
    session.refining = false;
    if (active === session && session.rawBlocks.length > session.refinedUpTo) scheduleRefine(session);
  }
}

function scheduleRefine(session) {
  clearTimeout(session.refineTimer);
  session.refineTimer = setTimeout(() => runRefine(session), 6000);
}

async function consume(file) {
  if (!active || active.file !== file) {
    active = freshTrace(file);
    console.error("[live] following", file);
  }
  const st = await fsp.stat(file).catch(() => null);
  if (!st || st.size <= active.offset) return;
  const fh = await fsp.open(file, "r");
  const { buffer, bytesRead } = await fh.read(Buffer.alloc(st.size - active.offset), 0, st.size - active.offset, active.offset);
  await fh.close();
  active.offset += bytesRead;
  active.buf += buffer.toString("utf-8", 0, bytesRead);
  const lines = active.buf.split("\n");
  active.buf = lines.pop() ?? "";
  let changed = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "custom-title" || o.type === "ai-title") {
      if (o.title) { active.trace.task = o.title; changed = true; }
    } else if (o.type === "user") {
      const c = o.message?.content;
      const text = typeof c === "string" ? c : c?.find?.((b) => b.type === "text")?.text;
      if (text && !text.startsWith("<") && active.trace.task === "Live session") {
        active.trace.task = text.slice(0, 90);
        changed = true;
      }
    } else if (o.type === "assistant") {
      for (const b of o.message?.content || []) {
        if (b.type === "thinking" && b.thinking?.trim()) {
          active.rawBlocks.push(b.thinking.trim());
          active.trace.moves.push(...annotateBlock(b.thinking, active.state));
          active.trace.quality = "heuristic";
          changed = true;
        }
      }
    }
  }
  if (changed) {
    active.trace.patterns = detectPatterns(active.trace.moves);
    broadcast();
    scheduleRefine(active);
    clearTimeout(active.saveTimer);
    if (active.trace.moves.length) {
      active.saveTimer = setTimeout(() => saveTrace(active.trace).catch(() => {}), 2000);
    }
  }
}

async function newestSessionFile() {
  if (FOLLOW) return FOLLOW;
  let best = null;
  for (const proj of await fsp.readdir(PROJECTS_DIR).catch(() => [])) {
    const dir = path.join(PROJECTS_DIR, proj);
    for (const f of await fsp.readdir(dir).catch(() => [])) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dir, f);
      const st = await fsp.stat(full).catch(() => null);
      if (st?.isFile() && (!best || st.mtimeMs > best.mtime)) best = { full, mtime: st.mtimeMs };
    }
  }
  return best?.full ?? null;
}

const pending = new Set();
let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (pending.size) {
      const files = [...pending]; pending.clear();
      let newest = null;
      for (const f of files) {
        const st = await fsp.stat(f).catch(() => null);
        if (st && (!newest || st.mtimeMs > newest.mtime)) newest = { f, mtime: st.mtimeMs };
      }
      if (newest) await consume(newest.f);
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
app.get("/events", async (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  clients.add(res);
  req.on("close", () => clients.delete(res));
  if (!active) {
    const f = await newestSessionFile();
    if (f) await consume(f);
  }
  if (active) broadcast();
});

app.listen(PORT, () => console.error(`[live] reasoning map at http://localhost:${PORT} — watching ${PROJECTS_DIR}`));
