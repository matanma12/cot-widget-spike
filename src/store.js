import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const STORE_DIR = path.join(os.homedir(), ".claude", "cot-maps", "traces");

export function traceId(trace) {
  return crypto.createHash("sha1").update(trace.source || trace.task || "untitled").digest("hex").slice(0, 16);
}

export async function saveTrace(trace) {
  await fs.mkdir(STORE_DIR, { recursive: true });
  const id = traceId(trace);
  await fs.writeFile(path.join(STORE_DIR, id + ".json"), JSON.stringify({ id, savedAt: new Date().toISOString(), ...trace }, null, 1));
  return id;
}

export async function loadTraces() {
  const out = [];
  for (const f of await fs.readdir(STORE_DIR).catch(() => [])) {
    if (!f.endsWith(".json")) continue;
    try { out.push(JSON.parse(await fs.readFile(path.join(STORE_DIR, f), "utf-8"))); } catch { /* skip */ }
  }
  return out;
}
