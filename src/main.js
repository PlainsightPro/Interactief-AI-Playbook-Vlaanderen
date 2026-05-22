// Shared boot script — runs on every page.
// Wires the topbar, footer, mobile chat toggle, scroll-reveal.

import { $, $$, initReveal } from "./utils.js";
import { Icons } from "./icons.js";
import { Profile } from "./state.js";

const CFG = window.AI_PLAYBOOK_CONFIG || {};

function injectIcons() {
  $$("[data-icon]").forEach(node => {
    const name = node.dataset.icon;
    if (Icons[name]) node.innerHTML = Icons[name];
  });
}

function buildTopbar() {
  const topbar = $("#topbar");
  if (!topbar) return;

  topbar.innerHTML = `
    <a class="topbar-brand" href="index.html" aria-label="AI Playbook — startpagina">
      <span class="lion-svg" aria-hidden="true" data-icon="lionFlat"></span>
      <span class="brand-stack">
        <span class="brand-name">AI Playbook</span>
        <span class="brand-sub">Interactieve gids · Vlaanderen</span>
      </span>
    </a>
    <nav class="topbar-nav" aria-label="Hoofdmenu">
      <a class="topbar-link" href="index.html" data-page="index">Start</a>
      <a class="topbar-link is-mobile" href="quiz.html" data-page="quiz">Quiz</a>
      <a class="topbar-link is-mobile" href="playbook.html" data-page="playbook">Mijn playbook</a>
      <a class="topbar-link" href="over.html" data-page="over">Over</a>
      <span id="topbarProfileSlot"></span>
    </nav>
  `;

  injectIcons();
  // Highlight current
  const page = document.body.dataset.page;
  $$(".topbar-link").forEach(l => {
    if (l.dataset.page === page) l.classList.add("is-active");
  });

  // Profile badge — appears once a profile is set.
  renderProfileBadge();
}

function renderProfileBadge() {
  const slot = $("#topbarProfileSlot");
  if (!slot) return;
  slot.innerHTML = "";
  const profile = Profile.get();
  if (!profile) return;
  const label = ({
    verkenner: "Verkenner",
    piloot: "Piloot",
    expert: "Expert",
    persoonlijk: "Persoonlijk",
  })[profile] || profile;
  const btn = document.createElement("button");
  btn.className = "topbar-profile-badge";
  btn.type = "button";
  btn.setAttribute("data-profile-switcher", "");
  btn.setAttribute("aria-label", `Huidig profiel: ${label}. Klik om te wisselen.`);
  btn.innerHTML = `<span class="dot"></span> ${label}`;
  btn.addEventListener("click", () => {
    const order = ["verkenner","piloot","expert","persoonlijk"];
    const idx = order.indexOf(profile);
    const next = order[(idx + 1) % order.length];
    if (document.body.dataset.page === "playbook") {
      location.href = `playbook.html?profile=${next}`;
    } else {
      Profile.set(next);
      renderProfileBadge();
    }
  });
  slot.appendChild(btn);
}

function buildFooter() {
  const f = $("#footer");
  if (!f) return;
  const year = new Date().getFullYear();
  const privacy = CFG.PRIVACY_CONTACT_EMAIL || "privacy@…";
  f.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div>
          <h4>AI Playbook · Interactieve gids</h4>
          <p>
            Een onafhankelijke, interactieve samenvatting van het <em>AI Playbook</em>
            (Introductie + Kernactiviteiten) van Digitaal Vlaanderen. Niet gelieerd aan
            de Vlaamse overheid. Verifieer essentiële informatie steeds aan de bron.
          </p>
          <p>
            Samenvattingen en de conversationele assistent worden ondersteund door
            <strong>Google Gemini Flash-Lite</strong> via OpenRouter.
          </p>
        </div>
        <div>
          <h4>Navigatie</h4>
          <ul>
            <li><a href="index.html">Start</a></li>
            <li><a href="quiz.html">Quiz</a></li>
            <li><a href="playbook.html">Mijn playbook</a></li>
            <li><a href="over.html">Over deze playbook</a></li>
          </ul>
        </div>
        <div>
          <h4>Bron &amp; privacy</h4>
          <ul>
            <li><a href="https://www.vlaanderen.be/digitaal-vlaanderen" target="_blank" rel="noopener noreferrer">Digitaal Vlaanderen</a></li>
            <li><a href="over.html#disclaimer">Volledige disclaimer</a></li>
            <li><a href="over.html#privacy">Privacy &amp; verwijderverzoek</a></li>
            <li><a href="mailto:${privacy}">${privacy}</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${year} · Interactieve AI Playbook · Versie mei 2026</span>
        <span>Gebouwd op de bronnen van Digitaal Vlaanderen</span>
      </div>
    </div>
  `;
}

function bindSmoothScroll() {
  // Native scrolling — Lenis with lerp: 0.10 added ~300ms of input lag.
}

function bindChatToggleFab() {
  const fab = $(".chat-toggle-fab");
  const shell = $(".playbook-shell");
  if (!fab || !shell) return;
  fab.addEventListener("click", () => {
    shell.classList.remove("is-chat-collapsed");
    fab.classList.add("is-hidden");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  buildTopbar();
  buildFooter();
  initReveal(".reveal");
  bindSmoothScroll();
  bindChatToggleFab();
});

// Expose a global for non-module pages to read profile / icons (debug aid).
window.HC = { Icons, Profile };
