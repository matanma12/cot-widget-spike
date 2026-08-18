import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "spike-test", version: "0.0.2" });
await client.connect(new StdioClientTransport({ command: "node", args: ["server.js"] }));

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

const sessions = await client.callTool({ name: "list_sessions", arguments: { limit: 3 } });
const list = JSON.parse(sessions.content[0].text);
console.log("SESSIONS:", list.map((s) => `${s.title?.slice(0, 40)} (${s.thinkingBlocks} thinking)`));

const think = await client.callTool({ name: "get_thinking", arguments: { session_path: list[0].path, max_chars: 2000 } });
console.log("THINKING sample:", think.content[0].text.slice(0, 300).replace(/\n/g, " | "));

const bad = await client.callTool({ name: "get_thinking", arguments: { session_path: "/etc/passwd" } });
console.log("PATH GUARD:", bad.content[0].text);

const map = await client.callTool({ name: "show_reasoning_map", arguments: {
  task: "e2e test", source: "test-client",
  moves: [
    { type: "framing", summary: "Understand", excerpt: "quote one" },
    { type: "hypothesis", summary: "Guess", excerpt: "quote two", depends_on: [1] },
    { type: "backtrack", summary: "Nope", excerpt: "quote three", discards: [2] },
  ],
}});
console.log("MAP structured moves:", map.structuredContent?.moves?.length, "| text head:", map.content[0].text.split("\n")[0]);

const demo = await client.callTool({ name: "show_reasoning_map", arguments: {} });
console.log("DEMO fallback moves:", demo.structuredContent?.moves?.length);
await client.close();
