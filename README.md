# CoT Reasoning Map

Learn from Claude's chain of thought. An MCP App (SEP-1865) for Claude Code that turns
extended-thinking traces into interactive **reasoning maps** — typed moves (framing,
hypothesis, verification, backtrack, self-correction, insight, action, conclusion) laid
out as a graph with dependency and discard edges, an effort timeline, replay mode, and
click-through to the verbatim CoT excerpts.

No API key needed: the Claude session you're already running does the annotation.

## How it works

1. `list_sessions` — finds recent Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) containing thinking blocks
2. `get_thinking` — extracts the numbered thinking blocks + tool-call skeleton from a session
3. The calling Claude annotates the thinking into typed moves with verbatim excerpts
4. `show_reasoning_map` — renders the moves as an interactive widget inline in the chat
   (Claude Code desktop app / claude.ai; text fallback in the terminal CLI)

Say things like: *"map the reasoning of my last session"* or *"show me a demo reasoning map"*
(no-args call renders sample data).

## Live mode

Watch the reasoning map grow in real time while a Claude Code session runs:

```bash
npm run live
```

Open http://localhost:4173. The watcher follows whichever session is most recently
active (pin one with `FOLLOW=/path/to/session.jsonl npm run live`). New thinking
blocks are typed instantly by a cue-based heuristic annotator (`src/annotate.js`) —
no API key, no latency. The widget and the live page share one renderer (`src/map-core.js`).

### LLM-grade refinement (optional)

Export `ANTHROPIC_API_KEY` before `npm run live` and the live map upgrades itself:
heuristic moves appear instantly, then ~6s after the session goes quiet a Claude Haiku
pass re-annotates the full trace with proper move boundaries, dependency edges, and
verbatim excerpts (forced structured output, `src/llm-annotate.js`). The page badge
shows `heuristic` vs `✦ LLM-refined`. Without a key everything works as before.
Also upgrades the pattern-library corpus: `npm run backfill -- --llm`.
Model override: `COT_REFINE_MODEL` (default `claude-haiku-4-5`, ~$1/$5 per MTok).

Privacy note: refinement sends thinking text to the Anthropic API under your key.

## Pattern library

Every rendered or live-watched trace is saved to `~/.claude/cot-maps/traces/`. The
library mines them for named reasoning shapes — evidence loop, hypothesis elimination,
verify-before-commit, and anti-patterns like leap-of-faith — each with a learning note
and real examples from your own sessions.

- Ask Claude: *"show my reasoning pattern library"* (inline widget via `show_pattern_library`)
- Seed it from your whole session history: `npm run backfill`
- Pattern chips on every reasoning map highlight where a pattern occurs — click to see the span

## Install

Requires Node 18+.

```bash
git clone https://github.com/matanma12/cot-widget-spike.git
cd cot-widget-spike
npm install && npm run build
claude mcp add cot-spike --scope user -- node "$(pwd)/server.js"
```

Restart Claude Code and ask for a reasoning map.

## Development

- `server.js` — MCP server (stdio; `npm run serve:http` for Streamable HTTP on :3001)
- `mcp-app.html` + `src/mcp-app.js` — the widget (`App` from `@modelcontextprotocol/ext-apps`)
- `npm run build` — bundles to `dist/mcp-app.html` (vite-plugin-singlefile)
- `node test-client.js` — protocol smoke test over stdio

## Status / roadmap

Working: ingestion, host-model annotation loop, graph + timeline + replay + excerpts,
verified inline rendering in Claude Code desktop, live mode (file watcher + SSE + heuristic
annotation), pattern library across traces (catalog in `src/patterns.js`, store, backfill,
library widget, pattern chips on maps), hybrid LLM refinement for live mode (instant
heuristics upgraded by Haiku when a key is present). Next: predict-the-next-move
replay, claude.ai deployment.

MIT licensed.
