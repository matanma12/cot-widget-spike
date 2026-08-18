# CoT widget spike — MCP App in Claude Code

Minimal MCP App (SEP-1865) proving the inline-widget path for the CoT-visualization product.
One tool, `show_reasoning_map`, returns a sample chain-of-thought trace; the attached
`ui://cot-spike/mcp-app.html` resource renders it as an interactive move-map
(click a move → original CoT excerpt; button → live `callServerTool` round-trip).

## Layout
- `server.js` — MCP server (stdio by default, `--http` for Streamable HTTP on :3001)
- `mcp-app.html` + `src/mcp-app.js` — widget, uses `App` from `@modelcontextprotocol/ext-apps`
- `dist/mcp-app.html` — single-file bundle (vite-plugin-singlefile); rebuild with `npm run build`
- `test-client.js` — protocol smoke test: `node test-client.js`

## Verified so far
- Tool advertises `_meta.ui.resourceUri` (SDK also emits legacy `ui/resourceUri`)
- Resource serves `text/html;profile=mcp-app` (323 KB bundled)
- Tool result carries text (model/CLI fallback) + `structuredContent` (widget data)
- Registered in Claude Code user scope: `claude mcp add cot-spike -- node .../server.js` → Connected

## Spike result (2026-08-18)

- **Claude Code desktop does NOT render the MCP App inline.** Test 1 ran (new session,
  "Call show_reasoning_map from cot-spike"): tool call succeeded, no widget — chat text only.
- Fallback detail: the model received the tool result as the raw `structuredContent` JSON,
  not the `content` text block. So the CLI/desktop harness prefers structuredContent when present.
- Server-side wiring is confirmed good (tool advertises `_meta.ui.resourceUri`, resource serves
  the mcp-app profile) — the desktop host simply doesn't fetch/render the UI resource yet.
- Docs check (2026-08-18): the official MCP client support matrix
  (modelcontextprotocol.io/extensions/client-matrix) lists claude.ai and Claude Desktop as
  MCP Apps hosts; **Claude Code is absent entirely** (desktop, CLI, IDE). No flag/version gates it.
  Open GH issue confirms the Cowork renderer gap; a closed-not-planned issue reports claude.ai
  custom REMOTE connectors sometimes fail to render too — tunnel test is not a sure thing.
- Best next test: Claude Desktop (chat app) with this same stdio server via
  claude_desktop_config.json — it's on the support matrix and needs no tunnel.

## To test rendering
1. **Claude Code desktop**: start a NEW session (server was added after this one began),
   ask: "Call show_reasoning_map from cot-spike". Does a widget render inline, or text?
2. **CLI**: run `claude` in a logged-in terminal, same prompt. Expect text fallback.
3. **claude.ai (web)**: `npm run serve:http`, then `npx cloudflared tunnel --url http://localhost:3001`,
   add the tunnel URL as a custom connector (Settings → Connectors). Confirmed MCP Apps surface.

## Open questions this spike answers empirically
- Does Claude Code desktop (Cowork) render MCP Apps, or only claude.ai/Claude Desktop chat?
- What exactly does the CLI show as fallback (text block? resource link?)
