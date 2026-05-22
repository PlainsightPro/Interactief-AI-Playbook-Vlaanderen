/* eslint-disable */
// AI Playbook Viewer — main app
// - Loads playbook.json + summaries.json
// - Hash routing: #/, #/p/<num>, #/a/<id>, #/search
// - Profile filter (highlight)
// - Chat panel with streaming, context-pinning, localStorage history
// - Cmd/Ctrl-K search modal: keyword (Fuse.js) + ask-the-whole-playbook AI mode
// - Text-selection ask tooltip

const CFG = window.AI_PLAYBOOK_CONFIG || {};
const IS_PROXY_CONFIGURED =
  CFG.SUPABASE_URL &&
  !/YOUR_PROJECT/i.test(CFG.SUPABASE_URL) &&
  CFG.SUPABASE_ANON_KEY &&
  !/YOUR_ANON_KEY/i.test(CFG.SUPABASE_ANON_KEY);

const STORAGE_KEYS = {
  profile: "ai-playbook:profile",
  chatPanel: "ai-playbook:chat-panel",
  chatHistory: "ai-playbook:chat-history",
  summaries: "ai-playbook:summary-cache",
};

const SUGGESTIONS = [
  "Vat samen in 3 zinnen",
  "Voor wie is dit relevant?",
  "Geef een praktijkvoorbeeld",
  "Wat is het eindproduct?",
];

const PHASE_BADGE = {
  1: "Verkennen",
  2: "Keuzes maken",
  3: "Capaciteiten ontwikkelen",
  4: "Implementeren",
  5: "Evalueren & opschalen",
};

const state = {
  playbook: null,
  summaries: {},
  summaryCache: {},
  byId: new Map(),
  byNumber: new Map(),
  flatList: [],
  fuse: null,
  profile: localStorage.getItem(STORAGE_KEYS.profile) || "",
  currentRoute: null,
  pinnedContext: null,
  chatHistoryByKey: loadJSON(STORAGE_KEYS.chatHistory, {}),
  isStreaming: false,
};

// ===== Utilities ==========================================

function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset")
      Object.entries(v).forEach(([dk, dv]) => (node.dataset[dk] = dv));
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
function escapeHTML(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
function toast(message, tone = "info") {
  const host = document.getElementById("toastHost");
  if (!host) return;
  const t = el("div", { class: "toast", dataset: { tone } }, message);
  host.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// Tiny safe markdown for chat responses (bold, italic, lists, code, links).
function renderMarkdown(text) {
  let s = escapeHTML(text);
  // Inline code
  s = s.replace(/`([^`]+?)`/g, "<code>$1</code>");
  // Bold + italic
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  // Bullets
  s = s.replace(/(^|\n)- (.+)/g, "$1<li>$2</li>");
  if (s.includes("<li>")) s = s.replace(/((?:<li>.*?<\/li>\s*)+)/gs, "<ul>$1</ul>");
  // Paragraphs
  s = s
    .split(/\n{2,}/)
    .map((p) => (p.startsWith("<ul>") || p.startsWith("<li>") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`))
    .join("");
  return s;
}

function makeSummary(section) {
  if (state.summaries[section.id]) return state.summaries[section.id];
  if (state.summaryCache[section.id]) return state.summaryCache[section.id];
  const titleNorm = (section.title || "").trim().toLowerCase();
  const cleanText = (raw) => {
    if (!raw) return "";
    const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let i = 0;
    // Drop leading "header-like" lines: short, mostly caps, matching labels, or repeating the section title
    while (i < lines.length) {
      const l = lines[i];
      const isShort = l.length < 60;
      const isMostlyCaps = /[A-Z]/.test(l) && l.replace(/[^A-Za-z]/g, "").length > 0 &&
        l.replace(/[^A-Z]/g, "").length / l.replace(/[^A-Za-z]/g, "").length > 0.6;
      const isLabel = /^(Introductie|Inleiding|Overzicht|Eindproduct)\s*$/i.test(l);
      const isNumber = /^\d+(\.\d+)*\s*\.?\s*$/.test(l);
      const isNumberedHeader = /^\d+(\.\d+)*[.\s]*[A-Za-z][A-Za-z\s\-&,]*$/.test(l) && l.length < 80;
      const isTitleRepeat = titleNorm && l.toLowerCase() === titleNorm;
      if (isShort && (isMostlyCaps || isLabel || isNumber || isNumberedHeader || isTitleRepeat)) {
        i++;
        continue;
      }
      if (isTitleRepeat) {
        i++;
        continue;
      }
      break;
    }
    return lines.slice(i).join(" ").trim();
  };
  let txt = cleanText(section.own_text);
  if (txt.length < 80 && section.full_text) txt = cleanText(section.full_text);
  if (txt.length < 80 && section.children?.length) {
    const firstChild = section.children[0];
    txt = cleanText(firstChild.own_text || firstChild.full_text);
  }
  let excerpt = txt.slice(0, 320);
  if (excerpt.length === 320) excerpt += "…";
  return excerpt || "Geen beschrijving beschikbaar.";
}

function flattenSections(nodes, parent = null, acc = []) {
  for (const node of nodes) {
    node.parent = parent;
    acc.push(node);
    state.byId.set(node.id, node);
    if (node.number) state.byNumber.set(node.number, node);
    if (node.children?.length) flattenSections(node.children, node, acc);
  }
  return acc;
}

function pillarForNode(node) {
  let cur = node;
  while (cur) {
    if (cur.level === 1) return cur;
    cur = cur.parent;
  }
  return null;
}

function findActivityForSection(node) {
  // Walks up to the closest non-pillar ancestor with level === 2 (an "activity group")
  let cur = node;
  while (cur && cur.level > 2) cur = cur.parent;
  return cur;
}

// ===== Boot ===============================================

async function boot() {
  state.summaryCache = loadJSON(STORAGE_KEYS.summaries, {});
  try {
    const [playbook, summaries] = await Promise.all([
      fetch("data/playbook.json").then((r) => r.json()),
      fetch("data/summaries.json").then((r) => r.json()).catch(() => ({})),
    ]);
    state.playbook = playbook;
    state.summaries = summaries || {};
  } catch (err) {
    console.error(err);
    document.getElementById("content").innerHTML =
      '<div class="content-loader"><p>Kon de playbook-gegevens niet laden.</p></div>';
    return;
  }

  state.flatList = flattenSections(state.playbook.pillars);
  buildFuseIndex();
  initProfile();
  initChat();
  initSearch();
  initSelectionTooltip();
  initRouting();
  initChatPanelControls();
  window.addEventListener("hashchange", renderRoute);
  renderRoute();
}

function buildFuseIndex() {
  const items = state.flatList.map((s) => ({
    id: s.id,
    number: s.number || "",
    title: s.title,
    text: (s.own_text || "").slice(0, 4000),
    path: (s.path || []).join(" › "),
  }));
  state.fuse = new Fuse(items, {
    includeMatches: true,
    keys: [
      { name: "title", weight: 0.55 },
      { name: "number", weight: 0.15 },
      { name: "path", weight: 0.1 },
      { name: "text", weight: 0.2 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
}

// ===== Profile ============================================

function initProfile() {
  document.body.dataset.profile = state.profile;
  document.querySelectorAll(".profile-pill").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.profile === state.profile);
    btn.addEventListener("click", () => setProfile(btn.dataset.profile));
  });
}
function setProfile(p) {
  state.profile = p || "";
  localStorage.setItem(STORAGE_KEYS.profile, state.profile);
  document.body.dataset.profile = state.profile;
  document.querySelectorAll(".profile-pill").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.profile === state.profile);
  });
  renderRoute();
}
function isRelevant(section) {
  if (!state.profile) return false;
  if (section.profiles?.includes(state.profile)) return true;
  // A pillar/group is relevant if any descendant matches the profile
  const stack = [...(section.children || [])];
  while (stack.length) {
    const c = stack.pop();
    if (c.profiles?.includes(state.profile)) return true;
    if (c.children) stack.push(...c.children);
  }
  return false;
}
function phaseFor(section) {
  if (!state.profile) return null;
  return section.phase_by_profile?.[state.profile] || null;
}

// ===== Routing ============================================

function initRouting() {
  if (!location.hash) location.hash = "#/";
}
function parseRoute() {
  const h = location.hash.slice(1) || "/";
  const parts = h.split("/").filter(Boolean);
  if (parts.length === 0) return { kind: "home" };
  if (parts[0] === "p" && parts[1]) return { kind: "pillar", id: parts[1] };
  if (parts[0] === "a" && parts[1]) return { kind: "activity", id: parts[1] };
  if (parts[0] === "gallery") return { kind: "gallery" };
  return { kind: "home" };
}

function renderRoute() {
  state.currentRoute = parseRoute();
  const content = document.getElementById("content");
  content.scrollTop = 0;
  clear(content);
  switch (state.currentRoute.kind) {
    case "home":
      renderHome(content);
      break;
    case "pillar":
      renderPillar(content, state.currentRoute.id);
      break;
    case "activity":
      renderActivity(content, state.currentRoute.id);
      break;
    case "gallery":
      renderGallery(content);
      break;
  }
  content.focus({ preventScroll: true });
}

// ===== Home ===============================================

function renderHome(root) {
  const { meta, pillars } = state.playbook;
  const totalActivities = state.flatList.filter((s) => s.level >= 2).length;

  root.appendChild(
    el("section", { class: "hero" },
      el("h1", { text: meta.title }),
      el("p", { text: "Een interactieve gids door alle kernactiviteiten — verken via pijlers, filter op profiel, en stel direct vragen aan de AI-assistent over wat je leest." }),
      el("div", { class: "hero-meta" },
        el("span", { text: `${pillars.length} pijlers` }),
        el("span", { text: `${totalActivities} activiteiten` }),
        el("span", { text: `${meta.pages} pagina's` }),
        el("span", { text: meta.subtitle }),
      ),
    ),
  );

  // Profile roadmap (if profile selected)
  if (state.profile && meta.stappenplan_images?.[state.profile]) {
    const profileLabel = meta.profiles[state.profile];
    root.appendChild(
      el("section", { class: "profile-roadmap" },
        el("h2", { text: `Stappenplan voor de ${profileLabel}` }),
        el("p", { text: "Originele matrix uit de PDF: activiteiten gemapt op de 5 fasen.", style: "color: var(--text-muted); margin: 0 0 12px;" }),
        el("div", { class: "profile-roadmap-image" },
          el("img", {
            src: `img/${meta.stappenplan_images[state.profile]}`,
            alt: `Stappenplan ${profileLabel}`,
            loading: "lazy",
          }),
        ),
      ),
    );
  }

  // Pillar grid
  root.appendChild(
    el("div", { class: "section-title" },
      el("h2", { text: "De 5 pijlers" }),
      el("span", { class: "count", text: state.profile ? `Highlighted voor: ${meta.profiles[state.profile]}` : "Selecteer een profiel om relevantie te markeren" }),
    ),
  );

  const grid = el("div", { class: "pillar-grid" });
  for (const pillar of pillars) {
    const summary = makeSummary(pillar);
    const card = el("a", {
      class: "pillar-card",
      href: `#/p/${pillar.id}`,
      dataset: { relevant: isRelevant(pillar) ? "true" : "false", pillar: pillar.id },
    },
      el("div", { class: "pillar-number", text: pillar.number?.padStart(2, "0") || "" }),
      el("h3", { text: pillar.title }),
      el("p", { text: summary }),
      el("div", { class: "pillar-meta" },
        el("span", { text: `${pillar.children?.length || 0} hoofdactiviteiten` }),
        el("span", { class: "arrow", text: "Verken →" }),
      ),
    );
    grid.appendChild(card);
  }
  root.appendChild(grid);

  // Optional: visual gallery link
  if (state.playbook.meta.image_count > 4) {
    root.appendChild(
      el("div", { class: "section-title", style: "margin-top: 36px;" },
        el("h2", { text: "Visueel overzicht" }),
        el("span", { class: "count", text: `${state.playbook.meta.image_count} afbeeldingen uit de PDF` }),
      ),
    );
    root.appendChild(
      el("p", {},
        el("a", { href: "#/gallery", text: "Bekijk alle figuren uit de Playbook →" }),
      ),
    );
  }
}

// ===== Pillar detail ======================================

function renderPillar(root, id) {
  const pillar = state.byId.get(id) || state.byNumber.get(id);
  if (!pillar) return renderNotFound(root);

  root.appendChild(renderBreadcrumbs([{ href: "#/", text: "Home" }, { text: pillar.title }]));

  root.appendChild(
    el("section", { class: "pillar-header" },
      el("div", { class: "pillar-number", text: pillar.number?.padStart(2, "0") },),
      el("div", {},
        el("h1", { text: pillar.title }),
        el("p", { text: makeSummary(pillar) }),
      ),
      el("div", { class: "pillar-header-cta" },
        askButton(pillar, { large: true, label: "Vraag AI over deze pijler" }),
      ),
    ),
  );

  if (pillar.images?.length) {
    const imgGrid = el("div", { class: "images-grid" });
    pillar.images.forEach((src) => {
      imgGrid.appendChild(
        el("figure", {},
          el("img", { src: `img/${src}`, alt: pillar.title, loading: "lazy", onclick: () => openLightbox(`img/${src}`) }),
        ),
      );
    });
    root.appendChild(imgGrid);
  }

  root.appendChild(
    el("div", { class: "section-title" },
      el("h2", { text: "Activiteiten" }),
      el("span", { class: "count", text: `${pillar.children?.length || 0} hoofdgroepen` }),
    ),
  );

  const list = el("div", { class: "activity-list" });
  for (const child of pillar.children || []) {
    list.appendChild(renderActivityCard(child));
  }
  root.appendChild(list);
}

function renderActivityCard(activity) {
  const phase = phaseFor(activity);
  const relevant = isRelevant(activity);
  return el("article", {
    class: "activity-card",
    dataset: { relevant: relevant ? "true" : "false" },
  },
    el("div", { class: "activity-num", text: activity.number || "—" }),
    el("div", { class: "activity-body" },
      el("h3", {},
        el("a", { href: `#/a/${activity.id}`, text: activity.title }),
      ),
      el("p", { text: makeSummary(activity) }),
    ),
    el("div", { class: "activity-meta" },
      phase ? el("span", { class: "phase-badge", dataset: { phase: String(phase) }, text: PHASE_BADGE[phase] }) : null,
      askButton(activity, { compact: true }),
    ),
  );
}

// ===== Activity detail ====================================

function renderActivity(root, id) {
  const activity = state.byId.get(id) || state.byNumber.get(id);
  if (!activity) return renderNotFound(root);

  const pillar = pillarForNode(activity);
  const crumbs = [{ href: "#/", text: "Home" }];
  if (pillar) crumbs.push({ href: `#/p/${pillar.id}`, text: pillar.title });
  if (activity.parent && activity.parent !== pillar) crumbs.push({ href: `#/a/${activity.parent.id}`, text: activity.parent.title });
  crumbs.push({ text: activity.title });
  root.appendChild(renderBreadcrumbs(crumbs));

  const detail = el("article", { class: "activity-detail" });
  detail.appendChild(
    el("div", { class: "title-meta" },
      activity.number ? el("span", { class: "pill", text: `§ ${activity.number}` }) : null,
      ...(activity.profiles || []).map((p) => el("span", { class: "pill", text: state.playbook.meta.profiles[p] || p })),
      phaseFor(activity) ? el("span", { class: "phase-badge", dataset: { phase: String(phaseFor(activity)) }, text: PHASE_BADGE[phaseFor(activity)] }) : null,
    ),
  );
  detail.appendChild(el("h1", { text: activity.title }));
  detail.appendChild(el("div", { class: "activity-summary", text: makeSummary(activity) }));
  detail.appendChild(askButton(activity, { large: true, label: "Vraag AI over deze sectie" }));

  if (activity.images?.length) {
    const imgGrid = el("div", { class: "images-grid" });
    activity.images.forEach((src) => {
      imgGrid.appendChild(
        el("figure", {},
          el("img", { src: `img/${src}`, alt: activity.title, loading: "lazy", onclick: () => openLightbox(`img/${src}`) }),
        ),
      );
    });
    detail.appendChild(imgGrid);
  }

  // Original PDF text (collapsed by default)
  if (activity.own_text) {
    detail.appendChild(
      el("details", { class: "original-toggle" },
        el("summary", { text: "Toon originele tekst uit de PDF" }),
        el("div", { class: "original-text selectable", dataset: { sectionId: activity.id }, text: activity.own_text }),
      ),
    );
  }

  root.appendChild(detail);

  if (activity.children?.length) {
    root.appendChild(
      el("section", { class: "children-list" },
        el("div", { class: "section-title" },
          el("h2", { text: "Subactiviteiten" }),
          el("span", { class: "count", text: `${activity.children.length} onderdelen` }),
        ),
        ...activity.children.map(renderActivityCard),
      ),
    );
  }
}

function renderBreadcrumbs(items) {
  const c = el("nav", { class: "crumbs", "aria-label": "Kruimelpad" });
  items.forEach((it, i) => {
    if (i > 0) c.appendChild(el("span", { class: "sep" }));
    if (it.href) c.appendChild(el("a", { href: it.href, text: it.text }));
    else c.appendChild(el("span", { text: it.text }));
  });
  return c;
}

function renderNotFound(root) {
  root.appendChild(renderBreadcrumbs([{ href: "#/", text: "Home" }, { text: "Niet gevonden" }]));
  root.appendChild(el("p", { text: "Deze sectie bestaat niet. Ga terug naar de startpagina." }));
}

function renderGallery(root) {
  root.appendChild(renderBreadcrumbs([{ href: "#/", text: "Home" }, { text: "Visueel overzicht" }]));
  root.appendChild(el("h1", { text: "Visueel overzicht" }));
  const all = [];
  const visit = (nodes) => {
    for (const n of nodes) {
      (n.images || []).forEach((src) => all.push({ src, owner: n }));
      if (n.children) visit(n.children);
    }
  };
  visit(state.playbook.pillars);
  const seen = new Set();
  const unique = all.filter((x) => (seen.has(x.src) ? false : (seen.add(x.src), true)));
  const grid = el("div", { class: "images-grid" });
  unique.forEach(({ src, owner }) => {
    grid.appendChild(
      el("figure", {},
        el("img", { src: `img/${src}`, alt: owner.title, loading: "lazy", onclick: () => openLightbox(`img/${src}`) }),
        el("figcaption", { style: "font-size: 11px; color: var(--c-muted-blue); padding: 4px 8px;", text: `${owner.number || ""} ${owner.title}` }),
      ),
    );
  });
  root.appendChild(grid);
}

function openLightbox(src) {
  const lb = el("div", { class: "image-lightbox", onclick: (e) => { if (e.target === lb || e.target.classList.contains("close")) lb.remove(); } },
    el("button", { class: "close", text: "✕", "aria-label": "Sluit" }),
    el("img", { src, alt: "" }),
  );
  document.body.appendChild(lb);
}

// ===== Ask button & context pinning =======================

function askButton(section, { large = false, compact = false, label } = {}) {
  const btn = el("button", {
    class: large ? "ask-large" : compact ? "ask-btn" : "ask-btn",
    type: "button",
    title: "Pin als context voor de AI-assistent",
  },
    el("span", { html: '<svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px;margin-right:4px"><path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>' }),
    label || "Vraag AI",
  );
  btn.addEventListener("click", () => pinContext(section));
  return btn;
}

function pinContext(section, customLabel = null) {
  state.pinnedContext = {
    key: section.id || `selection-${Date.now()}`,
    title: customLabel || section.title,
    path: (section.path || []),
    text: section.own_text || section.full_text || section.text || "",
    number: section.number,
    isSelection: !!customLabel,
  };
  updateChatHeader();
  renderChatHistory();
  openChatPanel();
}

function updateChatHeader() {
  const label = document.getElementById("chatContextLabel");
  if (!state.pinnedContext) {
    label.innerHTML = '<span class="context-empty">Geen context — vraag iets over de hele playbook.</span>';
    label.classList.remove("has-context");
    renderSuggestions(null);
    return;
  }
  label.classList.add("has-context");
  const prefix = state.pinnedContext.number ? `§${state.pinnedContext.number} ` : "";
  label.textContent = `Gepind: ${prefix}${state.pinnedContext.title}`;
  renderSuggestions(state.pinnedContext);
}

function renderSuggestions(context) {
  const host = document.getElementById("chatSuggestions");
  clear(host);
  if (!context) return;
  for (const s of SUGGESTIONS) {
    const chip = el("button", { class: "chat-suggestion", type: "button", text: s });
    chip.addEventListener("click", () => {
      document.getElementById("chatInput").value = s;
      document.getElementById("chatForm").dispatchEvent(new Event("submit", { cancelable: true }));
    });
    host.appendChild(chip);
  }
}

// ===== Chat panel =========================================

function initChatPanelControls() {
  const saved = localStorage.getItem(STORAGE_KEYS.chatPanel) || (window.matchMedia("(max-width: 1024px)").matches ? "collapsed" : "open");
  document.body.dataset.chat = saved;
  document.getElementById("chatCollapse").addEventListener("click", toggleChatPanel);
  document.getElementById("chatToggle").addEventListener("click", openChatPanel);
  document.getElementById("chatFab").addEventListener("click", openChatPanel);
}
function toggleChatPanel() {
  const next = document.body.dataset.chat === "open" ? "collapsed" : "open";
  document.body.dataset.chat = next;
  localStorage.setItem(STORAGE_KEYS.chatPanel, next);
}
function openChatPanel() {
  document.body.dataset.chat = "open";
  localStorage.setItem(STORAGE_KEYS.chatPanel, "open");
}

function initChat() {
  document.getElementById("chatForm").addEventListener("submit", onChatSubmit);
  document.getElementById("chatClear").addEventListener("click", () => {
    const k = chatKey();
    delete state.chatHistoryByKey[k];
    saveJSON(STORAGE_KEYS.chatHistory, state.chatHistoryByKey);
    renderChatHistory();
  });
  const input = document.getElementById("chatInput");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("chatForm").dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(160, input.scrollHeight) + "px";
  });
  renderChatHistory();
}

function chatKey() {
  return state.pinnedContext ? state.pinnedContext.key : "__global__";
}

function renderChatHistory() {
  const host = document.getElementById("chatHistory");
  clear(host);
  const k = chatKey();
  const history = state.chatHistoryByKey[k] || [];
  if (history.length === 0) {
    host.appendChild(
      el("div", { class: "chat-welcome" },
        el("h3", { text: state.pinnedContext ? `Praat over: ${state.pinnedContext.title}` : "Hoe werkt dit?" }),
        el("p", { text: state.pinnedContext
          ? "Kies een suggestie hierboven of typ je eigen vraag. Antwoorden zijn gebaseerd op de tekst van deze sectie."
          : "Selecteer een pijler of activiteit en klik op Vraag AI om gericht door te vragen. Of stel hier een algemene vraag over de hele Playbook." }),
      ),
    );
    if (!state.pinnedContext) {
      // Global suggestions
      const suggs = ["Wat zijn de 5 pijlers?", "Welk profiel past bij een beginnende organisatie?", "Wat moet ik eerst doen voor EU AI Act compliance?", "Hoe meet ik AI-succes?"];
      const wrap = el("div", { style: "display:flex; flex-wrap:wrap; gap:6px; margin-top:10px;" });
      for (const s of suggs) {
        const chip = el("button", { class: "chat-suggestion", type: "button", text: s });
        chip.addEventListener("click", () => {
          document.getElementById("chatInput").value = s;
          document.getElementById("chatForm").dispatchEvent(new Event("submit", { cancelable: true }));
        });
        wrap.appendChild(chip);
      }
      host.appendChild(wrap);
    }
    return;
  }
  for (const msg of history) {
    host.appendChild(renderMsgBubble(msg));
  }
  host.scrollTop = host.scrollHeight;
}

function renderMsgBubble(msg) {
  return el("div", { class: `chat-msg chat-msg-${msg.role}` },
    el("div", { class: "chat-msg-role", text: msg.role === "user" ? "Jij" : "AI" }),
    el("div", { class: "chat-msg-bubble", html: renderMarkdown(msg.content) }),
  );
}

function pushMessage(role, content) {
  const k = chatKey();
  if (!state.chatHistoryByKey[k]) state.chatHistoryByKey[k] = [];
  state.chatHistoryByKey[k].push({ role, content });
  saveJSON(STORAGE_KEYS.chatHistory, state.chatHistoryByKey);
}

async function onChatSubmit(e) {
  e.preventDefault();
  if (state.isStreaming) return;
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";
  pushMessage("user", text);
  renderChatHistory();

  if (!IS_PROXY_CONFIGURED) {
    pushMessage("assistant", "_De Supabase-proxy is nog niet geconfigureerd._ Open `config.js` en vul je Supabase URL + anon key in. Zie de README voor stappen.");
    renderChatHistory();
    return;
  }

  const history = state.chatHistoryByKey[chatKey()] || [];
  await streamChat(history);
}

async function streamChat(history) {
  state.isStreaming = true;
  document.getElementById("chatSend").disabled = true;
  const host = document.getElementById("chatHistory");
  const bubble = el("div", { class: "chat-msg chat-msg-assistant" },
    el("div", { class: "chat-msg-role", text: "AI" }),
    el("div", { class: "chat-msg-bubble streaming" }),
  );
  host.appendChild(bubble);
  host.scrollTop = host.scrollHeight;
  const target = bubble.querySelector(".chat-msg-bubble");

  const payload = {
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    model: CFG.MODEL,
    mode: state.pinnedContext ? (state.pinnedContext.isSelection ? "selection" : "section") : "global",
    context: state.pinnedContext
      ? {
          title: state.pinnedContext.title,
          path: state.pinnedContext.path,
          text: state.pinnedContext.text?.slice(0, 8000),
        }
      : (state.currentRoute?.kind === "home" ? null : null),
  };

  let acc = "";
  try {
    const url = `${CFG.SUPABASE_URL.replace(/\/$/, "")}${CFG.CHAT_FUNCTION_PATH}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CFG.SUPABASE_ANON_KEY}`,
        "apikey": CFG.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const obj = JSON.parse(data);
          const delta = obj.choices?.[0]?.delta?.content || obj.choices?.[0]?.message?.content || "";
          if (delta) {
            acc += delta;
            target.innerHTML = renderMarkdown(acc);
            host.scrollTop = host.scrollHeight;
          }
        } catch {}
      }
    }
  } catch (err) {
    acc = `_Fout bij ophalen van antwoord:_ ${escapeHTML(err.message || err)}`;
    target.innerHTML = renderMarkdown(acc);
    toast("Kon AI-antwoord niet ophalen", "error");
  } finally {
    target.classList.remove("streaming");
    if (acc) pushMessage("assistant", acc);
    state.isStreaming = false;
    document.getElementById("chatSend").disabled = false;
  }
}

// ===== Search modal =======================================

function initSearch() {
  const trigger = document.getElementById("searchTrigger");
  const modal = document.getElementById("searchModal");
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  const closeBtn = document.getElementById("searchClose");

  const modeButtons = modal.querySelectorAll(".search-mode button");
  let mode = "keyword";

  const openModal = () => {
    modal.showModal();
    setTimeout(() => input.focus(), 30);
  };
  const closeModal = () => {
    modal.close();
    input.value = "";
    clear(results);
  };

  trigger.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openModal();
    } else if (e.key === "Escape" && modal.open) {
      closeModal();
    }
  });

  modeButtons.forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      modeButtons.forEach((x) => x.classList.toggle("is-active", x === b));
      input.placeholder = mode === "ai" ? "Stel een vraag over de hele Playbook…" : "Zoek op trefwoord, activiteit of sectienummer…";
      clear(results);
      if (mode === "ai") {
        results.appendChild(el("div", { class: "search-ai-answer" },
          el("p", { style: "color: var(--c-muted-blue); margin:0;", text: "Tik je vraag in en druk Enter. Het antwoord verschijnt hieronder. Werkt alleen als de Supabase-proxy ingesteld is." }),
        ));
      }
    }),
  );

  const onTyped = debounce(() => {
    if (mode === "keyword") renderKeywordResults(input.value, results);
  }, 120);
  input.addEventListener("input", onTyped);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (mode === "keyword") {
        const first = results.querySelector(".search-result");
        if (first) first.click();
      } else {
        runAISearch(input.value, results);
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = [...results.querySelectorAll(".search-result")];
      if (!items.length) return;
      const active = results.querySelector(".search-result.is-active");
      const idx = items.indexOf(active);
      const next = e.key === "ArrowDown" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
      items.forEach((x, i) => x.classList.toggle("is-active", i === next));
      items[next].scrollIntoView({ block: "nearest" });
      e.preventDefault();
    }
  });

  results.addEventListener("click", (e) => {
    const el = e.target.closest(".search-result");
    if (!el) return;
    location.hash = el.dataset.href;
    closeModal();
  });
}

function renderKeywordResults(query, host) {
  clear(host);
  if (!query.trim()) return;
  const hits = state.fuse.search(query, { limit: 30 });
  if (hits.length === 0) {
    host.appendChild(el("div", { style: "padding:20px; text-align:center; color:var(--c-muted-blue);", text: "Geen resultaten." }));
    return;
  }
  hits.forEach((hit, i) => {
    const s = state.byId.get(hit.item.id);
    if (!s) return;
    const snippet = buildSnippet(s.own_text || "", query);
    host.appendChild(
      el("div", { class: "search-result" + (i === 0 ? " is-active" : ""), dataset: { href: `#/a/${s.id}` } },
        el("div", {},
          s.number ? el("span", { class: "num", text: `§ ${s.number}` }) : null,
          el("span", { class: "title", text: s.title }),
        ),
        el("div", { class: "crumbs", text: (s.path || []).slice(0, -1).join(" › ") }),
        snippet ? el("div", { class: "snippet", html: snippet }) : null,
      ),
    );
  });
}

function buildSnippet(text, query) {
  if (!text) return "";
  const lower = text.toLowerCase();
  const q = query.toLowerCase().split(/\s+/).filter(Boolean)[0];
  if (!q) return escapeHTML(text.slice(0, 180));
  const idx = lower.indexOf(q);
  if (idx < 0) return escapeHTML(text.slice(0, 180));
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + 140);
  let frag = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  frag = escapeHTML(frag);
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return frag.replace(re, "<mark>$1</mark>");
}

async function runAISearch(question, host) {
  if (!question.trim()) return;
  clear(host);
  const answerBox = el("div", { class: "search-ai-answer" },
    el("p", { style: "font-family: var(--font-display); color: var(--primary); font-weight: 600;", text: question }),
    el("div", { class: "ai-stream", html: '<span style="color: var(--c-muted-blue)">Aan het nadenken…</span>' }),
  );
  host.appendChild(answerBox);
  const target = answerBox.querySelector(".ai-stream");

  if (!IS_PROXY_CONFIGURED) {
    target.innerHTML = '<em>De Supabase-proxy is nog niet geconfigureerd. Vul config.js in om AI-search te activeren.</em>';
    return;
  }

  // Build a global context: just titles + first sentences of all sections (kept small).
  const global = state.flatList
    .filter((s) => s.level >= 2)
    .map((s) => `§${s.number || ""} ${s.title}: ${(s.own_text || "").slice(0, 280).replace(/\n+/g, " ")}`)
    .join("\n");

  let acc = "";
  try {
    const url = `${CFG.SUPABASE_URL.replace(/\/$/, "")}${CFG.CHAT_FUNCTION_PATH}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CFG.SUPABASE_ANON_KEY}`,
        "apikey": CFG.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        model: CFG.MODEL,
        mode: "global",
        context: { title: "AI Playbook — volledige inhoud", path: [], text: global.slice(0, 16000) },
        messages: [{ role: "user", content: question }],
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    target.innerHTML = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const obj = JSON.parse(data);
          const delta = obj.choices?.[0]?.delta?.content || obj.choices?.[0]?.message?.content || "";
          if (delta) {
            acc += delta;
            target.innerHTML = renderMarkdown(acc);
          }
        } catch {}
      }
    }
  } catch (err) {
    target.innerHTML = `<em>Fout: ${escapeHTML(err.message || err)}</em>`;
  }
}

// ===== Text-selection tooltip =============================

function initSelectionTooltip() {
  const tip = document.getElementById("selectionTooltip");
  const btn = document.getElementById("selectionAskBtn");
  let lastSelection = null;

  document.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 5) {
      tip.hidden = true;
      lastSelection = null;
      return;
    }
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const owner = (container.nodeType === 1 ? container : container.parentElement)?.closest(".original-text, .activity-summary, .pillar-header p, .activity-card p, .hero p");
    if (!owner) {
      tip.hidden = true;
      return;
    }
    const rect = range.getBoundingClientRect();
    tip.style.top = `${rect.top + window.scrollY}px`;
    tip.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
    tip.hidden = false;
    lastSelection = { text, sectionId: owner.dataset?.sectionId || null };
  });
  document.addEventListener("mousedown", (e) => {
    if (e.target.closest("#selectionTooltip")) return;
    tip.hidden = true;
  });
  btn.addEventListener("click", () => {
    if (!lastSelection) return;
    const sectionId = lastSelection.sectionId;
    const section = sectionId ? state.byId.get(sectionId) : null;
    const path = section ? [...(section.path || []), "Selectie"] : ["Selectie"];
    pinContext(
      {
        id: `selection-${Date.now()}`,
        title: lastSelection.text.length > 60 ? lastSelection.text.slice(0, 57) + "…" : lastSelection.text,
        path,
        own_text: lastSelection.text,
        number: section?.number,
      },
      `Selectie: "${lastSelection.text.length > 50 ? lastSelection.text.slice(0, 47) + "…" : lastSelection.text}"`,
    );
    tip.hidden = true;
    window.getSelection()?.removeAllRanges();
  });
}

// Boot when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
