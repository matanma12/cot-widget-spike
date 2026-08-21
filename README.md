# CoT Reasoning Map

**See your agent think, live.** A local companion for Claude Code that draws the
chain of thought as it happens: a real-time **reasoning map** of typed moves —
framing, hypothesis, verification, backtrack, self-correction, insight, action,
conclusion — laid out as a graph with dependency and discard edges, an effort
timeline, and click-through to the verbatim thinking excerpts.

Start it once, keep the tab open, and every Claude Code session on your machine
becomes watchable — no configuration inside Claude Code, no API key required.

## Live mode (the product)

```bash
npm run live
```

Open http://localhost:4173. A file watcher on `~/.claude/projects` tracks every
recently active session and streams new thinking blocks to the page over SSE. The
**session strip** at the top shows each session with its task, activity dot, and move
count — click one to pin it, or stay on **⚡ Auto** to always follow the most recently
active session. Moves are typed instantly by a cue-based heuristic annotator
(`src/annotate.js`) — zero latency, zero cost. Restrict the watcher to one file with
`FOLLOW=/path/to/session.jsonl npm run live`.

### LLM-grade refinement (optional)

Export `ANTHROPIC_API_KEY` before `npm run live` and the map upgrades itself:
heuristic moves appear instantly, then ~6s after the session goes quiet a Claude Haiku
pass re-annotates the full trace with proper move boundaries, dependency edges, and
verbatim excerpts (forced structured output, `src/llm-annotate.js`). The page badge
shows `heuristic` vs `✦ LLM-refined`. Without a key everything works as before.
Model override: `COT_REFINE_MODEL` (default `claude-haiku-4-5`, ~$1/$5 per MTok).

Privacy note: refinement sends thinking text to the Anthropic API under your key.

## Install

Requires Node 18+.

```bash
git clone https://github.com/matanma12/reasoning-map.git
cd reasoning-map
npm install
npm run live
```

## Inline maps in the chat (MCP App)

The same renderer also ships as an MCP App (SEP-1865) so Claude can draw a reasoning
map *inline in the conversation* — useful for post-hoc analysis of a finished session:

```bash
claude mcp add cot-spike --scope user -- node "$(pwd)/server.js"
```

Restart Claude Code, then say *"map the reasoning of my last session"*. The flow:
`list_sessions` finds transcripts with thinking blocks → `get_thinking` extracts them →
the calling Claude annotates the moves itself (no API key) → `show_reasoning_map`
renders the widget (Claude Code desktop app / claude.ai; text fallback in the CLI).

## Under the hood: trace store & patterns

Every watched or rendered trace is saved to `~/.claude/cot-maps/traces/`, and a
pattern engine (`src/patterns.js`) tags named reasoning shapes — evidence loop,
hypothesis elimination, verify-before-commit, anti-patterns like leap-of-faith.
Pattern chips on each map highlight where a shape occurs; *"show my reasoning
pattern library"* renders the cross-trace view; `npm run backfill` (add `--llm`
for Haiku-grade annotation) seeds the store from your whole session history.

This layer runs silently and costs nothing. It also hedges the product against
raw CoT becoming scarcer: typed moves extracted from summaries and tool-call
sequences stay meaningful even where verbatim thinking isn't returned.

## Development

- `live.js` — the live server (watcher + SSE on :4173)
- `server.js` — MCP server (stdio; `npm run serve:http` for Streamable HTTP on :3001)
- `src/map-core.js` — shared renderer between the live page and the MCP widget
- `npm run build` — bundles (auto-runs before `npm run live`) `dist/{mcp-app,live,patterns}.html` (vite-plugin-singlefile)
- `node test-client.js` / `node test-refine.js` — protocol and refiner tests

## Roadmap — live-first

The focus is the live experience: making "watch your agent think" excellent.

1. ~~Multi-session dashboard~~ — shipped: session strip, pin/auto follow
2. **Live annotation quality** — richer heuristics, incremental (per-turn) LLM refinement
3. **Turn/tool context on the map** — show which tool calls each reasoning stretch drove
4. **Packaging** — one-command install (npx / Claude Code plugin), auto-start
5. **claude.ai deployment** — hosted HTTP mode for non-local use

Deferred, not deleted: the learning direction (predict-the-next-move replay, spaced
pattern review). The trace store and pattern engine keep collecting so that door
stays open.

MIT licensed.
