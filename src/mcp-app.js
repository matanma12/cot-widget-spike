import { App } from "@modelcontextprotocol/ext-apps";
import { setTrace } from "./map-core.js";

const app = new App({ name: "CoT Reasoning Map", version: "0.3.0" });
app.ontoolresult = (result) => setTrace(result.structuredContent);
app.connect();
