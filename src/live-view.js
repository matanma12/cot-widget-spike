import { setTrace } from "./map-core.js";

const source = document.getElementById("source");
const strip = document.getElementById("session-strip");

let watch = "auto";
let autoId = null;
let currentTrace = null;
let es = null;

function fmtAge(ms) {
  const d = Date.now() - ms;
  if (d < 60_000) return "now";
  if (d < 3600_000) return Math.round(d / 60_000) + "m";
  return Math.round(d / 3600_000) + "h";
}

function renderStrip(sessionsList) {
  strip.innerHTML = "";
  const mk = (label, id, extra) => {
    const b = document.createElement("button");
    b.className = "sess" + ((watch === id || (watch === "auto" && id === "auto")) ? " sel" : "");
    if (extra) b.append(extra.dot, extra.title, extra.count);
    else {
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = label;
      b.append(t);
    }
    b.addEventListener("click", () => switchTo(id));
    strip.appendChild(b);
  };
  mk("\u26a1 Auto", "auto");
  for (const s of sessionsList) {
    const dot = document.createElement("span");
    dot.className = "dot" + (Date.now() - s.lastActivity < 90_000 ? " hot" : "");
    const title = document.createElement("span");
    title.className = "t";
    title.textContent = s.task;
    title.title = s.task;
    const count = document.createElement("span");
    count.className = "n";
    count.textContent = s.moves + (s.quality === "llm" ? " \u2726" : "") + " \u00b7 " + fmtAge(s.lastActivity);
    const b = document.createElement("button");
    b.className = "sess" + (watch === s.id ? " sel" : "");
    b.append(dot, title, count);
    b.addEventListener("click", () => switchTo(s.id));
    strip.appendChild(b);
  }
}

function switchTo(id) {
  if (watch === id) return;
  watch = id;
  connect();
}

function statusLine(data) {
  const q = data.quality === "llm" ? " \u00b7 \u2726 LLM-refined" : " \u00b7 heuristic";
  const mode = watch === "auto" ? "auto" : "pinned";
  source.textContent = "\u25cf live (" + mode + ") — " + (data.session || "") + q;
}

let lastSessions = [];
function connect() {
  if (es) es.close();
  es = new EventSource("/events?session=" + encodeURIComponent(watch));
  es.onopen = () => (source.textContent = "\u25cf live — waiting for activity");
  es.onerror = () => (source.textContent = "\u25cb disconnected — is live.js running?");
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "sessions") {
      autoId = data.auto;
      lastSessions = data.sessions;
      renderStrip(data.sessions);
    } else if (data.type === "trace" && data.moves) {
      currentTrace = data;
      setTrace(data);
      statusLine(data);
    }
  };
}

setInterval(() => renderStrip(lastSessions), 30_000);
connect();
