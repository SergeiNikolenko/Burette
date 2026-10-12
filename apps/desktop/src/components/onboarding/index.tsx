import { useEffect, useState } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { Dialog, DialogContent } from "../ui/dialog";
import { guideForState } from "./guides";
import { OnboardingContent, type WelcomeStep } from "./onboarding-content";
import { readOnboardingProgress, resetOnboardingEvent, saveOnboardingProgress } from "./progress";
export { resetOnboarding } from "./progress";

type Props = { state: ShellViewState; actions: ShellActions };

export function OnboardingHost(props: Props) {
  if (typeof window === "undefined" || window.BuretteMcpWorkspace || window.__BURETTE_HOSTED_MCP_WIDGET__) return null;
  return <LocalOnboarding {...props} />;
}

function LocalOnboarding({ state, actions }: Props) {
  const [progress, setProgress] = useState(() => readOnboardingProgress(state));
  const [step, setStep] = useState<WelcomeStep>(0);
  const current = guideForState(state);
  const welcome = progress.enabled && !progress.welcomeCompleted;
  const pendingFile = state.activeTab?.location.kind === "file" && !state.activeDocument;
  const contextual = progress.enabled && progress.welcomeCompleted && !progress.seen.includes(current) && !pendingFile;
  const open = welcome || contextual;

  useEffect(() => { saveOnboardingProgress(progress); }, [progress]);
  useEffect(() => {
    const reset = () => { setStep(0); setProgress({ enabled: true, welcomeCompleted: false, seen: [] }); };
    window.addEventListener(resetOnboardingEvent, reset);
    return () => window.removeEventListener(resetOnboardingEvent, reset);
  }, []);

  const dismiss = () => setProgress(previous => welcome
    ? { ...previous, enabled: false, welcomeCompleted: true }
    : { ...previous, seen: [...new Set([...previous.seen, current])] });
  const stopTips = () => setProgress(previous => ({ ...previous, enabled: false, welcomeCompleted: true }));
  const completeWelcome = (action?: () => unknown) => {
    setProgress(previous => ({ ...previous, welcomeCompleted: true, seen: [...new Set([...previous.seen, "launcher" as const, current])] }));
    action?.();
  };
  const start = (action: () => unknown) => { dismiss(); action(); };
  return <Dialog open={open} onOpenChange={next => { if (!next) dismiss(); }}>
    <DialogContent variant="form" size="wide" className="gap-0 overflow-x-hidden overscroll-contain p-0" aria-describedby={undefined}>
      {welcome ? <OnboardingContent dialog welcome step={step} theme={state.preferences.theme}
        onThemeChange={theme => actions.setPreference("theme", theme)} onStepChange={setStep} onStopTips={stopTips}
        onCompleteWelcome={action => completeWelcome(action ? ({ file: actions.chooseFiles, draw: actions.openKetcher, folder: actions.chooseWorkspace })[action] : undefined)} />
        : <OnboardingContent dialog welcome={false} screen={current} onStopTips={stopTips} onPrimary={() => {
          if (current === "launcher") start(actions.chooseFiles);
          else if (current === "settings") start(() => actions.openSettingsSection("appearance"));
          else if (current === "agent") start(() => actions.openSettingsSection("agent"));
          else dismiss();
        }} />}
    </DialogContent>
  </Dialog>;
}
