// AI Playbook Vlaanderen — runtime configuration
// The anon key is PUBLIC and safe to commit. The OpenRouter key lives only as
// a Supabase secret on the server side (see README).

window.AI_PLAYBOOK_CONFIG = {
  // ---- Supabase Edge Function proxy ----
  // Example: "https://abcd1234.supabase.co"
  SUPABASE_URL: "https://mogdnvxiudlvwnpxqnki.supabase.co",

  // Publishable (public) key from Project Settings → API. Safe to commit.
  SUPABASE_ANON_KEY: "sb_publishable_LVRqEts8zYCAMDmqZvcjMg_fGSvrqyI",

  // Path to the deployed Edge Function (default matches supabase/functions/chat).
  CHAT_FUNCTION_PATH: "/functions/v1/chat",

  // Default LLM. Real OpenRouter model id. Swap without redeploying the function.
  MODEL: "google/gemini-2.5-flash-lite",

  // ---- Branding ----
  PRIVACY_CONTACT_EMAIL: "info@plainsight.pro",
  ATTRIBUTION: "Onafhankelijke interactieve gids op basis van het AI Playbook van Digitaal Vlaanderen.",
  RETENTION_MONTHS: 24,

  // ---- Feature flags ----
  ENABLE_PARTICLES: true,
  ENABLE_LEAD_LOG: true,

  // Auto-detected — if the URL above still has YOUR_PROJECT, demo mode kicks in
  // and the chat will explain the proxy is not yet configured.
  DEMO_MODE_HINT: true,
};
