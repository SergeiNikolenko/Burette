import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isTauriRuntime } from "../../lib/tauri";
import type { ShellActions, ShellViewState } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { ContextualGuideHost } from "./contextual-guide-host";
import { AtomIntro, presentIntro, type IntroOutcome } from "./intro/atom-intro";
import { OnboardingContent, type WelcomeStep } from "./onboarding-content";
import { readOnboardingProgress, resetOnboardingEvent, saveOnboardingProgress, type OnboardingProgress } from "./progress";
export { resetOnboarding } from "./progress";
export { requestContextualGuide } from "./request";

type Props = { state: ShellViewState; actions: ShellActions };

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function OnboardingHost(props: Props) {
  if (typeof window === "undefined" || window.BuretteMcpWorkspace || window.__BURETTE_HOSTED_MCP_WIDGET__) return null;
  return <LocalOnboarding {...props} />;
}

function LocalOnboarding({ state, actions }: Props) {
  const [progress, setProgress] = useState(() => readOnboardingProgress(state));
  const [step, setStep] = useState<WelcomeStep>(0);
  const welcome = progress.enabled && !progress.welcomeCompleted;
  // The native shell holds a fresh install's first window back for the opening.
  const [launchIntro] = useState(() => window.__BURETTE_INTRO__ === true && welcome && !reducedMotion());
  const [intro, setIntro] = useState(launchIntro);

  useEffect(() => {
    // A held window waits for an answer; without the opening it appears as usual.
    if (window.__BURETTE_INTRO__ && !launchIntro) void presentIntro({ kind: "settle" });
  }, [launchIntro]);

  useEffect(() => {
    const reset = () => {
      setStep(0);
      setProgress(readOnboardingProgress());
      if (isTauriRuntime() && !reducedMotion()) setIntro(true);
    };
    window.addEventListener(resetOnboardingEvent, reset);
    return () => window.removeEventListener(resetOnboardingEvent, reset);
  }, []);

  const updateProgress = (update: (previous: OnboardingProgress) => OnboardingProgress) => {
    const next = update(readOnboardingProgress(state));
    saveOnboardingProgress(next);
    setProgress(next);
  };
  const dismiss = () => updateProgress(previous => ({ ...previous, enabled: false, welcomeCompleted: true }));
  const completeWelcome = (action?: () => unknown) => {
    updateProgress(previous => ({ ...previous, welcomeCompleted: true, seen: [...new Set([...previous.seen, "launcher" as const])] }));
    action?.();
  };
  // The opening already greets the user, so the welcome continues from appearance.
  const finishIntro = (outcome: IntroOutcome) => {
    setIntro(false);
    setStep(outcome === "finished" ? 1 : 0);
  };
  // The welcome takes focus itself: at appearance, focusing the first option would open its tooltip over the title.
  const focusWelcome = (event: Event) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).focus();
  };
  return <>
  <ContextualGuideHost />
  {/* The app shell is hidden while the opening plays, so the opening renders beside it. */}
  {intro && createPortal(<AtomIntro theme={state.preferences.theme} onDone={finishIntro} />, document.body)}
  <Dialog open={welcome && !intro} onOpenChange={next => { if (!next) dismiss(); }}>
    <DialogContent variant="form" size="medium" className="gap-0 overflow-x-hidden overscroll-contain p-0" aria-describedby={undefined} onOpenAutoFocus={focusWelcome}>
      <OnboardingContent dialog step={step} theme={state.preferences.theme}
        onThemeChange={theme => actions.setPreference("theme", theme)} onStepChange={setStep} onStopTips={dismiss}
        onCompleteWelcome={action => completeWelcome(action ? ({ file: actions.chooseFiles, draw: actions.openKetcher, folder: actions.chooseWorkspace })[action] : undefined)} />
    </DialogContent>
  </Dialog>
  </>;
}
