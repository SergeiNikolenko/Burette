import { useEffect, useState } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { OnboardingContent, type WelcomeStep } from "./onboarding-content";
import { readOnboardingProgress, resetOnboardingEvent, saveOnboardingProgress, type OnboardingProgress } from "./progress";
export { resetOnboarding } from "./progress";

type Props = { state: ShellViewState; actions: ShellActions };

export function OnboardingHost(props: Props) {
  if (typeof window === "undefined" || window.BuretteMcpWorkspace || window.__BURETTE_HOSTED_MCP_WIDGET__) return null;
  return <LocalOnboarding {...props} />;
}

function LocalOnboarding({ state, actions }: Props) {
  const [progress, setProgress] = useState(() => readOnboardingProgress(state));
  const [step, setStep] = useState<WelcomeStep>(0);
  const welcome = progress.enabled && !progress.welcomeCompleted;

  useEffect(() => {
    const reset = () => { setStep(0); setProgress(readOnboardingProgress()); };
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
  return <Dialog open={welcome} onOpenChange={next => { if (!next) dismiss(); }}>
    <DialogContent variant="form" size="medium" className="gap-0 overflow-x-hidden overscroll-contain p-0" aria-describedby={undefined}>
      <OnboardingContent dialog welcome step={step} theme={state.preferences.theme}
        onThemeChange={theme => actions.setPreference("theme", theme)} onStepChange={setStep} onStopTips={dismiss}
        onCompleteWelcome={action => completeWelcome(action ? ({ file: actions.chooseFiles, draw: actions.openKetcher, folder: actions.chooseWorkspace })[action] : undefined)} />
    </DialogContent>
  </Dialog>;
}
