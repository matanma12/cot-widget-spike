export const TYPE_CODE = {
  framing: "f", decomposition: "d", hypothesis: "h", verification: "v",
  backtrack: "b", self_correction: "s", insight: "i", action: "a", conclusion: "c",
};

const encode = (moves) => moves.map((m) => TYPE_CODE[m.type] || "f").join("");

function reSpans(re, str) {
  const spans = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = r.exec(str))) {
    spans.push([m.index, m.index + m[0].length - 1]);
    r.lastIndex = m.index + 1;
  }
  return spans;
}

export const CATALOG = [
  {
    id: "frame_first", name: "Frame first", glyph: ["framing", "decomposition"],
    description: "Opens by framing the problem or breaking it down before proposing any answer.",
    learn: "Resist jumping to solutions. Spend the first move defining what would count as an answer.",
    match: (str) => (/^[fd]/.test(str) ? [[0, 0]] : []),
  },
  {
    id: "hypothesis_elimination", name: "Hypothesis elimination", glyph: ["hypothesis", "backtrack", "hypothesis"],
    description: "Proposes an explanation, refutes it, and replaces it instead of defending the first idea.",
    learn: "A discarded hypothesis is progress, not failure — each elimination narrows the search space.",
    match: (str) => reSpans(/h[^h]*[bs][^h]*h/, str),
  },
  {
    id: "evidence_loop", name: "Evidence loop", glyph: ["hypothesis", "verification", "hypothesis", "verification"],
    description: "Alternates between guessing and testing at least twice in a row.",
    learn: "Tight guess-test cycles beat long chains of unchecked reasoning.",
    match: (str) => reSpans(/(?:h[^hc]*v){2,}/, str),
  },
  {
    id: "verify_before_commit", name: "Verify before commit", glyph: ["verification", "conclusion"],
    description: "The conclusion rests directly on a verification, not on a hunch.",
    learn: "Before concluding, ask: what did I actually check that makes this true?",
    match: (str) => reSpans(/v[ai]?c/, str),
  },
  {
    id: "leap_of_faith", name: "Leap of faith", glyph: ["hypothesis", "conclusion"], anti: true,
    description: "Anti-pattern: a conclusion with no verification anywhere in the three moves before it.",
    learn: "Spot this in your own work — a conclusion that no check supports is a guess wearing a suit.",
    match: (str) => {
      const spans = [];
      for (let i = 0; i < str.length; i++) {
        if (str[i] === "c" && !str.slice(Math.max(0, i - 3), i).includes("v")) spans.push([Math.max(0, i - 1), i]);
      }
      return spans;
    },
  },
  {
    id: "early_backtrack", name: "Early backtrack", glyph: ["backtrack"],
    description: "Abandons a bad path in the first third of the trace, before sunk cost accumulates.",
    learn: "The earlier you let a wrong idea die, the cheaper it was to have had it.",
    match: (str) => {
      if (str.length < 6) return [];
      const cut = Math.floor(str.length / 3);
      const spans = [];
      for (let i = 0; i <= cut; i++) if ("bs".includes(str[i])) spans.push([i, i]);
      return spans;
    },
  },
  {
    id: "hypothesis_fanout", name: "Hypothesis fan-out", glyph: ["hypothesis", "hypothesis", "verification"],
    description: "Puts two or more candidate explanations on the table before testing any of them.",
    learn: "Generating alternatives up front protects you from anchoring on the first idea.",
    match: (str) => {
      const firstV = str.indexOf("v");
      const head = firstV === -1 ? str : str.slice(0, firstV);
      const hs = [...head].map((ch, i) => (ch === "h" ? i : -1)).filter((i) => i >= 0);
      return hs.length >= 2 ? [[hs[0], hs[hs.length - 1]]] : [];
    },
  },
  {
    id: "checked_landing", name: "Checked landing", glyph: ["conclusion"],
    description: "Ends with an explicit conclusion instead of trailing off mid-thought.",
    learn: "Always land the plane: state the answer and your confidence in it.",
    match: (str) => (str.endsWith("c") ? [[str.length - 1, str.length - 1]] : []),
  },
];

export function detectPatterns(moves) {
  const str = encode(moves);
  const found = [];
  for (const p of CATALOG) {
    const spans = p.match(str);
    if (spans.length) found.push({ id: p.id, name: p.name, anti: !!p.anti, spans });
  }
  return found;
}

export function aggregate(traces) {
  const byId = new Map();
  for (const p of CATALOG) byId.set(p.id, { ...p, match: undefined, occurrences: 0, traceCount: 0, examples: [] });
  for (const t of traces) {
    const found = t.patterns?.length ? t.patterns : detectPatterns(t.moves);
    for (const f of found) {
      const agg = byId.get(f.id);
      if (!agg) continue;
      agg.occurrences += f.spans.length;
      agg.traceCount += 1;
      if (agg.examples.length < 2) {
        const [a, b] = f.spans[0];
        agg.examples.push({
          task: t.task,
          moves: t.moves.slice(a, b + 1).map((m) => ({ type: m.type, summary: m.summary })),
          excerpt: t.moves[a]?.excerpt?.slice(0, 200) || "",
        });
      }
    }
  }
  return [...byId.values()].sort((x, y) => y.traceCount - x.traceCount);
}
