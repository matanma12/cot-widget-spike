import assert from "node:assert";
import { refineTrace, sanitizeMoves, llmAvailable } from "./src/llm-annotate.js";

// 1. refineTrace with a mocked client — verify request shape and parsing
let captured;
const fakeClient = {
  messages: {
    create: async (params) => {
      captured = params;
      return {
        content: [{
          type: "tool_use",
          name: "submit_moves",
          input: { moves: [
            { type: "framing", summary: "Understand the bug", excerpt: "The test fails 1 in 5 runs.", depends_on: [], discards: [], weight: 2 },
            { type: "hypothesis", summary: "Race condition", excerpt: "If the assertion runs early...", depends_on: [1], discards: [], weight: 3 },
            { type: "backtrack", summary: "Discard race theory", excerpt: "Wait, that can't be right.", depends_on: [], discards: [2], weight: 1 },
          ]},
        }],
      };
    },
  },
};

const moves = await refineTrace("fix flaky test", ["block one text", "block two text"], { client: fakeClient });
assert.equal(captured.tool_choice.name, "submit_moves");
assert.equal(captured.tools[0].strict, true);
assert.ok(captured.messages[0].content.includes("[T1] block one text"));
assert.equal(moves.length, 3);
assert.deepEqual(moves[1].depends_on, [1]);
assert.deepEqual(moves[2].discards, [2]);
console.log("refineTrace mock: OK");

// 2. Sanitization: bad types, forward refs, oversized excerpts, bad weights
const dirty = sanitizeMoves([
  { type: "nonsense", summary: "x", excerpt: "y" },
  { type: "hypothesis", summary: "ok", excerpt: "z".repeat(999), depends_on: [5, 0, 1.5, -2], weight: 99 },
  { type: "conclusion", summary: "done", excerpt: "final", depends_on: [1], weight: 0 },
]);
assert.equal(dirty.length, 2);
assert.equal(dirty[0].excerpt.length, 398);
assert.equal(dirty[0].weight, 5);
assert.equal(dirty[0].depends_on, undefined);
assert.deepEqual(dirty[1].depends_on, [1]);
assert.equal(dirty[1].weight, 1);
console.log("sanitizeMoves: OK");

// 3. Empty moves -> throws
await refineTrace("t", ["b"], { client: { messages: { create: async () => ({ content: [{ type: "tool_use", input: { moves: [] } }] }) } } })
  .then(() => { throw new Error("should have thrown"); }, (e) => assert.ok(e.message.includes("no valid moves")));
console.log("empty-result guard: OK");

console.log("llmAvailable on this machine:", llmAvailable);
