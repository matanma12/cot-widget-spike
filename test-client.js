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

// pattern library (appended v0.4 checks)
const client2 = new Client({ name: "spike-test-2", version: "0.0.3" });
await client2.connect(new StdioClientTransport({ command: "node", args: ["server.js"] }));
const lib = await client2.callTool({ name: "show_pattern_library", arguments: {} });
console.log("LIBRARY text:\n" + lib.content[0].text);
console.log("LIBRARY traceCount:", lib.structuredContent?.traceCount, "| patterns:", lib.structuredContent?.patterns?.length);
const withPat = await client2.callTool({ name: "show_reasoning_map", arguments: {
  task: "pattern test", source: "pattern-test",
  moves: [
    { type: "framing", summary: "Frame", excerpt: "a" },
    { type: "hypothesis", summary: "H1", excerpt: "b" },
    { type: "verification", summary: "Check", excerpt: "c" },
    { type: "conclusion", summary: "Done", excerpt: "d" },
  ],
}});
console.log("MAP patterns:", withPat.structuredContent?.patterns?.map((p) => p.name));
await client2.close();
