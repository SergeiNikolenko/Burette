import type { ShellViewState } from "../types";
import { guides, type GuideId } from "./guides";

const storageKey = "burette.onboarding.v2";
const legacyKey = "burette.screen-guides.v1";
export const resetOnboardingEvent = "burette-reset-onboarding";
export type OnboardingProgress = { enabled: boolean; welcomeCompleted: boolean; seen: GuideId[] };

export function readOnboardingProgress(state: ShellViewState): OnboardingProgress {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<OnboardingProgress> | null;
    if (saved && typeof saved.enabled === "boolean" && typeof saved.welcomeCompleted === "boolean" && Array.isArray(saved.seen)) {
      return { enabled: saved.enabled, welcomeCompleted: saved.welcomeCompleted, seen: saved.seen.filter(id => Object.hasOwn(guides, id)) };
    }
    // An update must not present a new first-run flow to an established user,
    // even when their current workspace is empty or restoration is still pending.
    if ([legacyKey, "burette.shell", "burette.recent.structures"].some(key => localStorage.getItem(key) !== null)) {
      return { enabled: false, welcomeCompleted: true, seen: [] };
    }
  } catch { /* Storage restrictions never prevent opening the workspace. */ }
  const fresh = state.documents.length === 0 && state.recentStructures.length === 0
    && state.sidebarProjects.length === 0 && state.tabs.every(tab => tab.location.kind === "launcher");
  return { enabled: fresh, welcomeCompleted: !fresh, seen: [] };
}

export function saveOnboardingProgress(progress: OnboardingProgress) {
  try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch { /* Session-only progress remains usable. */ }
}

export function resetOnboarding() {
  saveOnboardingProgress({ enabled: true, welcomeCompleted: false, seen: [] });
  window.dispatchEvent(new Event(resetOnboardingEvent));
}
