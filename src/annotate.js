const CUES = [
  [/^(wait\b|hold on|that can'?t be right|that doesn'?t)/i, "backtrack"],
  [/^(actually|on second thought|correction[,:]|scratch that|no —|no, )/i, "self_correction"],
  [/^(maybe|perhaps|what if|could (it|this) be|hypothes|my guess|i suspect|likely (the|it)|probably)/i, "hypothesis"],
  [/^(let me (check|verify|test|confirm|look at|inspect|re-?read)|to verify|checking|verifying|testing|does (that|this) hold)/i, "verification"],
  [/^(so[, ]|therefore|in conclusion|conclusion[,:]|root cause|the answer|this confirms|confirmed)/i, "conclusion"],
  [/^(first[,:]|the plan|plan[,:]|steps?[,:]|i'?ll break|let'?s break|break (this|it) (down|into))/i, "decomposition"],
  [/^(let me (run|write|edit|create|search|grep|build|install)|i'?ll (run|write|edit|create|use|add|start))/i, "action"],
  [/^(interesting|aha|oh[,!]|notably|key insight|importantly|the trick is|note that)/i, "insight"],
];

function classify(sentence) {
  for (const [re, type] of CUES) if (re.test(sentence.trim())) return type;
  return null;
}

function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=["'A-Z\d(])/).map((s) => s.trim()).filter(Boolean);
}

// Segment one thinking block into typed moves. `state` carries indices across blocks.
export function annotateBlock(text, state) {
  const moves = [];
  let cur = null;
  for (const s of sentences(text)) {
    const cue = classify(s);
    if (cue && (!cur || cue !== cur.type)) {
      if (cur) moves.push(cur);
      cur = { type: cue, text: s };
    } else if (!cur) {
      cur = { type: state.total === 0 ? "framing" : "framing", text: s };
    } else {
      cur.text += " " + s;
    }
  }
  if (cur) moves.push(cur);

  return moves.map((m) => {
    const idx = ++state.total;
    const words = m.text.split(/\s+/);
    const move = {
      type: m.type,
      summary: words.slice(0, 8).join(" ") + (words.length > 8 ? "…" : ""),
      excerpt: m.text.length > 320 ? m.text.slice(0, 317) + "…" : m.text,
      weight: Math.max(1, Math.min(5, Math.round(m.text.length / 150))),
    };
    if ((m.type === "backtrack" || m.type === "self_correction") && state.lastHypothesis) {
      move.discards = [state.lastHypothesis];
    } else if (m.type === "verification" && state.lastHypothesis) {
      move.depends_on = [state.lastHypothesis];
    } else if (m.type === "conclusion" && state.lastVerification) {
      move.depends_on = [state.lastVerification];
    }
    if (m.type === "hypothesis") state.lastHypothesis = idx;
    if (m.type === "verification") state.lastVerification = idx;
    return move;
  });
}

export function newAnnotationState() {
  return { total: 0, lastHypothesis: 0, lastVerification: 0 };
}
