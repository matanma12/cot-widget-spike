import Anthropic from "@anthropic-ai/sdk";
import { TYPE_CODE } from "./patterns.js";

const MOVE_TYPES = Object.keys(TYPE_CODE);
const MODEL = process.env.COT_REFINE_MODEL || "claude-haiku-4-5";
const MAX_INPUT_CHARS = 120_000;

export const llmAvailable = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let defaultClient = null;
function getClient() {
  if (!defaultClient) defaultClient = new Anthropic();
  return defaultClient;
}

const SUBMIT_MOVES_TOOL = {
  name: "submit_moves",
  description: "Submit the annotated reasoning moves for the thinking trace.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      moves: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: MOVE_TYPES, description: "Reasoning move type" },
            summary: { type: "string", description: "Move label, at most 8 words" },
            excerpt: { type: "string", description: "Verbatim quote from the thinking text that best shows this move" },
            depends_on: { type: "array", items: { type: "integer" }, description: "1-based indices of earlier moves this builds on; empty if none" },
            discards: { type: "array", items: { type: "integer" }, description: "1-based indices of earlier moves this abandons or refutes; empty if none" },
            weight: { type: "integer", enum: [1, 2, 3, 4, 5], description: "Relative thinking effort spent on this move" },
          },
          required: ["type", "summary", "excerpt", "depends_on", "discards", "weight"],
          additionalProperties: false,
        },
      },
    },
    required: ["moves"],
    additionalProperties: false,
  },
};

const SYSTEM = `You annotate AI reasoning traces into typed "reasoning moves" so humans can learn from them.
Move types: framing (understanding the problem), decomposition (breaking it down), hypothesis (proposing an explanation or approach), verification (testing against evidence), backtrack (abandoning a path after contradiction), self_correction (revising an earlier statement), insight (a realization that reframes things), action (deciding to run/write/build something), conclusion (a settled answer with confidence).
Rules: cover the whole trace in order; excerpts must be VERBATIM quotes; prefer fewer, meaningful moves over many fragments (typically 1-3 moves per thinking block); wire depends_on for evidence chains and discards for abandoned hypotheses; weight reflects how much of the trace the move occupies.`;

export function sanitizeMoves(moves) {
  if (!Array.isArray(moves)) return [];
  const out = [];
  for (const m of moves) {
    if (!m || !MOVE_TYPES.includes(m.type) || typeof m.summary !== "string" || typeof m.excerpt !== "string") continue;
    const idx = out.length + 1;
    const refs = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .filter((n) => Number.isInteger(n) && n >= 1 && n < idx)
        .slice(0, 4);
    const move = {
      type: m.type,
      summary: m.summary.slice(0, 80),
      excerpt: m.excerpt.length > 400 ? m.excerpt.slice(0, 397) + "…" : m.excerpt,
      weight: Number.isInteger(m.weight) ? Math.max(1, Math.min(5, m.weight)) : 2,
    };
    const dep = refs(m.depends_on);
    const dis = refs(m.discards);
    if (dep.length) move.depends_on = dep;
    if (dis.length) move.discards = dis;
    out.push(move);
  }
  return out;
}

export async function refineTrace(task, rawBlocks, { client } = {}) {
  const api = client || getClient();
  let text = rawBlocks.map((b, i) => `[T${i + 1}] ${b}`).join("\n\n");
  if (text.length > MAX_INPUT_CHARS) text = text.slice(-MAX_INPUT_CHARS);

  const response = await api.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [SUBMIT_MOVES_TOOL],
    tool_choice: { type: "tool", name: "submit_moves" },
    messages: [
      {
        role: "user",
        content: `Task the AI was working on: ${task || "(unknown)"}\n\nThinking trace (numbered blocks):\n\n${text}\n\nAnnotate this trace into reasoning moves via submit_moves.`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("no tool_use block in refiner response");
  const moves = sanitizeMoves(toolUse.input.moves);
  if (!moves.length) throw new Error("refiner returned no valid moves");
  return moves;
}
