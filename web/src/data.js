// Data loaders: playbook.json, introductie.json, summaries.json, prepared_questions.json.
// Each loader caches the parsed JSON. All fetches are relative to the page they're loaded on.

const CACHE = {};

async function loadJson(path) {
  if (CACHE[path]) return CACHE[path];
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  CACHE[path] = await res.json();
  return CACHE[path];
}

export const Data = {
  playbook: () => loadJson("data/playbook.json"),
  introductie: () => loadJson("data/introductie.json"),
  summaries: () => loadJson("data/summaries.json").catch(() => ({})),
  preparedQuestions: () => loadJson("data/prepared_questions.json").catch(() => ({ global: [], byPillar: {}, byProfile: {} })),
};

// Walk the playbook activity tree and collect a flat list with parent paths.
// Pillars (level 1) themselves are NOT included — only their descendants.
// A "node" is an activity if it has a non-empty phase_by_profile mapping.
export function flattenActivities(playbook) {
  const out = [];
  function walk(node, parentTrail = []) {
    const trail = [...parentTrail, node.title];
    if (node.level && node.level >= 2) {
      out.push({ ...node, trail });
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child, trail);
    }
  }
  for (const pillar of playbook.pillars || []) {
    // Skip the pillar itself; walk its children with the pillar title as the
    // first breadcrumb.
    if (Array.isArray(pillar.children)) {
      for (const child of pillar.children) walk(child, [pillar.title]);
    }
  }
  return out;
}

// Test whether a node carries a phase tag for ANY profile.
function hasAnyPhase(a) {
  return a && a.phase_by_profile && Object.keys(a.phase_by_profile).length > 0;
}

// Filter activities to those applicable to the given profile.
// We only include nodes that:
//   (a) list the profile in `profiles[]`, AND
//   (b) have a phase tag for that profile (or any profile, as a fallback for persoonlijk).
// This avoids over-counting parent-sections whose children are the real activities.
export function activitiesForProfile(playbook, profile) {
  const all = flattenActivities(playbook).filter(hasAnyPhase);
  if (!profile || profile === "persoonlijk") return all;
  return all.filter(a => Array.isArray(a.profiles) && a.profiles.includes(profile) && a.phase_by_profile?.[profile] != null);
}

// Build a (pillar -> phase -> activity[]) matrix for the given profile.
export function buildMatrix(playbook, profile) {
  const activities = activitiesForProfile(playbook, profile);
  const matrix = {}; // pillarId -> phaseId -> activity[]
  for (const pillar of playbook.pillars || []) {
    matrix[pillar.id] = { meta: pillar, phases: { 1: [], 2: [], 3: [], 4: [], 5: [] } };
  }
  for (const a of activities) {
    const pillarId = a.id?.split("-")[0];
    if (!matrix[pillarId]) continue;
    const phase = a.phase_by_profile?.[profile] || (profile === "persoonlijk" ? null : null);
    const targetPhase = phase || (a.phase_by_profile?.verkenner) || (a.phase_by_profile?.piloot) || (a.phase_by_profile?.expert) || 1;
    if (matrix[pillarId].phases[targetPhase]) matrix[pillarId].phases[targetPhase].push(a);
  }
  return matrix;
}

// Summary lookup: returns the AI summary if available, otherwise an excerpt of own_text.
export function summaryFor(activity, summariesMap) {
  if (summariesMap && summariesMap[activity.id]) return summariesMap[activity.id];
  if (activity.own_text) {
    const first = activity.own_text.split(/\n\s*\n/)[0] || activity.own_text;
    return first.length > 280 ? first.slice(0, 280).trim() + "…" : first;
  }
  return "";
}
