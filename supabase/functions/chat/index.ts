// Supabase Edge Function: chat
// Proxies OpenRouter chat completions (streaming) for the AI Playbook Vlaanderen frontend.
//
// Secrets:
//   OPENROUTER_API_KEY            (required)  set via: supabase secrets set OPENROUTER_API_KEY=sk-or-...
//   SUPABASE_URL                  (optional)  for lead logging — set to your project URL
//   SUPABASE_SERVICE_ROLE_KEY     (optional)  service_role key — only set if you want lead logging
//
// If the optional Supabase env vars are absent, lead logging is silently skipped.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Max-Age": "86400",
};

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

interface ChatRequest {
  kind?: "chat" | "lead";
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  context?: { title?: string; path?: string[]; text?: string };
  mode?: "section" | "selection" | "global";
  model?: string;
  email?: string;
  profile?: string;
}

function profileBlurb(profile?: string): string {
  switch (profile) {
    case "verkenner": return "De gebruiker is een 'AI Verkenner' — eerste fase van AI-adoptie, focus op kleine stappen, quick wins, eenvoudige oplossingen.";
    case "piloot":    return "De gebruiker is een 'AI Piloot' — basis is gelegd, focus op identificeren van waardevolle use cases en organisatiebreed draagvlak.";
    case "expert":    return "De gebruiker is een 'AI Expert' — koploper, AI is al geïmplementeerd in processen, focus op opschalen.";
    case "persoonlijk": return "De gebruiker volgt een 'Persoonlijk' plan — stelt zelf een stappenplan samen uit alle activiteiten.";
    default: return "";
  }
}

function buildSystemPrompt(req: ChatRequest): string {
  const base = [
    "Je bent een behulpzame assistent voor de interactieve gids op basis van het AI Playbook van Digitaal Vlaanderen.",
    "Antwoord altijd in het Nederlands, beknopt en helder. Gebruik korte alinea's of bullet points.",
    "Houd je strikt aan de aangereikte context wanneer die er is. Verzin geen feiten, hallucineer geen activiteiten.",
    "Als de gebruiker iets vraagt dat buiten de context valt: zeg dat eerlijk en verwijs naar de bron-PDF.",
    "Vermeld waar mogelijk de sectienummers (bv. '§ 1.1.1') zodat de gebruiker de bron kan vinden.",
  ];
  const p = profileBlurb(req.profile);
  if (p) base.push("", p);
  if (req.mode === "global") {
    base.push("", "De gebruiker bevraagt het hele playbook. Verwijs naar de relevante sectie waar mogelijk.");
  }
  if (req.context?.title) {
    base.push("", "Huidige gepinde context:");
    if (req.context.path?.length) base.push(`Pad: ${req.context.path.join(" › ")}`);
    base.push(`Titel: ${req.context.title}`);
    if (req.context.text) {
      base.push("Tekst:");
      base.push(req.context.text.slice(0, 8000));
    }
  }
  return base.join("\n");
}

async function logLead(email: string, profile?: string): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return; // silently skip if not configured
  if (!email) return;
  try {
    // Upsert into playbook_leads. Requires the table to exist:
    //   create table playbook_leads (
    //     email text primary key,
    //     profile text,
    //     first_seen timestamptz not null default now(),
    //     last_seen timestamptz not null default now()
    //   );
    const now = new Date().toISOString();
    await fetch(`${url}/rest/v1/playbook_leads?on_conflict=email`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ email, profile: profile ?? null, last_seen: now }),
    });
  } catch (err) {
    console.warn("lead log failed:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError(405, "Only POST is allowed");
  }

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch (_) {
    return jsonError(400, "Invalid JSON body");
  }

  // Lead-only ping (used by the email gate to register the user without sending a message).
  if (body.kind === "lead") {
    if (!body.email) return jsonError(400, "email required for lead kind");
    await logLead(body.email, body.profile);
    return jsonOk({ ok: true });
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return jsonError(500, "OPENROUTER_API_KEY is not configured on the server");

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError(400, "messages[] is required");
  }

  // Best-effort lead log on every chat (idempotent — upsert on email).
  if (body.email) logLead(body.email, body.profile).catch(() => {});

  const systemPrompt = buildSystemPrompt(body);
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...body.messages.filter((m) => m.role !== "system"),
  ];

  const upstream = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/", // generic — override in deploy if you have a custom URL
      "X-Title": "AI Playbook Vlaanderen — Interactieve gids",
    },
    body: JSON.stringify({
      model: body.model || DEFAULT_MODEL,
      messages,
      stream: true,
      temperature: 0.4,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return jsonError(upstream.status, `OpenRouter error: ${errText.slice(0, 500)}`);
  }

  return new Response(upstream.body, {
    headers: {
      ...corsHeaders,
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
  });
});
