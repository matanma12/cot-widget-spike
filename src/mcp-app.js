import { App } from "@modelcontextprotocol/ext-apps";

const taskEl = document.getElementById("task");
const stripEl = document.getElementById("strip");
const excerptEl = document.getElementById("excerpt");
const statusEl = document.getElementById("status");
const pingEl = document.getElementById("ping");

const app = new App({ name: "Reasoning Map Spike", version: "0.1.0" });

function render(trace) {
  if (!trace || !trace.moves) return;
  taskEl.textContent = trace.task;
  stripEl.innerHTML = "";
  trace.moves.forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "move " + m.type;
    b.textContent = (i + 1) + ". " + m.summary;
    b.addEventListener("click", () => {
      excerptEl.textContent = m.excerpt;
      for (const el of stripEl.children) el.classList.remove("active");
      b.classList.add("active");
    });
    stripEl.appendChild(b);
  });
}

app.ontoolresult = (result) => {
  statusEl.textContent = "connected — initial tool result received";
  render(result.structuredContent);
};

pingEl.addEventListener("click", async () => {
  statusEl.textContent = "calling show_reasoning_map on server…";
  try {
    const result = await app.callServerTool({ name: "show_reasoning_map", arguments: {} });
    render(result.structuredContent);
    statusEl.textContent = "round-trip OK at " + new Date().toLocaleTimeString();
  } catch (e) {
    statusEl.textContent = "round-trip failed: " + (e && e.message ? e.message : e);
  }
});

app.connect().then(
  () => { if (statusEl.textContent.startsWith("connecting")) statusEl.textContent = "connected to host"; },
  (e) => { statusEl.textContent = "connect failed: " + (e && e.message ? e.message : e); }
);
