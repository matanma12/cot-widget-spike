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
verified inline rendering in Claude Code desktop. Next: live session following via hooks,
pattern library across traces, predict-the-next-move replay, claude.ai deployment.

MIT licensed.
