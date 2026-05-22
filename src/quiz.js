// Quiz flow — 6 questions verbatim from Introductie p8.

import { $, el, escapeHtml } from "./utils.js";
import { Icons, PROFILE_ICONS } from "./icons.js";
import { Quiz, Profile } from "./state.js";
import { Data } from "./data.js";

let questions = [];
let mapping = { A: "verkenner", B: "piloot", C: "expert" };
let profileMeta = {};
let answers = {}; // {number: "A"|"B"|"C"}
let currentIdx = 0;
let mountEl = null;

export async function mountQuiz(mountSelector) {
  mountEl = typeof mountSelector === "string" ? $(mountSelector) : mountSelector;
  if (!mountEl) return;
  const intro = await Data.introductie();
  questions = intro.quiz.questions;
  mapping = intro.quiz.result_mapping;
  profileMeta = intro.profiles;
  answers = Quiz.getAnswers() || {};
  currentIdx = 0;
  render();
}

function render() {
  if (currentIdx >= questions.length) {
    renderResult();
    return;
  }
  const q = questions[currentIdx];
  const selected = answers[q.number];

  mountEl.innerHTML = "";
  mountEl.appendChild(buildHeader());

  const card = el("div", { class: "quiz-question reveal is-visible" });
  card.appendChild(el("h2", {}, q.text));
  const list = el("div", { class: "quiz-answers", role: "radiogroup", "aria-label": q.text });
  for (const letter of ["A", "B", "C"]) {
    const btn = el("button", {
      class: "quiz-answer" + (selected === letter ? " is-selected" : ""),
      type: "button",
      role: "radio",
      "aria-checked": selected === letter ? "true" : "false",
      onclick: () => selectAnswer(q.number, letter),
    });
    btn.appendChild(el("span", { class: "quiz-answer-letter", "aria-hidden": "true" }, letter));
    btn.appendChild(el("span", { class: "quiz-answer-text" }, q.answers[letter]));
    list.appendChild(btn);
  }
  card.appendChild(list);

  // Nav row
  const nav = el("div", { class: "quiz-nav" });
  const backBtn = el("button", {
    class: "btn btn-ghost",
    type: "button",
    onclick: goBack,
    disabled: currentIdx === 0 || null,
  });
  backBtn.innerHTML = Icons.arrowLeft + " <span>Vorige</span>";
  nav.appendChild(backBtn);

  const nextBtn = el("button", {
    class: "btn btn-primary",
    type: "button",
    onclick: goNext,
    disabled: !selected || null,
  });
  nextBtn.innerHTML = `<span>${currentIdx === questions.length - 1 ? "Toon mijn profiel" : "Volgende"}</span>` + Icons.arrowRight;
  nav.appendChild(nextBtn);

  card.appendChild(nav);
  mountEl.appendChild(card);

  // Keyboard: A/B/C for quick answer
  const handler = (e) => {
    const key = e.key.toUpperCase();
    if (["A","B","C"].includes(key)) { selectAnswer(q.number, key); }
    else if (e.key === "ArrowLeft") goBack();
    else if (e.key === "ArrowRight" && selected) goNext();
  };
  mountEl._keyHandler && document.removeEventListener("keydown", mountEl._keyHandler);
  mountEl._keyHandler = handler;
  document.addEventListener("keydown", handler);
}

function buildHeader() {
  const wrap = el("div", { class: "quiz-progress-row" });
  wrap.appendChild(el("span", { class: "step-counter" }, `Vraag ${currentIdx + 1} van ${questions.length}`));
  const progress = el("div", { class: "quiz-progress", "aria-hidden": "true" });
  for (let i = 0; i < questions.length; i++) {
    const cell = el("div", { class: "quiz-progress-cell" });
    if (i < currentIdx) cell.classList.add("is-done");
    if (i === currentIdx) cell.classList.add("is-current");
    progress.appendChild(cell);
  }
  wrap.appendChild(progress);
  return wrap;
}

function selectAnswer(qNumber, letter) {
  answers[qNumber] = letter;
  Quiz.saveAnswers(answers);
  render();
}

function goNext() {
  if (!answers[questions[currentIdx].number]) return;
  currentIdx++;
  if (currentIdx >= questions.length) {
    computeAndStoreResult();
  }
  render();
}

function goBack() {
  if (currentIdx === 0) return;
  currentIdx--;
  render();
}

function computeAndStoreResult() {
  const tally = { A: 0, B: 0, C: 0 };
  for (const q of questions) {
    const a = answers[q.number];
    if (a && tally[a] !== undefined) tally[a]++;
  }
  // Most-frequent. Ties broken by order A > B > C (favor lower maturity, matches PDF prompt).
  const winner = ["A","B","C"].reduce((best, k) => tally[k] > tally[best] ? k : best, "A");
  const profile = mapping[winner];
  Profile.set(profile);
  Quiz.saveResult({ profile, tally, when: new Date().toISOString() });
}

function renderResult() {
  const result = Quiz.getResult();
  if (!result) { renderRetake(); return; }
  const meta = profileMeta[result.profile] || {};
  const iconName = PROFILE_ICONS[result.profile] || "user";

  mountEl.innerHTML = "";
  const wrap = el("div", { class: "quiz-result" });

  const header = el("div", { class: "quiz-result-header reveal is-visible" });
  header.appendChild(el("div", { class: "quiz-result-eyebrow" }, "Uw organisatieprofiel"));
  const portrait = el("div", { class: "quiz-result-portrait", "aria-hidden": "true" });
  portrait.innerHTML = Icons[iconName] || Icons.user;
  header.appendChild(portrait);
  header.appendChild(el("h1", { class: "quiz-result-name" }, meta.name || result.profile));
  header.appendChild(el("p", { class: "quiz-result-tagline" }, meta.tagline || ""));
  wrap.appendChild(header);

  // Tally
  const tallyRow = el("div", { class: "quiz-result-tally", "aria-label": "Telling van antwoorden" });
  const winnerLetter = Object.entries(mapping).find(([k, v]) => v === result.profile)?.[0] || "A";
  for (const letter of ["A","B","C"]) {
    const profileSlug = mapping[letter];
    const pmeta = profileMeta[profileSlug] || {};
    const pill = el("div", { class: "tally-pill" + (letter === winnerLetter ? " is-winner" : "") });
    pill.appendChild(el("span", { class: "count" }, String(result.tally[letter] || 0)));
    pill.appendChild(el("span", {}, `× ${letter} · ${pmeta.label || profileSlug}`));
    tallyRow.appendChild(pill);
  }
  wrap.appendChild(tallyRow);

  wrap.appendChild(el("blockquote", { class: "quiz-result-description" }, meta.description || ""));

  const actions = el("div", { class: "quiz-result-actions" });
  const primary = el("a", { class: "btn btn-primary btn-lg", href: `playbook.html?profile=${encodeURIComponent(result.profile)}` });
  primary.innerHTML = `<span>Bekijk uw playbook</span>` + Icons.arrowRight;
  actions.appendChild(primary);

  const persoonlijk = el("a", {
    class: "btn btn-ghost",
    href: "playbook.html?profile=persoonlijk",
    onclick: () => { Profile.set("persoonlijk"); },
  }, "Liever zelf samenstellen? → Persoonlijk");
  actions.appendChild(persoonlijk);

  const retake = el("button", { class: "btn-link", type: "button", onclick: retakeQuiz }, "Quiz opnieuw doen");
  actions.appendChild(retake);

  wrap.appendChild(actions);

  // Helpful next nudges
  const tips = el("div", {
    class: "card card-soft reveal is-visible",
    style: { marginTop: "var(--sp-12)", padding: "var(--sp-6)" },
  });
  tips.appendChild(el("h3", {}, "Goed om weten"));
  tips.appendChild(el("p", { class: "text-soft" },
    "Het organisatieprofiel is een leidraad — geen oordeel. U kunt op elk moment van profiel wisselen via de bovenbalk."));
  wrap.appendChild(tips);

  mountEl.appendChild(wrap);
}

function renderRetake() {
  mountEl.innerHTML = "";
  const wrap = el("div", { class: "quiz-result" });
  wrap.appendChild(el("h1", { class: "quiz-result-name" }, "Quiz nog niet voltooid"));
  wrap.appendChild(el("p", { class: "quiz-result-tagline" }, "Beantwoord de zes vragen om uw organisatieprofiel te bepalen."));
  const a = el("button", { class: "btn btn-primary", type: "button", onclick: retakeQuiz });
  a.innerHTML = `<span>Start de quiz</span>` + Icons.arrowRight;
  wrap.appendChild(a);
  mountEl.appendChild(wrap);
}

function retakeQuiz() {
  answers = {};
  Quiz.saveAnswers({});
  Quiz.saveResult(null);
  currentIdx = 0;
  render();
}
