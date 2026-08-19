
const COLORS = {
  framing:         { l: "#5f5e5a", d: "#d3d1c7", s: "#888780" },
  decomposition:   { l: "#444441", d: "#b4b2a9", s: "#5f5e5a" },
  hypothesis:      { l: "#534ab7", d: "#cecbf6", s: "#7f77dd" },
  verification:    { l: "#0f6e56", d: "#9fe1cb", s: "#1d9e75" },
  backtrack:       { l: "#993c1d", d: "#f5c4b3", s: "#d85a30" },
  self_correction: { l: "#993556", d: "#f4c0d1", s: "#d4537e" },
  insight:         { l: "#854f0b", d: "#fac775", s: "#ef9f27" },
  action:          { l: "#185fa5", d: "#b5d4f4", s: "#378add" },
  conclusion:      { l: "#3b6d11", d: "#c0dd97", s: "#639922" },
};
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const ink = (t) => (COLORS[t] || COLORS.framing)[dark ? "d" : "l"];
const stroke = (t) => (COLORS[t] || COLORS.framing).s;

const NS = "http://www.w3.org/2000/svg";
const el = (n, at = {}) => { const e = document.createElementNS(NS, n); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); return e; };

const COLS = 4, W = 165, H = 48, GX = 28, GY = 74, PAD = 16;
let trace = null, nodes = [], selected = -1, revealed = Infinity, timer = null;

function layout(moves) {
  return moves.map((m, i) => {
    const row = Math.floor(i / COLS), col = i % COLS;
    const c = row % 2 ? COLS - 1 - col : col;
    return { m, i, x: PAD + c * (W + GX), y: PAD + row * (H + GY) + 14 };
  });
}

function edgePath(a, b, bow = 0) {
  const ax = a.x + W / 2, ay = a.y + H, bx = b.x + W / 2, by = b.y;
  if (Math.abs(a.y - b.y) < 1) {
    if (Math.abs(a.x - b.x) <= W + GX + 1) {
      const sx = a.x < b.x ? a.x + W : a.x, tx = a.x < b.x ? b.x : b.x + W, my = a.y + H / 2;
      return `M ${sx} ${my} L ${tx} ${my}`;
    }
    const sx = a.x + W / 2, tx = b.x + W / 2;
    return `M ${sx} ${a.y} Q ${(sx + tx) / 2} ${a.y - 52} ${tx} ${b.y}`;
  }
  const mx = (ax + bx) / 2 + bow, my = (ay + by) / 2;
  return `M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`;
}

function render() {
  const moves = trace.moves;
  document.getElementById("task").textContent = trace.task || "Reasoning map";
  document.getElementById("source").textContent = trace.source || "";
  const counts = {};
  moves.forEach((m) => (counts[m.type] = (counts[m.type] || 0) + 1));
  document.getElementById("stats").textContent =
    moves.length + " moves — " + Object.entries(counts).map(([k, v]) => v + " " + k.replace("_", " ")).join(", ");

  nodes = layout(moves);
  const rows = Math.ceil(moves.length / COLS);
  const svg = el("svg", { viewBox: `0 -30 ${PAD * 2 + COLS * W + (COLS - 1) * GX} ${rows * (H + GY) - GY + PAD * 2 + 44}` });

  nodes.forEach((n, i) => {
    if (i === 0) return;
    const p = el("path", { d: edgePath(nodes[i - 1], n), class: "edge", stroke: "#888780", "marker-end": "" });
    p.dataset.to = i; svg.appendChild(p);
  });
  nodes.forEach((n) => {
    for (const ref of n.m.depends_on || []) {
      const j = ref - 1;
      if (j >= 0 && j < n.i - 1) {
        const p = el("path", { d: edgePath(nodes[j], n, 40), class: "edge", stroke: stroke(n.m.type), "stroke-dasharray": "1 4", "stroke-linecap": "round" });
        p.dataset.to = n.i; svg.appendChild(p);
      }
    }
    for (const ref of n.m.discards || []) {
      const j = ref - 1;
      if (j >= 0 && j < n.i) {
        const p = el("path", { d: edgePath(nodes[j], n, -40), class: "edge", stroke: stroke("backtrack"), "stroke-dasharray": "6 4" });
        p.dataset.to = n.i; svg.appendChild(p);
        const sameRow = Math.abs(nodes[j].y - n.y) < 1 && Math.abs(nodes[j].x - n.x) > W + GX + 1;
        const t = el("text", { x: (nodes[j].x + n.x + W) / 2 - 22, y: sameRow ? n.y - 32 : (nodes[j].y + H + n.y) / 2, fill: stroke("backtrack"), "font-size": "11" });
        t.textContent = "discards"; t.dataset.to = n.i; t.classList.add("edge"); svg.appendChild(t);
      }
    }
  });
  nodes.forEach((n) => {
    const g = el("g", { class: "node", transform: `translate(${n.x},${n.y})` });
    g.dataset.i = n.i;
    g.appendChild(el("rect", { width: W, height: H, stroke: stroke(n.m.type) }));
    const idx = el("text", { x: 10, y: 17, fill: ink(n.m.type), class: "idx" });
    idx.textContent = (n.i + 1) + " · " + n.m.type.replace("_", " ");
    const lbl = el("text", { x: 10, y: 35, fill: ink(n.m.type), "font-weight": "600" });
    lbl.textContent = n.m.summary.length > 24 ? n.m.summary.slice(0, 23) + "…" : n.m.summary;
    g.append(idx, lbl);
    g.addEventListener("click", () => select(n.i, true));
    svg.appendChild(g);
  });
  const wrap = document.getElementById("graph-wrap");
  wrap.innerHTML = ""; wrap.appendChild(svg);

  const tl = document.getElementById("timeline");
  tl.innerHTML = "";
  const weights = moves.map((m) => m.weight || Math.max(1, Math.min(5, (m.excerpt || "").length / 80)));
  const total = weights.reduce((a, b) => a + b, 0);
  moves.forEach((m, i) => {
    const seg = document.createElement("div");
    seg.style.flex = weights[i] / total;
    seg.style.background = stroke(m.type);
    seg.style.color = stroke(m.type);
    seg.dataset.i = i;
    seg.title = (i + 1) + ". " + m.summary;
    seg.addEventListener("click", () => select(i, true));
    tl.appendChild(seg);
  });

  const legend = document.getElementById("legend");
  legend.innerHTML = "";
  Object.keys(counts).forEach((t) => {
    const s = document.createElement("span");
    s.style.color = stroke(t);
    s.append(t.replace("_", " "));
    legend.appendChild(s);
  });
  applyReveal();
}

function select(i, stopReplay) {
  if (stopReplay) stopTimer();
  selected = i;
  const m = trace.moves[i];
  document.querySelectorAll(".node").forEach((g) => g.classList.toggle("sel", +g.dataset.i === i));
  document.querySelectorAll("#timeline div").forEach((d) => d.classList.toggle("sel", +d.dataset.i === i));
  document.getElementById("detail").style.borderLeftColor = stroke(m.type);
  document.getElementById("detail").innerHTML =
    `<span class="badge" style="color:${ink(m.type)};border-color:${stroke(m.type)}">${m.type.replace("_", " ")}</span>` +
    `<span class="sum"></span><div class="exc"></div>`;
  document.querySelector("#detail .sum").textContent = (i + 1) + ". " + m.summary;
  document.querySelector("#detail .exc").textContent = "“" + m.excerpt + "”";
}

function applyReveal() {
  document.querySelectorAll(".node").forEach((g) => g.classList.toggle("dim", +g.dataset.i >= revealed));
  document.querySelectorAll(".edge").forEach((p) => p.classList.toggle("dim", +p.dataset.to >= revealed));
  document.querySelectorAll("#timeline div").forEach((d) => d.classList.toggle("dim", +d.dataset.i >= revealed));
}

function stopTimer() { if (timer) { clearInterval(timer); timer = null; document.getElementById("replay").innerHTML = "&#9654; Replay"; } }

document.getElementById("replay").addEventListener("click", () => {
  if (timer) { stopTimer(); return; }
  revealed = 0; applyReveal();
  document.getElementById("replay").innerHTML = "&#9646;&#9646; Pause";
  timer = setInterval(() => {
    if (revealed >= trace.moves.length) { stopTimer(); return; }
    select(revealed, false); revealed++; applyReveal();
  }, 1600);
});
document.getElementById("step").addEventListener("click", () => {
  stopTimer();
  if (revealed >= trace.moves.length) revealed = 0;
  select(revealed, false); revealed++; applyReveal();
});
document.getElementById("reset").addEventListener("click", () => { stopTimer(); revealed = Infinity; applyReveal(); });


export function setTrace(t) {
  if (!t || !t.moves) return;
  const keepSel = selected >= 0 && trace && t.moves.length > trace.moves.length ? selected : -1;
  trace = t;
  revealed = Infinity;
  render();
  if (keepSel >= 0 && keepSel < t.moves.length) select(keepSel, false);
}
window.__renderTrace = setTrace;
