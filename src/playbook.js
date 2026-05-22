// Per-profile playbook view — hybrid matrix (pillar × phase) with phase-mode toggle,
// 3-tier activity cards, search filter, and profile switcher integration.

import { $, $$, el, escapeHtml, truncate, debounce, queryParam } from "./utils.js";
import { Icons, PILLAR_ICONS, PROFILE_ICONS } from "./icons.js";
import { Profile, state, KEYS } from "./state.js";
import { Data, summaryFor, activitiesForProfile } from "./data.js";
import { formatActivityBody } from "./formatter.js";

let playbook = null;
let introductie = null;
let summaries = {};
let currentProfile = null;
let currentView = "pillar"; // 'pillar' | 'phase'
let filterText = "";
let mountEl = null;
let activitiesAll = []; // flattened, profile-filtered

const PHASE_NAMES = {
  1: "Verkennen & experimenteren",
  2: "Keuzes maken",
  3: "Capaciteiten ontwikkelen",
  4: "Implementeren",
  5: "Evalueren & opschalen",
};

export async function mountPlaybook(mountSelector) {
  mountEl = typeof mountSelector === "string" ? $(mountSelector) : mountSelector;
  if (!mountEl) return;

  // Resolve profile: query param wins, else stored profile, else nudge to quiz.
  const requested = queryParam("profile");
  if (requested && ["verkenner","piloot","expert","persoonlijk"].includes(requested)) {
    Profile.set(requested);
    currentProfile = requested;
  } else {
    currentProfile = Profile.get();
  }
  if (!currentProfile) { renderNoProfile(); return; }

  [playbook, introductie, summaries] = await Promise.all([
    Data.playbook(),
    Data.introductie(),
    Data.summaries(),
  ]);

  activitiesAll = activitiesForProfile(playbook, currentProfile);
  // ?view= URL param wins so deep-links from the homepage can pick the right tab.
  const urlView = queryParam("view");
  currentView = (urlView === "pillar" || urlView === "phase") ? urlView : (state.get(KEYS.view) || "pillar");
  if (urlView) state.set(KEYS.view, currentView);

  render();
  hookProfileSwitcher();

  // Honour the URL hash AFTER render, since the section IDs only exist post-render.
  if (location.hash) {
    requestAnimationFrame(() => {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function render() {
  mountEl.innerHTML = "";
  mountEl.appendChild(renderBanner());
  mountEl.appendChild(renderToolbar());

  // Empty state
  const matchCount = activitiesAll.filter(matchesFilter).length;
  if (matchCount === 0) {
    mountEl.appendChild(buildEmpty(filterText ? `Geen resultaten voor "${filterText}".` : "Geen activiteiten voor dit profiel."));
    return;
  }

  if (currentView === "pillar") {
    mountEl.appendChild(renderPillarView());
  } else {
    mountEl.appendChild(renderPhaseView());
  }
}

function renderBanner() {
  const meta = (introductie.profiles || {})[currentProfile] || {};
  const banner = el("section", { class: "profile-banner reveal is-visible" });

  // Lion silhouette behind
  const lion = el("div", { class: "profile-banner-lion", "aria-hidden": "true" });
  lion.innerHTML = Icons.lion;
  banner.appendChild(lion);

  const left = el("div", {});
  left.appendChild(el("div", { class: "profile-banner-eyebrow" }, "Uw organisatieprofiel"));
  left.appendChild(el("h1", {}, meta.name || currentProfile));
  left.appendChild(el("p", { class: "profile-banner-desc" }, meta.description || ""));
  banner.appendChild(left);

  // Stats panel
  const stats = el("div", { class: "profile-banner-stats" });
  const total = activitiesAll.length;
  const pillars = new Set(activitiesAll.map(a => a.id?.split("-")[0])).size;
  const stat1 = el("div", { class: "profile-banner-stat" });
  stat1.appendChild(el("span", { class: "num" }, String(total)));
  stat1.appendChild(el("span", { class: "label" }, "Activiteiten in uw reis"));
  const stat2 = el("div", { class: "profile-banner-stat" });
  stat2.appendChild(el("span", { class: "num" }, String(pillars)));
  stat2.appendChild(el("span", { class: "label" }, "Pijlers in scope"));
  stats.appendChild(stat1);
  stats.appendChild(stat2);
  banner.appendChild(stats);
  return banner;
}

function renderToolbar() {
  const toolbar = el("div", { class: "view-toolbar reveal is-visible" });

  const toggle = el("div", { class: "view-toggle", role: "tablist", "aria-label": "Weergave kiezen" });
  const pillarBtn = el("button", {
    type: "button", role: "tab",
    class: currentView === "pillar" ? "is-active" : "",
    "aria-selected": currentView === "pillar" ? "true" : "false",
    onclick: () => setView("pillar"),
  }, "Per pijler");
  const phaseBtn = el("button", {
    type: "button", role: "tab",
    class: currentView === "phase" ? "is-active" : "",
    "aria-selected": currentView === "phase" ? "true" : "false",
    onclick: () => setView("phase"),
  }, "Per fase");
  toggle.appendChild(pillarBtn);
  toggle.appendChild(phaseBtn);
  toolbar.appendChild(toggle);

  const searchWrap = el("div", { class: "view-search" });
  const icon = el("span", { class: "search-icon", "aria-hidden": "true" });
  icon.innerHTML = Icons.search;
  searchWrap.appendChild(icon);
  const input = el("input", {
    type: "search",
    placeholder: "Zoek in activiteiten…",
    "aria-label": "Zoek in activiteiten",
    value: filterText,
  });
  input.addEventListener("input", debounce((e) => {
    filterText = e.target.value.trim().toLowerCase();
    render();
    requestAnimationFrame(() => $(".view-search input")?.focus());
  }, 220));
  searchWrap.appendChild(input);
  toolbar.appendChild(searchWrap);

  // Pillar collapse all / expand all
  const collapseAll = el("button", {
    class: "btn btn-ghost btn-sm",
    type: "button",
    onclick: () => toggleAllPillars(true),
    title: "Alle pijlers inklappen",
  }, "Alles inklappen");
  const expandAll = el("button", {
    class: "btn btn-ghost btn-sm",
    type: "button",
    onclick: () => toggleAllPillars(false),
    title: "Alle pijlers openklappen",
  }, "Alles openen");
  if (currentView === "pillar") {
    toolbar.appendChild(collapseAll);
    toolbar.appendChild(expandAll);
  }

  return toolbar;
}

function setView(v) {
  currentView = v;
  state.set(KEYS.view, v);
  render();
}

function toggleAllPillars(collapse) {
  const ids = playbook.pillars.map(p => p.id);
  state.set(KEYS.collapsedPillars, collapse ? ids : []);
  render();
}

function isPillarCollapsed(pid) {
  const list = state.get(KEYS.collapsedPillars) || [];
  return list.includes(pid);
}

function togglePillarCollapsed(pid) {
  const list = new Set(state.get(KEYS.collapsedPillars) || []);
  if (list.has(pid)) list.delete(pid); else list.add(pid);
  state.set(KEYS.collapsedPillars, [...list]);
  render();
}

// ---- Pillar view (default helikopter) ----
function renderPillarView() {
  const wrap = el("div", {});
  for (const pillar of playbook.pillars || []) {
    const pillarId = pillar.id;
    const activities = activitiesAll
      .filter(a => a.id?.startsWith(pillarId + "-"))
      .filter(matchesFilter);
    if (activities.length === 0 && filterText) continue;

    const group = el("section", { class: "pillar-group reveal is-visible", id: `pijler-${pillarId}` });

    const head = el("div", { class: "pillar-group-head" });
    const num = el("span", { class: "pillar-group-num", "aria-hidden": "true" }, String(pillarId));
    head.appendChild(num);
    head.appendChild(el("h2", {}, pillar.title));

    const collapsed = isPillarCollapsed(pillarId);
    const collapseBtn = el("button", {
      class: "pillar-group-collapse",
      type: "button",
      "aria-expanded": (!collapsed).toString(),
      "aria-controls": `pijler-${pillarId}-body`,
      onclick: () => togglePillarCollapsed(pillarId),
    }, collapsed ? "Toon" : "Verberg");
    head.appendChild(collapseBtn);
    group.appendChild(head);

    if (!collapsed) {
      const body = el("div", { id: `pijler-${pillarId}-body` });
      // Group by phase (under this profile)
      const byPhase = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      for (const a of activities) {
        const ph = (a.phase_by_profile && a.phase_by_profile[currentProfile])
          || (a.phase_by_profile?.verkenner) || (a.phase_by_profile?.piloot) || (a.phase_by_profile?.expert) || 1;
        if (byPhase[ph]) byPhase[ph].push(a);
      }
      for (const phaseId of [1,2,3,4,5]) {
        const list = byPhase[phaseId];
        if (!list.length) continue;
        const row = el("div", { class: "phase-row" });
        const rowHead = el("div", { class: "phase-row-head" });
        rowHead.appendChild(el("span", { class: "phase-num", "aria-hidden": "true" }, String(phaseId)));
        rowHead.appendChild(el("span", {}, PHASE_NAMES[phaseId]));
        row.appendChild(rowHead);
        const listEl = el("div", { class: "activities-list" });
        for (const a of list) listEl.appendChild(activityCard(a));
        row.appendChild(listEl);
        body.appendChild(row);
      }
      group.appendChild(body);
    }
    wrap.appendChild(group);
  }
  return wrap;
}

// ---- Phase view ----
function renderPhaseView() {
  const wrap = el("div", {});
  const byPhase = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const a of activitiesAll.filter(matchesFilter)) {
    const ph = (a.phase_by_profile && a.phase_by_profile[currentProfile])
      || a.phase_by_profile?.verkenner || a.phase_by_profile?.piloot || a.phase_by_profile?.expert || 1;
    if (byPhase[ph]) byPhase[ph].push(a);
  }
  for (const phaseId of [1,2,3,4,5]) {
    const items = byPhase[phaseId];
    if (!items.length) continue;
    const group = el("section", { class: "phase-group reveal is-visible", id: `fase-${phaseId}` });

    const head = el("div", { class: "phase-group-head" });
    head.appendChild(el("span", { class: "phase-group-num" }, String(phaseId)));
    head.appendChild(el("h2", {}, PHASE_NAMES[phaseId]));
    group.appendChild(head);

    // Group within phase by pillar
    const byPillar = new Map();
    for (const a of items) {
      const pid = a.id?.split("-")[0];
      if (!byPillar.has(pid)) byPillar.set(pid, []);
      byPillar.get(pid).push(a);
    }
    const pillarsWrap = el("div", { class: "phase-group-pillars" });
    for (const pillar of playbook.pillars) {
      const list = byPillar.get(pillar.id) || [];
      if (!list.length) continue;
      const sub = el("div", { class: "phase-pillar-group" });
      sub.appendChild(el("h3", {}, pillar.title));
      const acts = el("div", { class: "activities-list" });
      for (const a of list) acts.appendChild(activityCard(a));
      sub.appendChild(acts);
      pillarsWrap.appendChild(sub);
    }
    group.appendChild(pillarsWrap);
    wrap.appendChild(group);
  }
  return wrap;
}

// ---- Activity card (collapsible, 3-tier disclosure) ----
function activityCard(a) {
  const summary = summaryFor(a, summaries);
  const card = el("article", { class: "activity-card", "data-activity-id": a.id });

  const head = el("button", {
    class: "activity-head",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": `body-${a.id}`,
  });
  const text = el("div", { class: "activity-head-text" });
  text.appendChild(el("div", { class: "activity-number" }, a.number || ""));
  text.appendChild(el("h4", { class: "activity-title" }, a.title));
  if (summary) text.appendChild(el("p", { class: "activity-summary" }, truncate(summary, 220)));
  head.appendChild(text);
  const toggle = el("span", { class: "activity-toggle", "aria-hidden": "true" });
  toggle.innerHTML = Icons.chevronDown;
  head.appendChild(toggle);
  card.appendChild(head);

  const body = el("div", { class: "activity-body", id: `body-${a.id}` });
  const inner = el("div", { class: "activity-body-inner" });

  if (a.own_text) inner.appendChild(formatActivityBody(a.own_text, a.images, a));

  if (Array.isArray(a.children) && a.children.length) {
    const kids = el("div", { class: "activity-children" });
    kids.appendChild(el("div", { class: "prepared-list-title" }, "Onderliggende stappen"));
    for (const child of a.children) {
      const ch = el("div", { class: "activity-child" });
      ch.appendChild(el("div", { class: "activity-child-title" }, child.title));
      if (child.own_text) ch.appendChild(el("div", { class: "text-soft" }, truncate(child.own_text, 360)));
      kids.appendChild(ch);
    }
    inner.appendChild(kids);
  }

  const actions = el("div", { class: "activity-body-actions" });
  if (a.page != null) {
    actions.appendChild(el("span", { class: "activity-source-link" }, `Bron: pagina ${a.page} in Kernactiviteiten PDF`));
  }
  const askBtn = el("button", {
    class: "ask-this-section",
    type: "button",
    "data-ask-section": a.id,
    onclick: (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("aiplaybook:ask-section", { detail: { activity: a } }));
    },
  });
  askBtn.innerHTML = Icons.sparkle + " <span>Vraag over deze sectie</span>";
  actions.appendChild(askBtn);
  inner.appendChild(actions);

  body.appendChild(inner);
  card.appendChild(body);

  head.addEventListener("click", () => {
    const open = card.classList.toggle("is-open");
    head.setAttribute("aria-expanded", open.toString());
  });

  return card;
}

function matchesFilter(a) {
  if (!filterText) return true;
  const hay = [a.title, a.number, ...(a.trail || [])].join(" ").toLowerCase();
  return hay.includes(filterText);
}

function buildEmpty(msg) {
  return el("div", { class: "empty-state" }, msg);
}

function renderNoProfile() {
  mountEl.innerHTML = "";
  const wrap = el("div", { class: "quiz-result" });
  wrap.appendChild(el("h1", { class: "quiz-result-name" }, "Eerst uw profiel bepalen"));
  wrap.appendChild(el("p", { class: "quiz-result-tagline" }, "Doe de korte quiz om uw playbook op uw organisatie af te stemmen."));
  const a = el("a", { class: "btn btn-primary btn-lg", href: "quiz.html" });
  a.innerHTML = `<span>Start de quiz</span>` + Icons.arrowRight;
  wrap.appendChild(a);
  mountEl.appendChild(wrap);
}

function hookProfileSwitcher() {
  // The topbar profile badge (data-profile-switcher) lets the user switch profile.
  const badge = document.querySelector("[data-profile-switcher]");
  if (!badge) return;
  badge.addEventListener("click", () => {
    const order = ["verkenner","piloot","expert","persoonlijk"];
    const idx = order.indexOf(currentProfile);
    const next = order[(idx + 1) % order.length];
    location.href = `playbook.html?profile=${next}`;
  });
}
