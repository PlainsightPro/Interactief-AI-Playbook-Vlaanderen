// Chat sidebar: prepared questions + email gate + streaming Q&A via Supabase Edge Function.

import { $, el, escapeHtml, debounce } from "./utils.js";
import { Icons } from "./icons.js";
import { Email, Profile, ChatHistory } from "./state.js";
import { Data } from "./data.js";
import { validateBusinessEmail } from "./email.js";
import { renderMarkdown } from "./markdown.js";

const CFG = window.AI_PLAYBOOK_CONFIG || {};

function isProxyConfigured() {
  return CFG.SUPABASE_URL && !/YOUR_PROJECT/i.test(CFG.SUPABASE_URL)
    && CFG.SUPABASE_ANON_KEY && !/YOUR_ANON_KEY/i.test(CFG.SUPABASE_ANON_KEY);
}

// Surface the runtime config once so missing/cached values are easy to spot.
if (!isProxyConfigured()) {
  console.warn("[chat] AI-proxy not configured at load:", {
    has_url: !!CFG.SUPABASE_URL,
    url: CFG.SUPABASE_URL,
    has_key: !!CFG.SUPABASE_ANON_KEY,
    key_prefix: typeof CFG.SUPABASE_ANON_KEY === "string" ? CFG.SUPABASE_ANON_KEY.slice(0, 12) : null,
  });
}

let prepared = { global: [], byPillar: {}, byProfile: {} };
let playbook = null;
let panelEl = null;
let bodyEl = null;
let footerEl = null;
let currentContext = null; // { id, title, text, pillar, profile }

export async function mountChat(panelSelector) {
  panelEl = typeof panelSelector === "string" ? $(panelSelector) : panelSelector;
  if (!panelEl) return;
  [prepared, playbook] = await Promise.all([
    Data.preparedQuestions(),
    Data.playbook().catch(() => null),
  ]);

  buildPanel();
  bindGlobalEvents();
}

function buildPanel() {
  panelEl.innerHTML = "";
  panelEl.classList.add("chat-panel");
  panelEl.setAttribute("aria-label", "AI-assistent paneel");
  panelEl.setAttribute("role", "complementary");

  // Header
  const header = el("div", { class: "chat-header" });
  const titleRow = el("div", { style: { display: "flex", alignItems: "center", gap: "var(--sp-2)" } });
  const title = el("h2", {});
  title.innerHTML = Icons.sparkle + " <span>Stel een vraag</span>";
  titleRow.appendChild(title);
  const collapse = el("button", { class: "chat-collapse-btn", type: "button", "aria-label": "Paneel sluiten", title: "Sluiten" });
  collapse.innerHTML = Icons.close;
  collapse.addEventListener("click", () => toggleChat(false));
  titleRow.appendChild(collapse);
  header.appendChild(titleRow);
  header.appendChild(el("p", { class: "chat-header-sub" }, "Krijg antwoorden gebaseerd op uw organisatieprofiel en de relevante secties."));
  header.appendChild(el("div", { class: "chat-disclaimer" },
    "AI-antwoorden zijn gegenereerd door Google Gemini via OpenRouter. Verifieer belangrijke informatie aan de bron."));
  panelEl.appendChild(header);

  // Body
  bodyEl = el("div", { class: "chat-body" });
  panelEl.appendChild(bodyEl);

  // Footer
  footerEl = el("div", { class: "chat-footer" });
  panelEl.appendChild(footerEl);

  renderContent();
}

function renderContent() {
  bodyEl.innerHTML = "";
  footerEl.innerHTML = "";

  // If email not verified -> show prepared questions list, but clicking opens email gate.
  // If verified -> show prepared questions + ability to chat.

  // Context indicator (if pinned)
  if (currentContext && currentContext.id) {
    const ctxChip = el("div", { class: "chat-message-context" });
    ctxChip.appendChild(el("strong", {}, "Context: "));
    ctxChip.appendChild(document.createTextNode(currentContext.title));
    const clear = el("button", {
      class: "btn-link",
      style: { marginLeft: "8px", fontSize: "11px" },
      type: "button",
      onclick: () => { currentContext = null; renderContent(); },
    }, "ontkoppelen");
    ctxChip.appendChild(clear);
    bodyEl.appendChild(ctxChip);
  }

  // Render the message thread for the current context
  const contextId = currentContext?.id || "_global";
  const history = ChatHistory.getFor(contextId);
  for (const msg of history) appendMessage(msg.role, msg.content, msg.citations);

  // Prepared question list (above the input until first user message)
  if (!history.length || !currentContext) {
    appendPreparedQuestions(contextId);
  }

  // Footer = input + disclaimer button row
  buildFooter();
}

function buildFooter() {
  footerEl.innerHTML = "";
  if (!Email.isVerified()) {
    // No input — gate forces user to register first.
    const hint = el("div", { class: "chat-email-hint" },
      "Bedrijfse-mail vereist om vragen te stellen. Geen registratie? Klik een vraag hierboven om te starten.");
    footerEl.appendChild(hint);
    return;
  }
  const row = el("div", { class: "chat-input-row" });
  const input = el("textarea", {
    class: "chat-input",
    rows: 1,
    placeholder: currentContext ? `Vraag over '${currentContext.title}'…` : "Stel een vraag over het playbook…",
    "aria-label": "Uw vraag",
  });
  input.addEventListener("input", () => autoResize(input));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendUserMessage(input.value);
      input.value = "";
      autoResize(input);
    }
  });
  const send = el("button", { class: "chat-send", type: "button", "aria-label": "Verstuur" });
  send.innerHTML = Icons.send;
  send.addEventListener("click", () => {
    sendUserMessage(input.value);
    input.value = "";
    autoResize(input);
  });
  row.appendChild(input);
  row.appendChild(send);
  footerEl.appendChild(row);

  // Quick actions
  const actions = el("div", { class: "chat-actions-row" });
  const clearBtn = el("button", { type: "button", onclick: () => { ChatHistory.clearFor(currentContext?.id || "_global"); renderContent(); } }, "Conversatie wissen");
  actions.appendChild(clearBtn);
  footerEl.appendChild(actions);
}

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(120, textarea.scrollHeight) + "px";
}

function appendPreparedQuestions(contextId) {
  const profile = Profile.get();
  const list = [];
  // Global prompts always
  for (const q of prepared.global || []) list.push(q);
  // Profile-specific (if profile selected)
  if (profile && prepared.byProfile?.[profile]) {
    for (const q of prepared.byProfile[profile]) list.push(q);
  }
  // Context-specific (if pinned)
  if (currentContext?.pillarId && prepared.byPillar?.[currentContext.pillarId]) {
    for (const q of prepared.byPillar[currentContext.pillarId]) list.push(q);
  }

  if (!list.length) return;
  const wrap = el("div", { class: "prepared-list" });
  wrap.appendChild(el("div", { class: "prepared-list-title" }, "Voorgestelde vragen"));
  for (const q of list.slice(0, 8)) {
    const btn = el("button", {
      class: "prepared-q",
      type: "button",
      onclick: () => onPreparedClick(q),
    });
    btn.innerHTML = `<span class="arrow">›</span> ${escapeHtml(q)}`;
    wrap.appendChild(btn);
  }
  bodyEl.appendChild(wrap);
}

function onPreparedClick(q) {
  if (!Email.isVerified()) {
    showEmailGate(() => sendUserMessage(q));
    return;
  }
  sendUserMessage(q);
}

function showEmailGate(afterVerified) {
  bodyEl.innerHTML = "";
  const wrap = el("div", { class: "chat-email-gate" });
  wrap.appendChild(el("h3", {}, "Even uw bedrijfse-mail"));
  wrap.appendChild(el("p", {},
    "Om de AI-assistent te gebruiken hebben we een organisatie- of bedrijfse-mail nodig. Publieke domeinen (Gmail, Hotmail, Outlook, …) worden niet aanvaard."));
  const input = el("input", {
    class: "chat-email-input",
    type: "email",
    placeholder: "voornaam.naam@organisatie.be",
    autocomplete: "email",
    "aria-label": "Bedrijfse-mail",
  });
  const error = el("div", { class: "chat-email-error", role: "alert", "aria-live": "polite" });
  const submit = el("button", { class: "btn btn-primary chat-email-submit", type: "button" });
  submit.innerHTML = `<span>Doorgaan</span>` + Icons.arrowRight;
  submit.addEventListener("click", trySubmit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") trySubmit(); });
  function trySubmit() {
    const res = validateBusinessEmail(input.value);
    if (!res.ok) { error.textContent = res.reason; input.focus(); return; }
    error.textContent = "";
    Email.save(res.email);
    logLead(res.email).catch(() => {});
    renderContent();
    if (typeof afterVerified === "function") afterVerified();
  }
  wrap.appendChild(input);
  wrap.appendChild(error);
  wrap.appendChild(submit);
  wrap.appendChild(el("p", { class: "chat-email-hint" },
    `We gebruiken uw e-mailadres alleen om gebruik van de assistent te volgen. Bewaartermijn: ${CFG.RETENTION_MONTHS || 24} maanden. Verwijderen op verzoek via ${CFG.PRIVACY_CONTACT_EMAIL || "privacy@…"}.`));
  bodyEl.appendChild(wrap);

  // Hide input row while gating
  footerEl.innerHTML = "";
  input.focus();
}

function appendMessage(role, content, citations) {
  const msg = el("div", { class: `chat-message is-${role}` });
  setMessageContent(msg, role, content);
  if (Array.isArray(citations) && citations.length) {
    const citeRow = el("div", { class: "chat-citations" });
    for (const c of citations) {
      const link = el("a", { class: "citation", href: `#activity-${c.id}` }, c.number || c.id);
      citeRow.appendChild(link);
    }
    msg.appendChild(citeRow);
  }
  bodyEl.appendChild(msg);
  bodyEl.scrollTop = bodyEl.scrollHeight;
  return msg;
}

// Assistant replies get rendered as Markdown; everything else stays as plain
// text so a user typing literal asterisks doesn't turn into bold.
function setMessageContent(msgEl, role, content) {
  const isAssistantReply = role === "assistant" || role === "assistant is-typing";
  if (isAssistantReply && content && !/^(Bezig met antwoord)/i.test(content)) {
    msgEl.classList.add("md-body");
    msgEl.innerHTML = renderMarkdown(content);
  } else {
    msgEl.classList.remove("md-body");
    msgEl.textContent = content;
  }
}

async function sendUserMessage(text) {
  text = (text || "").trim();
  if (!text) return;
  const contextId = currentContext?.id || "_global";

  appendMessage("user", text);
  ChatHistory.appendFor(contextId, { role: "user", content: text });

  // Clear prepared list once a real message exists
  bodyEl.querySelectorAll(".prepared-list").forEach(el => el.remove());

  const typing = appendMessage("assistant is-typing", "Bezig met antwoord…");

  try {
    let acc = "";
    const reply = await callChat(text, (chunk) => {
      acc = chunk;
      typing.classList.remove("is-typing");
      typing.className = "chat-message is-assistant";
      setMessageContent(typing, "assistant", acc);
      bodyEl.scrollTop = bodyEl.scrollHeight;
    });
    const final = reply || acc;
    typing.classList.remove("is-typing");
    typing.className = "chat-message is-assistant";
    setMessageContent(typing, "assistant", final || "Geen antwoord ontvangen.");
    ChatHistory.appendFor(contextId, { role: "assistant", content: final });
  } catch (err) {
    typing.remove();
    const friendly = !isProxyConfigured()
      ? "De AI-proxy is nog niet geconfigureerd. Vraag de beheerder om Supabase + OpenRouter op te zetten en config.js aan te vullen. (Zie README.)"
      : `Er ging iets mis bij het ophalen van een antwoord: ${err.message || err}`;
    appendMessage("assistant", friendly);
  }
}

async function callChat(userText, onChunk) {
  if (!isProxyConfigured()) {
    throw new Error("proxy_not_configured");
  }
  const url = CFG.SUPABASE_URL.replace(/\/$/, "") + (CFG.CHAT_FUNCTION_PATH || "/functions/v1/chat");
  const messages = ChatHistory.getFor(currentContext?.id || "_global")
    .slice(-12) // last 12 turns to bound payload
    .map(m => ({ role: m.role, content: m.content }));
  // Build context payload
  let context = null;
  if (currentContext) {
    context = { title: currentContext.title, path: currentContext.path, text: currentContext.text };
  }
  const body = {
    messages,
    context,
    mode: currentContext ? "section" : "global",
    profile: Profile.get(),
    email: Email.get(),
    model: CFG.MODEL,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CFG.SUPABASE_ANON_KEY}`,
      "apikey": CFG.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return readSseStream(res, onChunk);
}

async function readSseStream(res, onChunk) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    let updated = false;
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        if (updated && typeof onChunk === "function") onChunk(full);
        return full;
      }
      try {
        const j = JSON.parse(data);
        const piece = j.choices?.[0]?.delta?.content || j.choices?.[0]?.message?.content || "";
        if (piece) { full += piece; updated = true; }
      } catch {}
    }
    if (updated && typeof onChunk === "function") onChunk(full);
  }
  return full || "Geen antwoord ontvangen.";
}

async function logLead(email) {
  if (!CFG.ENABLE_LEAD_LOG) return;
  if (!isProxyConfigured()) return;
  // Fire-and-forget. The Edge Function will accept lead pings via the same endpoint.
  try {
    const url = CFG.SUPABASE_URL.replace(/\/$/, "") + (CFG.CHAT_FUNCTION_PATH || "/functions/v1/chat");
    await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CFG.SUPABASE_ANON_KEY}`,
        "apikey": CFG.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "lead", email, profile: Profile.get() }),
    });
  } catch {}
}

// ---- External integration ----
// 1. "Vraag over deze sectie" buttons on activity cards dispatch this event.
function bindGlobalEvents() {
  window.addEventListener("aiplaybook:ask-section", (e) => {
    const a = e.detail?.activity;
    if (!a) return;
    setContext({
      id: `activity-${a.id}`,
      title: a.title,
      path: a.trail || (a.number ? [a.number, a.title] : [a.title]),
      text: (a.full_text || a.own_text || "").slice(0, 6000),
      pillarId: a.id?.split("-")[0],
    });
    toggleChat(true);
  });

  // Floating button to reopen panel
  const fab = $(".chat-toggle-fab");
  if (fab) fab.addEventListener("click", () => toggleChat(true));
}

function setContext(ctx) {
  currentContext = ctx;
  renderContent();
}

function toggleChat(open) {
  const shell = $(".playbook-shell");
  const fab = $(".chat-toggle-fab");
  if (!shell) return;
  shell.classList.toggle("is-chat-collapsed", !open);
  if (fab) fab.classList.toggle("is-hidden", !!open);
}
