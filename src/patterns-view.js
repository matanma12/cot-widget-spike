import { App } from "@modelcontextprotocol/ext-apps";

const STROKE = {
  framing: "#888780", decomposition: "#5f5e5a", hypothesis: "#7f77dd", verification: "#1d9e75",
  backtrack: "#d85a30", self_correction: "#d4537e", insight: "#ef9f27", action: "#378add", conclusion: "#639922",
};

function render(data) {
  document.getElementById("sub").textContent =
    data.traceCount + " traces analyzed — patterns sorted by how often they appear in your sessions";
  const cards = document.getElementById("cards");
  cards.innerHTML = "";
  for (const p of data.patterns) {
    const card = document.createElement("div");
    card.className = "card" + (p.traceCount ? "" : " unseen");
    const h = document.createElement("h2");
    h.textContent = p.name;
    if (p.anti) { const t = document.createElement("span"); t.className = "anti-tag"; t.textContent = "ANTI"; h.appendChild(t); }
    const f = document.createElement("span");
    f.className = "freq";
    f.textContent = p.traceCount ? `${p.traceCount} traces · ${p.occurrences}×` : "not seen yet";
    h.appendChild(f);
    card.appendChild(h);
    const g = document.createElement("div");
    g.className = "glyph";
    for (const t of p.glyph || []) { const i = document.createElement("i"); i.style.background = STROKE[t] || "#888"; i.title = t; g.appendChild(i); }
    card.appendChild(g);
    const d = document.createElement("div"); d.className = "desc"; d.textContent = p.description; card.appendChild(d);
    const l = document.createElement("div"); l.className = "learn"; l.textContent = p.learn; card.appendChild(l);
    if (p.examples?.[0]) {
      const e = document.createElement("div"); e.className = "ex";
      e.textContent = "e.g. in “" + (p.examples[0].task || "").slice(0, 60) + "”: " + p.examples[0].moves.map((m) => m.summary).join(" → ").slice(0, 120);
      card.appendChild(e);
    }
    cards.appendChild(card);
  }
}

const app = new App({ name: "Pattern Library", version: "0.4.0" });
app.ontoolresult = (r) => r.structuredContent?.patterns && render(r.structuredContent);
app.connect();
window.__renderPatterns = render;
