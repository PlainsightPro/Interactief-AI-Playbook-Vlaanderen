// Activity body formatter — parses raw own_text (PDF-extracted Dutch text)
// into structured blocks, then renders them to a DOM tree.
//
// Recognized block types:
//   - subheader: short capitalized line without terminal punctuation
//   - paragraph: prose run
//   - bullets: lines starting with • (often with tab)
//   - numbered: lines starting with N. or N) (often with tab)
//   - step: "Stap N: Title" + indented body
//   - quote: "…" with optional – Attribution
//   - questions: PDF-broken 4-question diagram (e.g. AI-ambitie radar inputs)
//   - callout: TOOLBOX / PRAKTIJKVOORBEELD / EINDPRODUCT block
//
// Images supplied with the activity get assigned to the highest-value
// "visual anchor" blocks in source order (question diagrams, framework-style
// TOOLBOX callouts, practice examples).

import { el } from "./utils.js";

const CALLOUT_PATTERNS = [
  { kind: "toolbox",     label: "Toolbox",          regex: /^TOOLBOX\s*[–\-]\s*(.+)$/i },
  { kind: "praktijk",    label: "Praktijkvoorbeeld", regex: /^PRAKTIJKVOORBEELD\s*[–\-]\s*(.+)$/i },
  { kind: "eindproduct", label: "Eindproduct",      regex: /^EINDPRODUCT\s*[–\-]\s*(.+)$/i },
];

function tryCallout(firstLine) {
  const t = firstLine.trim();
  for (const p of CALLOUT_PATTERNS) {
    const m = p.regex.exec(t);
    if (m) return { kind: p.kind, label: p.label, title: m[1].trim() };
  }
  return null;
}

// Strip leading section number + duplicate title that mirror the card head.
// e.g. "1.1\nFORMULEER EEN AI-STRATEGIE\n1.1.1\nFormuleer een AI-ambitie\n..."
function stripActivityHeader(text, activity) {
  if (!text) return "";
  const lines = text.split("\n");
  let i = 0;
  while (i < Math.min(lines.length, 8)) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (/^\d+(\.\d+){0,3}$/.test(line)) { i++; continue; }
    if (line.length < 80 && /^[A-Z][A-Z0-9 &–\-,’'.]*$/.test(line)) { i++; continue; }
    if (activity?.title && line.toLowerCase() === activity.title.toLowerCase()) { i++; continue; }
    if (activity?.number && line === activity.number) { i++; continue; }
    break;
  }
  return lines.slice(i).join("\n");
}

// Try to detect a "questions diagram" starting at position `start`.
// The PDF column extraction breaks each question across multiple short lines;
// we collect the run and re-stitch on ? boundaries.
function tryQuestionDiagram(lines, start) {
  let end = start;
  let qCount = 0;
  while (end < lines.length) {
    const t = lines[end].trim();
    if (!t) break;
    if (t.length > 60) break;
    if (/^[•·]/.test(t)) break;
    if (/^\d+[\.\)][\s\t]/.test(t)) break;
    if (/^Stap\s*\d+\s*:/i.test(t)) break;
    if (tryCallout(t)) break;
    if (/\.\s/.test(t)) break; // sentence-internal periods → prose, not question
    if (t.endsWith("?")) qCount++;
    end++;
    if (end - start > 20) break;
  }
  const count = end - start;
  if (qCount < 3 || count < 4) return null;
  const questions = [];
  let buf = "";
  for (let k = start; k < end; k++) {
    const t = lines[k].trim();
    buf = buf ? buf + " " + t : t;
    if (buf.endsWith("?")) { questions.push(buf); buf = ""; }
  }
  if (buf) questions.push(buf);
  return { type: "questions", items: questions, endIdx: end };
}

function tryQuote(lines, start) {
  const first = lines[start].trim();
  if (!/^[“"]/.test(first)) return null;
  let end = start;
  let buf = "";
  while (end < lines.length) {
    const t = lines[end].trim();
    if (!t) break;
    buf = buf ? buf + " " + t : t;
    end++;
    if (/[”"]/.test(buf.slice(1))) break;
    if (end - start > 14) break;
  }
  const m = /^[“"]([\s\S]*?)[”"]\s*(.*)$/.exec(buf);
  if (!m) return null;
  return {
    type: "quote",
    text: m[1].trim(),
    attribution: m[2].trim().replace(/^[–—\-]\s*/, ""),
    endIdx: end,
  };
}

function tryStep(lines, start) {
  const first = lines[start].trim();
  const m = /^Stap\s*(\d+)\s*:\s*(.*)$/i.exec(first);
  if (!m) return null;
  let end = start + 1;
  const body = [];
  while (end < lines.length) {
    const t = lines[end].trim();
    if (!t) { end++; break; }
    if (/^Stap\s*\d+\s*:/i.test(t)) break;
    if (tryCallout(t)) break;
    body.push(lines[end]);
    end++;
  }
  return {
    type: "step",
    num: m[1],
    title: m[2].trim(),
    body: body.join("\n").trim(),
    endIdx: end,
  };
}

function collectList(lines, start, marker) {
  // marker: 'bullet' | 'numbered'
  const items = [];
  let i = start;
  while (i < lines.length) {
    const cur = lines[i];
    const curT = cur.trim();
    let m;
    if (marker === "bullet") m = /^[•·][\s\t]*(.*)$/.exec(curT);
    else m = /^(\d+)[\.\)][\s\t]*(.*)$/.exec(curT);
    if (!m) break;
    let text = marker === "bullet" ? m[1] : m[2];
    // Continuation lines until next list marker, blank, callout, step, or new block signal.
    let k = i + 1;
    while (k < lines.length) {
      const nxt = lines[k].trim();
      if (!nxt) break;
      if (/^[•·]/.test(nxt)) break;
      if (/^\d+[\.\)]/.test(nxt)) break;
      if (/^Stap\s*\d+\s*:/i.test(nxt)) break;
      if (tryCallout(nxt)) break;
      // New-block signals: a colon-ending line (list/section intro) or an
      // uppercase-starting line that follows a completed sentence (paragraph reset).
      if (/:$/.test(nxt)) break;
      // Stop only after the item has built up a substantial body — short items
      // shouldn't drop their PDF-wrapped continuations just because the next
      // wrap-line happens to start with an uppercase letter.
      if (/^[A-ZÀ-ÿ]/.test(nxt) && /[.!?]\s*$/.test(text) && text.trim().length > 200) break;
      text += " " + nxt;
      k++;
    }
    items.push(text.trim());
    i = k;
  }
  return { items, endIdx: i };
}

function looksLikeQuestionFragmentStart(line) {
  const t = (line || "").trim();
  if (!t) return false;
  if (t.length >= 40) return false;
  if (/[.!?,;:]$/.test(t)) return false;
  if (!/^[A-ZÀ-ÿ]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 5) return false;
  return true;
}

function isSubheaderCandidate(line, nextLine) {
  const t = line.trim();
  if (!t) return false;
  if (t.length >= 80) return false;
  if (/[.!?:]$/.test(t)) return false;
  if (/^[•·]/.test(t)) return false;
  if (/^\d+[\.\)]/.test(t)) return false;
  if (!/^[A-Z]/.test(t)) return false;
  if (/^[A-Z\s\-–&,']+$/.test(t) && t.length > 8) return false; // all-caps run handled elsewhere
  // Avoid catching first line of a question diagram (caught earlier anyway, but safety)
  return true;
}

// Parse a flow region (post-callout-split) into a list of blocks.
function parseFlow(text) {
  const lines = text.split("\n").map(l => l.replace(/\r$/, ""));
  const blocks = [];
  let paraBuf = [];
  const flushPara = () => {
    if (paraBuf.length) {
      blocks.push({ type: "paragraph", text: paraBuf.join(" ").trim() });
      paraBuf = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { flushPara(); i++; continue; }

    // Step marker
    const step = tryStep(lines, i);
    if (step) { flushPara(); blocks.push(step); i = step.endIdx; continue; }

    // Bullet list
    if (/^[•·]/.test(trimmed)) {
      flushPara();
      const { items, endIdx } = collectList(lines, i, "bullet");
      blocks.push({ type: "bullets", items });
      i = endIdx;
      continue;
    }

    // Numbered list
    if (/^\d+[\.\)][\s\t]/.test(trimmed) || /^\d+[\.\)]$/.test(trimmed)) {
      flushPara();
      const { items, endIdx } = collectList(lines, i, "numbered");
      blocks.push({ type: "numbered", items });
      i = endIdx;
      continue;
    }

    // Quote (smart or straight opening)
    const q = tryQuote(lines, i);
    if (q) { flushPara(); blocks.push(q); i = q.endIdx; continue; }

    // Question diagram (PDF-broken multi-line questions). Only attempt when
    // the current line itself looks like a question fragment — avoids running
    // an expensive scan against every prose line.
    if (looksLikeQuestionFragmentStart(trimmed)) {
      const qd = tryQuestionDiagram(lines, i);
      if (qd) { flushPara(); blocks.push(qd); i = qd.endIdx; continue; }
    }

    // Subheader: short capitalized line without trailing punctuation
    if (isSubheaderCandidate(trimmed, lines[i + 1])) {
      flushPara();
      blocks.push({ type: "subheader", text: trimmed });
      i++;
      continue;
    }

    // List/section intro: a line ending with `:`. Treat as its own short
    // paragraph so it visually leads into the following list or block.
    if (/:$/.test(trimmed) && trimmed.length < 140) {
      flushPara();
      blocks.push({ type: "paragraph", text: trimmed });
      i++;
      continue;
    }

    // Default: accumulate into paragraph. Flush at sentence boundary when the
    // next line clearly starts a new conceptual block.
    paraBuf.push(trimmed);
    i++;
    if (/[.!?]\s*$/.test(trimmed)) {
      const nxt = lines[i]?.trim();
      if (nxt) {
        if (/:$/.test(nxt) && nxt.length < 140) { flushPara(); }
        else if (isSubheaderCandidate(nxt, lines[i + 1])) { flushPara(); }
        else if (looksLikeQuestionFragmentStart(nxt)) { flushPara(); }
      }
    }
  }
  flushPara();
  return blocks;
}

// Top-level parse: split on \n\n to find major sections, detect callouts.
function parseBody(text) {
  const sections = text.split(/\n\n+/);
  const out = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const firstLine = trimmed.split("\n", 1)[0];
    const callout = tryCallout(firstLine);
    if (callout) {
      const bodyText = trimmed.split("\n").slice(1).join("\n").trim();
      const innerBlocks = bodyText ? parseFlow(bodyText) : [];
      out.push({ type: "callout", kind: callout.kind, label: callout.label, title: callout.title, blocks: innerBlocks });
    } else {
      out.push(...parseFlow(trimmed));
    }
  }
  return out;
}

// Pick which blocks get inline images. Priority order:
//   1. Question diagrams (almost always visualized)
//   2. TOOLBOX callouts with a framework/matrix in the title
//   3. PRAKTIJKVOORBEELD callouts
//   4. Any remaining TOOLBOX callouts
// Images get assigned to those anchors in source order so that the first
// image lands at the first matching anchor (matches the PDF layout's typical
// top-to-bottom visual flow).
function assignImages(blocks, images) {
  const queue = (images || []).slice();
  const map = new Map();
  if (!queue.length) return map;

  const visualKeywords = /gartner|radar|opportunity|okr|ogsm|raamwerk|matrix|model|kosten|baten|analyse|stappenplan|framework|kwadrant/i;

  const tiers = [
    blocks.map((b, idx) => ({ b, idx })).filter(x => x.b.type === "questions"),
    blocks.map((b, idx) => ({ b, idx })).filter(x => x.b.type === "callout" && visualKeywords.test(x.b.title || "")),
    blocks.map((b, idx) => ({ b, idx })).filter(x => x.b.type === "callout" && x.b.kind === "praktijk"),
    blocks.map((b, idx) => ({ b, idx })).filter(x => x.b.type === "callout" && !map.has(x.idx)),
  ];

  for (const tier of tiers) {
    for (const { idx } of tier) {
      if (!queue.length) break;
      if (map.has(idx)) continue;
      map.set(idx, queue.shift());
    }
    if (!queue.length) break;
  }

  if (queue.length) map.set("__remainder__", queue);
  return map;
}

function renderBlock(block) {
  switch (block.type) {
    case "subheader":
      return el("h5", { class: "rich-subheader" }, block.text);
    case "paragraph":
      return el("p", { class: "rich-p" }, block.text);
    case "bullets": {
      const ul = el("ul", { class: "rich-bullets" });
      for (const item of block.items) ul.appendChild(el("li", {}, item));
      return ul;
    }
    case "numbered": {
      const ol = el("ol", { class: "rich-numbered" });
      for (const item of block.items) ol.appendChild(el("li", {}, item));
      return ol;
    }
    case "step": {
      const wrap = el("div", { class: "rich-step" });
      const head = el("div", { class: "rich-step-head" });
      head.appendChild(el("span", { class: "rich-step-num" }, block.num));
      head.appendChild(el("span", { class: "rich-step-title" }, block.title));
      wrap.appendChild(head);
      if (block.body) {
        const body = el("div", { class: "rich-step-body" });
        for (const b of parseFlow(block.body)) {
          const n = renderBlock(b);
          if (n) body.appendChild(n);
        }
        wrap.appendChild(body);
      }
      return wrap;
    }
    case "quote": {
      const fig = el("figure", { class: "rich-quote" });
      fig.appendChild(el("blockquote", {}, block.text));
      if (block.attribution) fig.appendChild(el("figcaption", {}, "— " + block.attribution));
      return fig;
    }
    case "questions": {
      const grid = el("div", { class: "rich-questions" });
      for (const q of block.items) {
        grid.appendChild(el("div", { class: "rich-question-card" }, q));
      }
      return grid;
    }
    case "callout": {
      const c = el("section", { class: `rich-callout rich-callout--${block.kind}` });
      const head = el("header", { class: "rich-callout-head" });
      head.appendChild(el("span", { class: "rich-callout-label" }, block.label));
      head.appendChild(el("h5", { class: "rich-callout-title" }, block.title));
      c.appendChild(head);
      const body = el("div", { class: "rich-callout-body" });
      for (const b of block.blocks) {
        const n = renderBlock(b);
        if (n) body.appendChild(n);
      }
      c.appendChild(body);
      return c;
    }
    default:
      return null;
  }
}

function figureFor(imgName, alt) {
  const fig = el("figure", { class: "rich-figure" });
  fig.appendChild(el("img", { src: `img/${imgName}`, alt, loading: "lazy" }));
  return fig;
}

export function formatActivityBody(rawText, images, activity) {
  const container = el("div", { class: "activity-body-rich" });
  if (!rawText) return container;

  const stripped = stripActivityHeader(rawText, activity);
  const blocks = parseBody(stripped);
  const imageMap = assignImages(blocks, images || []);
  const altBase = activity?.title ? `Figuur — ${activity.title}` : "Figuur uit playbook";

  blocks.forEach((b, idx) => {
    const node = renderBlock(b);
    if (node) container.appendChild(node);
    const img = imageMap.get(idx);
    if (img) {
      // Inject the figure inside the callout body when applicable; else append after.
      if (b.type === "callout" && node) {
        const body = node.querySelector(".rich-callout-body");
        if (body) body.appendChild(figureFor(img, altBase));
        else container.appendChild(figureFor(img, altBase));
      } else {
        container.appendChild(figureFor(img, altBase));
      }
    }
  });

  const leftovers = imageMap.get("__remainder__");
  if (leftovers && leftovers.length) {
    const extra = el("div", { class: "rich-figure-extra" });
    extra.appendChild(el("div", { class: "rich-figure-extra-label" }, "Aanvullende figuren uit het playbook"));
    for (const img of leftovers) extra.appendChild(figureFor(img, altBase));
    container.appendChild(extra);
  }

  return container;
}
