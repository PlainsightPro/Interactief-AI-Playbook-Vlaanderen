#!/usr/bin/env node
// Generate 2-4 sentence Dutch summaries for every section in playbook.json
// via OpenRouter. Output: data/summaries.json keyed by section id.
//
// Usage:
//   1) Rotate your OpenRouter key, then create a .env file in project root:
//        OPENROUTER_API_KEY=sk-or-v1-...
//   2) Run: node scripts/generate_summaries.mjs
//
// Re-running picks up only missing summaries (idempotent).

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const PLAYBOOK = path.join(DATA, "playbook.json");
const OUT = path.join(DATA, "summaries.json");

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("Missing OPENROUTER_API_KEY. Create a .env in the project root.");
  process.exit(1);
}
const MODEL = process.env.MODEL || "google/gemini-3.1-flash-lite";

const playbook = JSON.parse(fs.readFileSync(PLAYBOOK, "utf-8"));
const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf-8")) : {};

function flatten(nodes, acc = []) {
  for (const n of nodes) {
    acc.push(n);
    if (n.children) flatten(n.children, acc);
  }
  return acc;
}
const all = flatten(playbook.pillars);
const todo = all.filter((s) => !existing[s.id] && (s.own_text || s.full_text));

console.log(`Sections total: ${all.length}, already summarized: ${Object.keys(existing).length}, to do: ${todo.length}`);

const SYSTEM = `Je bent een redacteur die secties uit het AI Playbook (Digitaal Vlaanderen) samenvat.
Schrijf in helder, professioneel Nederlands. Output: 2 tot 4 zinnen, geen bullet points, geen kopjes, geen herhaling van de titel. Geef de essentie en het concrete eindproduct van de activiteit. Begin niet met "Deze sectie..." of "In deze activiteit...".`;

async function summarize(section, attempt = 1) {
  const text = (section.own_text || section.full_text || "").slice(0, 5000);
  const user = `Titel: ${section.title}\nPad: ${(section.path || []).join(" › ")}\n\nTekst:\n${text}`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://plainsightpro.github.io/ai-playbook-viewer/",
      "X-Title": "AI Playbook Summary Generator",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: 220,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      const wait = 2000 * attempt;
      console.warn(`  retry in ${wait}ms (status ${res.status})`);
      await new Promise((r) => setTimeout(r, wait));
      return summarize(section, attempt + 1);
    }
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

const out = { ...existing };
let i = 0;
for (const s of todo) {
  i++;
  process.stdout.write(`[${i}/${todo.length}] § ${s.number || s.id} ${s.title}… `);
  try {
    const summary = await summarize(s);
    out[s.id] = summary;
    console.log(`✓ ${summary.length} chars`);
    if (i % 5 === 0) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(`✗ ${err.message}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\nWrote ${OUT} with ${Object.keys(out).length} summaries.`);
