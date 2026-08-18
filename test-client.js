import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "spike-test", version: "0.0.1" });
const transport = new StdioClientTransport({ command: "node", args: ["server.js"] });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", JSON.stringify(tools.tools.map(t => ({ name: t.name, _meta: t._meta })), null, 2));

const result = await client.callTool({ name: "show_reasoning_map", arguments: {} });
console.log("TOOL RESULT text:", result.content?.[0]?.text?.slice(0, 120));
console.log("TOOL RESULT structured moves:", result.structuredContent?.moves?.length);
console.log("TOOL RESULT _meta:", JSON.stringify(result._meta || null));

const res = await client.readResource({ uri: "ui://cot-spike/mcp-app.html" });
console.log("RESOURCE mimeType:", res.contents?.[0]?.mimeType, "| bytes:", res.contents?.[0]?.text?.length);
await client.close();
