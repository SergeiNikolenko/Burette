import { useEffect, useState } from "react";
import type { ShellActions, ShellViewState } from "../types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../ui/dialog";
import { ArrowLeft, ArrowRight, Atom, FileUpload, FolderPlus } from "../ui/app-icons";
import { ThemeModeControl } from "../settings-panel/theme-mode-control";
import { guideForState, guides, type GuideId } from "./guides";
import { GuideVisual } from "./guide-visual";
import { readOnboardingProgress, resetOnboardingEvent, saveOnboardingProgress } from "./progress";
export { resetOnboarding } from "./progress";

type Props = { state: ShellViewState; actions: ShellActions };

export function OnboardingHost(props: Props) {
  if (typeof window === "undefined" || window.BuretteMcpWorkspace || window.__BURETTE_HOSTED_MCP_WIDGET__) return null;
  return <LocalOnboarding {...props} />;
}

function LocalOnboarding({ state, actions }: Props) {
  const [progress, setProgress] = useState(() => readOnboardingProgress(state));
  const [step, setStep] = useState(0);
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
  const guide = guides[current];
  const title = welcome ? ["Welcome to Burette", "Choose your appearance", "Start with a structure"][step] : guide.title;
  const primary = contextAction(current, actions);

  return <Dialog open={open} onOpenChange={next => { if (!next) dismiss(); }}>
    <DialogContent variant="form" size="wide" className="gap-0 overflow-x-hidden overscroll-contain p-0" aria-describedby={undefined}>
      <GuideVisual screen={welcome ? (["launcher", "appearance", "start"] as const)[step] : current} />
      <div className="flex flex-col gap-6 px-6 pb-6 pt-5 sm:px-8 sm:pb-8">
        <DialogTitle className="text-center text-balance text-2xl leading-8 font-semibold tracking-tight">{title}</DialogTitle>
        {welcome ? <>
          {step === 0 && <ul className="space-y-4 text-sm leading-6">
            <li className="flex items-start gap-3"><Atom className="mt-1 size-5 shrink-0" aria-hidden /><span><strong>Explore your structures.</strong> Inspect molecules, proteins, and large assemblies in 3D.</span></li>
            <li className="flex items-start gap-3"><FileUpload className="mt-1 size-5 shrink-0" aria-hidden /><span><strong>Work with collections.</strong> Compare molecules and their properties, then save your results.</span></li>
            <li className="flex items-start gap-3"><FolderPlus className="mt-1 size-5 shrink-0" aria-hidden /><span><strong>Keep everything together.</strong> Open structures, drawings, and notes in one workspace.</span></li>
          </ul>}
          {step === 1 && <div className="flex flex-col items-center gap-4 py-2">
            <ThemeModeControl value={state.preferences.theme} onChange={theme => actions.setPreference("theme", theme)} />
            <div className="grid w-68 max-w-full grid-cols-3 gap-4 text-center text-sm"><span>System</span><span>Light</span><span>Dark</span></div>
          </div>}
          {step === 2 && <div className="grid gap-3 sm:grid-cols-3">
            <Button variant="outline" className="h-auto min-h-24 flex-col gap-3 rounded-xl py-4" onClick={() => completeWelcome(actions.chooseFiles)}><FileUpload className="size-7" aria-hidden />Open file</Button>
            <Button variant="outline" className="h-auto min-h-24 flex-col gap-3 rounded-xl py-4" onClick={() => completeWelcome(actions.openKetcher)}><Atom className="size-7" aria-hidden />Draw a molecule</Button>
            <Button variant="outline" className="h-auto min-h-24 flex-col gap-3 rounded-xl py-4" onClick={() => completeWelcome(actions.chooseWorkspace)}><FolderPlus className="size-7" aria-hidden />Add folder</Button>
          </div>}
          <div className="flex justify-center gap-2" aria-label={`Introduction, step ${step + 1} of 3`}>
            {[0, 1, 2].map(index => <span key={index} aria-hidden className={`h-1.5 rounded-full ${index === step ? "w-6 bg-(--color-text)" : "w-1.5 bg-(--color-border-strong)"}`} />)}
          </div>
          <DialogFooter className="justify-between">
            {step === 0 ? <Button variant="secondary" onClick={stopTips}>Skip introduction</Button> : <Button variant="secondary" onClick={() => setStep(value => value - 1)}><ArrowLeft className="size-4" aria-hidden />Back</Button>}
            {step < 2 ? <Button onClick={() => setStep(value => value + 1)}>{step === 0 ? "Get started" : "Continue"}<ArrowRight className="size-4" aria-hidden /></Button>
              : <Button variant="secondary" onClick={() => completeWelcome()}>Explore on my own</Button>}
          </DialogFooter>
        </> : <>
          <ul className="space-y-4 text-sm leading-6">
            {guide.tips.map((tip, index) => <li key={tip} className="flex items-start gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-(--color-background-primary-soft-alpha) text-xs" aria-hidden>{index + 1}</span><span>{tip}</span></li>)}
          </ul>
          <DialogFooter className="justify-between">
            <Button variant="secondary" onClick={stopTips}>Don't show tips</Button>
            <Button onClick={() => primary.action ? start(primary.action) : dismiss()}>{primary.label}<ArrowRight className="size-4" aria-hidden /></Button>
          </DialogFooter>
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}

function contextAction(screen: GuideId, actions: ShellActions): { label: string; action?: () => unknown } {
  switch (screen) {
    case "launcher": return { label: "Open a structure", action: actions.chooseFiles };
    case "settings": return { label: "Choose appearance", action: () => actions.openSettingsSection("appearance") };
    case "agent": return { label: "Open agent settings", action: () => actions.openSettingsSection("agent") };
    case "file": return { label: "Explore the structure" };
    case "grid": return { label: "Explore the collection" };
    case "mesoscale": return { label: "Explore the assembly" };
    case "illustration": return { label: "Create an illustration" };
    case "spectrum": return { label: "Inspect the spectrum" };
    case "ketcher": return { label: "Start drawing" };
    case "text-file": return { label: "Explore the file" };
    case "document": return { label: "Read the document" };
    case "chemical-space": return { label: "Explore chemical space" };
    case "pose-review": return { label: "Review the poses" };
    case "fep-setup": return { label: "Review the setup" };
    case "fep-network": return { label: "Explore the network" };
    case "jobs": return { label: "View calculations" };
  }
}
