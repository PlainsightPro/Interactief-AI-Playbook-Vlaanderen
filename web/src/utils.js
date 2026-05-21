// Generic helpers: DOM, storage, event-delegation, debounce.

export const $ = (sel, ctx = document) => ctx.querySelector(sel);
export const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

// Create an element with attributes + children. Children can be strings, nodes, or null/undefined (skipped).
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class" || k === "className") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset" && typeof v === "object") for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (k === "html") node.innerHTML = v;
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
  return node;
}

export function svg(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstChild;
}

// Storage helpers — graceful when localStorage is blocked (private mode / Safari ITP).
const STORAGE_PREFIX = "ai-playbook-vl:";
export const storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(STORAGE_PREFIX + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(STORAGE_PREFIX + key); } catch {} },
};

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// HTML-escape (use whenever data goes into innerHTML — paranoia level high since PDF text can have stray characters).
export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Trim text to N chars at the nearest space.
export function truncate(str, n = 220) {
  if (!str) return "";
  if (str.length <= n) return str;
  const cut = str.slice(0, n);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

// IntersectionObserver-based reveal. Safe to call multiple times — the observer
// is cached so late-added `.reveal` elements (e.g. rendered after an async fetch)
// can be picked up by re-invoking initReveal().
let revealObserver = null;
export function initReveal(rootSelector = ".reveal") {
  if (typeof IntersectionObserver === "undefined") return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { $$(rootSelector).forEach(e => e.classList.add("is-visible")); return; }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -50px 0px", threshold: 0.05 });
  }
  $$(rootSelector).forEach(e => revealObserver.observe(e));
}

// Build a hash route util (e.g. #/section/1-1-2 -> {section: "1-1-2"}).
export function parseHash() {
  const h = (location.hash || "").replace(/^#\/?/, "");
  if (!h) return { route: "", params: {} };
  const [route, ...rest] = h.split("/");
  return { route, params: { id: rest.join("/") } };
}

// Read query params.
export function queryParam(name) {
  return new URLSearchParams(location.search).get(name);
}
