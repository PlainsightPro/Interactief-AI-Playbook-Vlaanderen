# AI Playbook · Interactieve gids voor Vlaanderen

Een onafhankelijke, interactieve web-versie van het *AI Playbook* van Digitaal Vlaanderen
(*Introductie* + *Kernactiviteiten*, versie mei 2026). Bezoekers bepalen in zes vragen
hun **organisatieprofiel** (Verkenner / Piloot / Expert) en krijgen daarna alleen de
activiteiten te zien die op hun situatie zijn afgestemd. Een AI-assistent
(Google Gemini Flash-Lite via OpenRouter, geproxied door één Supabase Edge Function)
beantwoordt vragen over hun eigen scope. Een vierde profiel — *Persoonlijk* — laat de
gebruiker zelf een stappenplan samenstellen.

- **Frontend:** statische HTML/CSS/JS, geen build-stap, host op GitHub Pages.
- **Backend:** één Supabase Edge Function (`supabase/functions/chat/`) die OpenRouter
  proxiet. De OpenRouter-key zit als Supabase secret, **nooit** in de frontend.
- **Branding:** Vlaanderen-stijl (geel `#FFE615` + zwart) met gestileerde leeuw,
  voorzichtige cinematic touches (Three.js particle drift, GSAP scroll-reveal,
  Lenis smooth scroll) — alles uitgeschakeld onder `prefers-reduced-motion`.
- **Toegankelijkheid:** WCAG 2.1 AA als hard doel.

> Deze webapp is **niet** gelieerd aan Digitaal Vlaanderen of de Vlaamse overheid.
> De bron-PDFs blijven authoritative — verifieer essentiële informatie altijd daar.

## Architectuur in één plaatje

```
[ Browser (statische bestanden van GitHub Pages) ]
        │  POST /functions/v1/chat   (Authorization: anon-key)
        ▼
[ Supabase Edge Function `chat` ]   ←  secret: OPENROUTER_API_KEY
        │  POST openrouter.ai/api/v1/chat/completions
        ▼
[ OpenRouter → google/gemini-2.5-flash-lite ]
```

De OpenRouter-key passeert nooit de browser. De Supabase anon-key staat in
`config.js` en is **publiek** veilig.

## Repository indeling

```
.
├── README.md                  ← dit bestand
├── _playbook_text.txt         ← raw text extract van de Kernactiviteiten-PDF (referentie)
├── _introductie_text.txt      ← raw text extract van de Introductie-PDF (referentie)
├── .env.example
├── .gitignore
├── scripts/
│   ├── extract.py             ← PDF → playbook.json + img/ (Kernactiviteiten)
│   ├── extract_introductie.py ← PDF → _introductie_text.txt (Introductie)
│   └── generate_summaries.mjs ← OpenRouter → data/summaries.json
├── supabase/
│   ├── config.toml
│   └── functions/chat/index.ts ← Edge Function (Deno/TypeScript)
├── index.html                  ← Landing (hero + disclaimer + CTA)
├── quiz.html                   ← 6-vragen quiz
├── playbook.html               ← Per-profiel matrix + AI-paneel
├── over.html                   ← Volledige disclaimer + privacy
├── styles.css                  ← Design-system (Vlaanderen tokens)
├── config.js                   ← ← EDIT VÓÓR DEPLOY (Supabase URL + anon key)
├── src/                        ← ES-modules (geen build)
│   ├── main.js                 ←   bootstrap (topbar/footer/Lenis)
│   ├── state.js                ←   localStorage state-store
│   ├── data.js                 ←   JSON loaders + activity walker
│   ├── email.js                ←   business-email validatie + blocklist
│   ├── icons.js                ←   inline SVG iconen + leeuw
│   ├── particles.js            ←   Three.js hero-drift
│   ├── quiz.js                 ←   quiz UI + scoring
│   ├── playbook.js             ←   matrix/phase view + filters
│   ├── chat.js                 ←   AI-paneel + email gate + streaming
│   └── utils.js                ←   $/el/storage/debounce/reveal
├── data/
│   ├── playbook.json           ← Kernactiviteiten (volledig gestructureerd)
│   ├── introductie.json        ← Introductie: quiz, pijlers, fasen, profielen
│   ├── summaries.json          ← Optioneel: AI-summary per sectie (begint leeg)
│   └── prepared_questions.json ← Starter-prompts voor het AI-paneel
└── img/                        ← Geëxtraheerde figuren + 4× stappenplan-PNG
```

## Setup (eerste keer)

### 1. PDFs extraheren (alleen als ze veranderen)

Vereist: Python 3 met `pymupdf` (`pip install pymupdf`).

```bash
# Kernactiviteiten → playbook.json + img/*.png
python scripts/extract.py

# Introductie (alleen ter referentie — de quiz/pijlers leven al in data/introductie.json)
python scripts/extract_introductie.py
```

`introductie.json` is met de hand gestructureerd op basis van de PDF-tekst.
Als de bron-PDF significant verandert, werk dan handmatig `data/introductie.json` bij.

### 2. AI-samenvattingen genereren (optioneel maar aanbevolen)

> Roteer eerst je OpenRouter key op <https://openrouter.ai/keys> — elke key
> die ooit in een chat of git-historie heeft gestaan moet als gelekt beschouwd worden.

```bash
cp .env.example .env
# Open .env en plak de NIEUWE key

node scripts/generate_summaries.mjs
```

Dit vult `data/summaries.json` met 2-4 zinnen Nederlands per sectie. Het script
is idempotent — opnieuw draaien is veilig. Zonder dit bestand toont de frontend een
fallback-samenvatting (eerste alinea uit de PDF).

### 3. Supabase voorbereiden

**a. Edge Function deployen.** Vereist [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase link --project-ref <PROJECT_REF>
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-jouw-nieuwe-key
supabase functions deploy chat --no-verify-jwt
```

`--no-verify-jwt` matched `verify_jwt = false` in `supabase/config.toml`.

**b. (Optioneel) Lead-logging tabel aanmaken.** Schakel dit alleen in als je
e-mails wil bewaren. Voer in de Supabase SQL-editor uit:

```sql
create table if not exists public.playbook_leads (
  email      text primary key,
  profile    text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

-- Service-role mag schrijven (de Edge Function gebruikt de service-role key).
-- We schakelen RLS in en geven anon GEEN toegang.
alter table public.playbook_leads enable row level security;
create policy "service-role only" on public.playbook_leads
  for all using (false);

-- Auto-update last_seen via trigger (Postgres-native upsert verzorgt dit
-- via "Prefer: resolution=merge-duplicates" in de Edge Function, maar voor
-- de zekerheid:)
create or replace function bump_last_seen() returns trigger language plpgsql as $$
begin new.last_seen := now(); return new; end; $$;
create trigger bump_playbook_leads_last_seen
  before update on public.playbook_leads
  for each row execute function bump_last_seen();
```

Voeg dan twee secrets aan de Edge Function toe:

```bash
supabase secrets set SUPABASE_URL=https://<project>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=ey... # service_role uit Project Settings → API
```

Als deze twee secrets ontbreken, slaat de Edge Function lead-logging stilzwijgend over.

**c. CORS-origin toevoegen.** Project Settings → API → CORS → voeg je GitHub Pages
URL toe (bv. `https://<jouw-user>.github.io`).

### 4. Frontend configureren

Open `config.js` en vul aan:

```js
window.AI_PLAYBOOK_CONFIG = {
  SUPABASE_URL: "https://<project>.supabase.co",
  SUPABASE_ANON_KEY: "ey...",          // anon (public) key — safe to commit
  CHAT_FUNCTION_PATH: "/functions/v1/chat",
  MODEL: "google/gemini-2.5-flash-lite",
  PRIVACY_CONTACT_EMAIL: "info@plainsight.pro",
  RETENTION_MONTHS: 24,
  ENABLE_PARTICLES: true,
  ENABLE_LEAD_LOG: true,
  DEMO_MODE_HINT: true,
};
```

> De **anon-key is publiek** en mag in je frontend & git staan. De OpenRouter-key NIET.

### 5. Lokaal draaien

```bash
python -m http.server 8000
# of
npx serve .
```

Open <http://localhost:8000>.

### 6. Deploy naar GitHub Pages

Een eenvoudige aanpak — publiceer de root vanaf `main`:

1. Maak een nieuwe GitHub-repo en push deze codebase.
2. Repo Settings → Pages → Source: `Deploy from a branch` → branch `main`, folder `/ (root)`.
3. Wacht ~1 minuut. Bezoek `https://<user>.github.io/<repo>/`.
4. Voeg die URL toe als CORS-origin in Supabase (stap 3c).

> Optioneel: gebruik een custom domain via Settings → Pages → Custom domain.
> Zet `CNAME` in de root met je domain als je daarvoor kiest.

## Veiligheid in één alinea

De OpenRouter-key zit enkel als Supabase secret. De browser stuurt chat-requests
naar `https://<project>.supabase.co/functions/v1/chat` met de publieke anon-key
als `Authorization`-header. De Edge Function leest de OpenRouter-key uit
`Deno.env.get("OPENROUTER_API_KEY")`, bouwt het system-prompt op basis van het
gekozen organisatieprofiel + de huidige sectie, en streamt het antwoord terug.
E-mailadressen voor de assistent worden gevalideerd in de browser (regex + blocklist
van ~50 publieke domeinen) en eventueel — als de optionele Supabase env vars gezet
zijn — opgeslagen in `playbook_leads`.

## Iets aanpassen

| Wat | Waar |
|-----|------|
| Andere LLM | `MODEL` in `config.js` (frontend default) of `DEFAULT_MODEL` in `supabase/functions/chat/index.ts` |
| Andere system-prompt | `buildSystemPrompt()` in `supabase/functions/chat/index.ts` |
| Andere kleuren / fonts | CSS custom properties bovenaan `styles.css` |
| Andere quiz-vragen | `data/introductie.json` (`quiz.questions[]`) |
| Andere starter-prompts | `data/prepared_questions.json` |
| Andere geblokkeerde e-maildomeinen | `BLOCKED_DOMAINS` in `src/email.js` |
| Disclaimer of privacy-tekst | `over.html` (en de Layer-1 kaart in `index.html`) |
| Bewaartermijn e-mails | `RETENTION_MONTHS` in `config.js` + over.html-tekst |

## Bekende beperkingen

- **Profile-mapping** (activiteit → fase per profiel) komt uit `playbook.json`,
  die op zijn beurt is opgebouwd op basis van de stappenplan-pagina's in de
  Introductie. Als de PDF verandert is `playbook.json` mogelijk niet meer
  in sync — re-extraheer en draai opnieuw.
- **AI-search** ("Vraag aan de hele playbook") stuurt context per gepinde sectie.
  Voor echte retrieval over de volledige inhoud zou je embeddings + vector search
  willen — buiten scope voor v1.
- **Chat-historie** wordt per gepinde context bewaard in `localStorage` van die
  browser, niet cross-device.
- **Vlaamse Leeuw** in deze gids is een gestileerde herhaling, **niet** de
  officiële Digitaal Vlaanderen lockup. Bij officiële samenwerking moet je
  toestemming vragen voor het exacte logo.
- **GitHub Pages serveert geen `.env`** — alleen statische bestanden. De
  Edge Function is een vereiste, niet optioneel: zonder Supabase werkt de
  chat-knop in *demo-modus* en geeft een "proxy niet geconfigureerd"-melding.

## Licentie & attribution

Code in deze repo: MIT (zie `LICENSE`).
Inhoudelijke teksten, quiz-vragen, pijlers, fasen en profielen komen uit het
AI Playbook van Digitaal Vlaanderen — © Vlaamse overheid · AI Expertisecentrum,
in samenwerking met KPMG en de Werkgroep AI-strategie.
