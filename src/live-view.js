import { setTrace } from "./map-core.js";

const source = document.getElementById("source");
const es = new EventSource("/events");
es.onopen = () => (source.textContent = "\u25cf live — waiting for activity");
es.onerror = () => (source.textContent = "\u25cb disconnected — is live.js running?");
es.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.moves) {
    setTrace(data);
    source.textContent = "\u25cf live — " + (data.session || "");
  }
};
