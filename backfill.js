import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { annotateBlock, newAnnotationState } from "./src/annotate.js";
import { detectPatterns } from "./src/patterns.js";
import { saveTrace } from "./src/store.js";
import { refineTrace, llmAvailable } from "./src/llm-annotate.js";

const USE_LLM = process.argv.includes("--llm");
if (USE_LLM && !llmAvailable) {
  console.error("--llm requires ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN)");
  process.exit(1);
}

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
let saved = 0;

for (const proj of await fs.readdir(PROJECTS_DIR).catch(() => [])) {
  const dir = path.join(PROJECTS_DIR, proj);
  for (const f of await fs.readdir(dir).catch(() => [])) {
    if (!f.endsWith(".jsonl")) continue;
    const full = path.join(dir, f);
    const state = newAnnotationState();
    const rawBlocks = [];
    const trace = { task: null, source: full.replace(os.homedir(), "~"), moves: [], quality: "heuristic" };
    for (const line of (await fs.readFile(full, "utf-8").catch(() => "")).split("\n")) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === "custom-title" || o.type === "ai-title") trace.task = o.title || trace.task;
      else if (o.type === "user" && !trace.task) {
        const c = o.message?.content;
        const text = typeof c === "string" ? c : c?.find?.((b) => b.type === "text")?.text;
        if (text && !text.startsWith("<")) trace.task = text.slice(0, 90);
      } else if (o.type === "assistant") {
        for (const b of o.message?.content || []) {
          if (b.type === "thinking" && b.thinking?.trim()) {
            rawBlocks.push(b.thinking.trim());
            trace.moves.push(...annotateBlock(b.thinking, state));
          }
        }
      }
    }
    if (trace.moves.length < 3) continue;
    trace.task = trace.task || "(untitled session)";
    if (USE_LLM) {
      try {
        trace.moves = await refineTrace(trace.task, rawBlocks);
        trace.quality = "llm";
      } catch (e) {
        console.error(`  refine failed (${e.message}), keeping heuristic`);
      }
    }
    trace.patterns = detectPatterns(trace.moves);
    await saveTrace(trace);
    saved++;
    console.log(`saved ${trace.moves.length} moves: ${trace.task.slice(0, 60)}`);
  }
}
console.log(`\nbackfilled ${saved} traces into ~/.claude/cot-maps/traces/`);
