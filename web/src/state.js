// Global app state — persisted to localStorage where appropriate.
// State is a small reactive store; views subscribe to `state.on(key, fn)`.

import { storage } from "./utils.js";

const KEYS = {
  profile:        "profile",        // 'verkenner' | 'piloot' | 'expert' | 'persoonlijk'
  email:          "email",          // string
  emailVerified:  "email-verified", // bool
  quizAnswers:    "quiz-answers",   // {1: "A", 2: "B", ...}
  quizResult:     "quiz-result",    // {profile, tally: {A,B,C}, when}
  pinnedActivities: "pinned-activities", // array of activity ids
  chatHistoryByContext: "chat-history-by-context", // { [contextId]: messages[] }
  view:           "view",           // 'pillar' | 'phase'  (for playbook view toggle)
  collapsedPillars: "collapsed-pillars", // [pillarId, ...]
};

class Store {
  constructor() {
    this._listeners = new Map(); // key -> Set<fn>
    this._cache = {};
    // Hydrate from storage
    for (const k of Object.values(KEYS)) {
      this._cache[k] = storage.get(k, null);
    }
  }

  get(key) { return this._cache[key]; }
  set(key, value) {
    this._cache[key] = value;
    storage.set(key, value);
    const listeners = this._listeners.get(key);
    if (listeners) for (const fn of listeners) try { fn(value); } catch (e) { console.error(e); }
  }
  remove(key) {
    delete this._cache[key];
    storage.remove(key);
    const listeners = this._listeners.get(key);
    if (listeners) for (const fn of listeners) try { fn(null); } catch (e) { console.error(e); }
  }
  on(key, fn) {
    if (!this._listeners.has(key)) this._listeners.set(key, new Set());
    this._listeners.get(key).add(fn);
    return () => this._listeners.get(key).delete(fn);
  }
}

export const state = new Store();
export { KEYS };

// Convenience getters/setters that hide the key strings.
export const Profile = {
  get: () => state.get(KEYS.profile),
  set: (p) => state.set(KEYS.profile, p),
  isSet: () => !!state.get(KEYS.profile),
};
export const Email = {
  get: () => state.get(KEYS.email),
  isVerified: () => !!state.get(KEYS.emailVerified),
  save: (email) => { state.set(KEYS.email, email); state.set(KEYS.emailVerified, true); },
  clear: () => { state.remove(KEYS.email); state.remove(KEYS.emailVerified); },
};
export const Quiz = {
  saveResult: (result) => state.set(KEYS.quizResult, result),
  getResult: () => state.get(KEYS.quizResult),
  saveAnswers: (answers) => state.set(KEYS.quizAnswers, answers),
  getAnswers: () => state.get(KEYS.quizAnswers) || {},
};
export const ChatHistory = {
  getFor: (contextId) => {
    const map = state.get(KEYS.chatHistoryByContext) || {};
    return map[contextId] || [];
  },
  appendFor: (contextId, msg) => {
    const map = state.get(KEYS.chatHistoryByContext) || {};
    if (!map[contextId]) map[contextId] = [];
    map[contextId].push(msg);
    state.set(KEYS.chatHistoryByContext, map);
  },
  clearFor: (contextId) => {
    const map = state.get(KEYS.chatHistoryByContext) || {};
    delete map[contextId];
    state.set(KEYS.chatHistoryByContext, map);
  },
  clearAll: () => state.remove(KEYS.chatHistoryByContext),
};
