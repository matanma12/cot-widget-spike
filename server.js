import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
  name: "CoT Widget Spike",
  version: "0.1.0",
});

const resourceUri = "ui://cot-spike/mcp-app.html";

const SAMPLE_TRACE = {
  task: "Debug: intermittent test failure in payment flow",
  moves: [
    { type: "framing", summary: "Frame the problem", excerpt: "The test fails roughly 1 in 5 runs. Intermittent failures usually mean timing, shared state, or external dependencies. Let me enumerate what's shared between test runs." },
    { type: "hypothesis", summary: "Hypothesis A: race condition", excerpt: "The payment handler spawns an async job. If the assertion runs before the job commits, we'd see exactly this flakiness. Let me check whether the test awaits the job." },
    { type: "verification", summary: "Check the logs", excerpt: "Looking at the CI logs from failed runs... the job completion timestamp is BEFORE the assertion timestamp in all five failures. So the job had finished. That contradicts the race hypothesis." },
    { type: "backtrack", summary: "Contradiction — discard A", excerpt: "Wait, that can't be right. If the job finished first, timing isn't the issue. What else is shared? The test database is reused across the suite..." },
    { type: "hypothesis", summary: "Hypothesis B: stale cache", excerpt: "The balance lookup goes through a read cache with a 2s TTL. A previous test writes to the same account. If the cache still holds the old balance, the assertion fails — and only when tests run fast enough. That fits the 1-in-5 pattern." },
    { type: "verification", summary: "Verify with experiment", excerpt: "Prediction: clearing the cache in setup should make the failure disappear entirely. Ran the suite 30 times with cache clearing — zero failures. Removed it — 6 failures. Confirmed." },
    { type: "conclusion", summary: "Conclusion", excerpt: "Root cause: cross-test cache pollution, not a race. Fix: scope the cache per test. Confidence: high — the experiment isolates the variable cleanly." },
  ],
};

registerAppTool(
  server,
  "show_reasoning_map",
  {
    title: "Show reasoning map",
    description:
      "Renders an interactive map of a chain-of-thought trace (sample data) as an inline widget. Use when the user asks to see or test the reasoning map.",
    inputSchema: {},
    _meta: { ui: { resourceUri } },
  },
  async () => {
    return {
      content: [
        {
          type: "text",
          text:
            "Reasoning map for: " + SAMPLE_TRACE.task + "\n" +
            SAMPLE_TRACE.moves.map((m, i) => `${i + 1}. [${m.type}] ${m.summary}`).join("\n"),
        },
      ],
      structuredContent: SAMPLE_TRACE,
    };
  },
);

registerAppResource(
  server,
  resourceUri,
  resourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => {
    const html = await fs.readFile(path.join(__dirname, "dist", "mcp-app.html"), "utf-8");
    return {
      contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
    };
  },
);

if (process.argv.includes("--http")) {
  const { default: express } = await import("express");
  const { default: cors } = await import("cors");
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.listen(3001, () => console.error("HTTP MCP server on http://localhost:3001/mcp"));
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CoT spike MCP server running on stdio");
}
