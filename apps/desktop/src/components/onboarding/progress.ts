import type { ShellViewState } from "../types";
import { guides, type GuideId } from "./guides";

const storageKey = "burette.onboarding.v2";
const legacyKey = "burette.screen-guides.v1";
export const resetOnboardingEvent = "burette-reset-onboarding";
type ContextualBudget = { day: string; count: number; lastShownAt: number };
export type OnboardingProgress = { enabled: boolean; welcomeCompleted: boolean; seen: GuideId[]; contextual?: ContextualBudget };
let activeGuide: GuideId | null = null;
let sessionProgress: OnboardingProgress | undefined;

export function readOnboardingProgress(state?: ShellViewState): OnboardingProgress {
  try {
    const stored = localStorage.getItem(storageKey);
    let saved: Partial<OnboardingProgress> | null = null;
    try { saved = JSON.parse(stored ?? "null"); } catch { /* Ignore corrupt saved progress. */ }
    if (saved && typeof saved.enabled === "boolean" && typeof saved.welcomeCompleted === "boolean" && Array.isArray(saved.seen)) {
      const budget = saved.contextual;
      const contextual = budget && typeof budget.day === "string" && Number.isInteger(budget.count) && budget.count >= 0
        && Number.isFinite(budget.lastShownAt) && budget.lastShownAt >= 0 ? budget : undefined;
      return { enabled: saved.enabled, welcomeCompleted: saved.welcomeCompleted,
        seen: saved.seen.filter(id => typeof id === "string" && Object.hasOwn(guides, id)), contextual };
    }
    // An update must not present a new first-run flow to an established user,
    // even when their current workspace is empty or restoration is still pending.
    if ([legacyKey, "burette.shell", "burette.recent.structures"].some(key => localStorage.getItem(key) !== null)) {
      return { enabled: false, welcomeCompleted: true, seen: [] };
    }
  } catch { if (sessionProgress) return sessionProgress; }
  const fresh = !!state && state.documents.length === 0 && state.recentStructures.length === 0
    && state.sidebarProjects.length === 0 && state.tabs.every(tab => tab.location.kind === "launcher");
  return { enabled: fresh, welcomeCompleted: !fresh, seen: [] };
}

export function saveOnboardingProgress(progress: OnboardingProgress) {
  sessionProgress = progress;
  try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch { /* Session-only progress remains usable. */ }
}

// Call only from a feature the user just opened. Claims are never queued.
export function claimContextualGuide(id: GuideId): boolean {
  if (typeof window === "undefined" || window.BuretteMcpWorkspace || window.__BURETTE_HOSTED_MCP_WIDGET__ || activeGuide) return false;
  const progress = readOnboardingProgress();
  if (!progress.enabled || !progress.welcomeCompleted || progress.seen.includes(id)) return false;
  const now = Date.now();
  const date = new Date(now);
  const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const budget = progress.contextual;
  const count = budget?.day === day ? budget.count : 0;
  if (count >= 2 || (budget && now - budget.lastShownAt < 10 * 60 * 1000)) return false;
  activeGuide = id;
  saveOnboardingProgress({ ...progress, seen: [...progress.seen, id], contextual: { day, count: count + 1, lastShownAt: now } });
  return true;
}

export function markContextualGuideSeen(id: GuideId): void {
  if (typeof window === "undefined" || window.BuretteMcpWorkspace || window.__BURETTE_HOSTED_MCP_WIDGET__) return;
  const progress = readOnboardingProgress();
  if (!progress.seen.includes(id)) saveOnboardingProgress({ ...progress, seen: [...progress.seen, id] });
}

export function releaseContextualGuide(id: GuideId): void {
  if (activeGuide === id) activeGuide = null;
}

export function resetOnboarding() {
  activeGuide = null;
  saveOnboardingProgress({ enabled: true, welcomeCompleted: false, seen: [] });
  window.dispatchEvent(new Event(resetOnboardingEvent));
}
