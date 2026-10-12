import type { ViewerPreferences } from "../../types";
import { Button } from "../ui/button";
import { DialogFooter, DialogTitle } from "../ui/dialog";
import { ArrowLeft, ArrowRight, Atom, FileUpload, FolderPlus } from "../ui/app-icons";
import { ThemeModeControl } from "../settings-panel/theme-mode-control";
import { guides, type GuideId } from "./guides";
import { GuideVisual } from "./guide-visual";

export const welcomeTitles = ["Welcome to Burette", "Choose your appearance", "Start with a structure"] as const;
export type WelcomeStep = 0 | 1 | 2;
export type WelcomeAction = "file" | "draw" | "folder";
type Props = { dialog?: boolean; onStopTips: () => void } & ({
  welcome: true; step: WelcomeStep; theme: ViewerPreferences["theme"];
  onThemeChange: (theme: ViewerPreferences["theme"]) => void;
  onStepChange: (step: WelcomeStep) => void;
  onCompleteWelcome: (action?: WelcomeAction) => void;
} | { welcome: false; screen: GuideId; onPrimary: () => void });

const contextLabels: Record<GuideId, string> = {
  "launcher": "Open a structure",
  "settings": "Choose appearance",
  "agent": "Open agent settings",
  "file": "Explore the structure",
  "grid": "Explore the collection",
  "mesoscale": "Explore the assembly",
  "illustration": "Create an illustration",
  "spectrum": "Inspect the spectrum",
  "ketcher": "Start drawing",
  "text-file": "Explore the file",
  "document": "Read the document",
  "chemical-space": "Explore chemical space",
  "pose-review": "Review the poses",
  "fep-setup": "Review the setup",
  "fep-network": "Explore the network",
  "jobs": "View calculations",
};

// Shared by the real first-visit dialog and the isolated overview gallery.
// This body owns no storage or workspace actions.
export function OnboardingContent(props: Props) {
  const welcome = props.welcome;
  const step = props.welcome ? props.step : 0;
  const current = props.welcome ? "launcher" : props.screen;
  const guide = guides[current];
  const title = welcome ? welcomeTitles[step] : guide.title;
  const Title = props.dialog ? DialogTitle : "h3";
  return <>
      <GuideVisual screen={welcome ? (["launcher", "appearance", "start"] as const)[step] : current} />
      <div className="flex flex-col gap-6 px-6 pb-6 pt-5 sm:px-8 sm:pb-8">
        <Title className="text-center text-balance text-2xl leading-8 font-semibold tracking-tight">{title}</Title>
        {welcome ? <>
          {step === 0 && <ul className="space-y-4 text-sm leading-6">
            <li className="flex items-start gap-3"><Atom className="mt-1 size-5 shrink-0" aria-hidden /><span><strong>Explore your structures.</strong> Inspect molecules, proteins, and large assemblies in 3D.</span></li>
            <li className="flex items-start gap-3"><FileUpload className="mt-1 size-5 shrink-0" aria-hidden /><span><strong>Work with collections.</strong> Compare molecules and their properties, then save your results.</span></li>
            <li className="flex items-start gap-3"><FolderPlus className="mt-1 size-5 shrink-0" aria-hidden /><span><strong>Keep everything together.</strong> Open structures, drawings, and notes in one workspace.</span></li>
          </ul>}
          {step === 1 && <div className="flex flex-col items-center gap-4 py-2">
            <ThemeModeControl value={props.theme} onChange={props.onThemeChange} />
            <div className="grid w-68 max-w-full grid-cols-3 gap-4 text-center text-sm"><span>System</span><span>Light</span><span>Dark</span></div>
          </div>}
          {step === 2 && <div className="grid gap-3 sm:grid-cols-3">
            <Button variant="outline" className="h-auto min-h-24 flex-col gap-3 rounded-xl py-4" onClick={() => props.onCompleteWelcome("file")}><FileUpload className="size-7" aria-hidden />Open file</Button>
            <Button variant="outline" className="h-auto min-h-24 flex-col gap-3 rounded-xl py-4" onClick={() => props.onCompleteWelcome("draw")}><Atom className="size-7" aria-hidden />Draw a molecule</Button>
            <Button variant="outline" className="h-auto min-h-24 flex-col gap-3 rounded-xl py-4" onClick={() => props.onCompleteWelcome("folder")}><FolderPlus className="size-7" aria-hidden />Add folder</Button>
          </div>}
          <div className="flex justify-center gap-2" aria-label={`Introduction, step ${step + 1} of 3`}>
            {[0, 1, 2].map(index => <span key={index} aria-hidden className={`h-1.5 rounded-full ${index === step ? "w-6 bg-(--color-text)" : "w-1.5 bg-(--color-border-strong)"}`} />)}
          </div>
          <DialogFooter className="justify-between">
            {step === 0 ? <Button variant="secondary" onClick={props.onStopTips}>Skip introduction</Button> : <Button variant="secondary" onClick={() => props.onStepChange((step - 1) as WelcomeStep)}><ArrowLeft className="size-4" aria-hidden />Back</Button>}
            {step < 2 ? <Button onClick={() => props.onStepChange((step + 1) as WelcomeStep)}>{step === 0 ? "Get started" : "Continue"}<ArrowRight className="size-4" aria-hidden /></Button>
              : <Button variant="secondary" onClick={() => props.onCompleteWelcome()}>Explore on my own</Button>}
          </DialogFooter>
        </> : <>
          <ul className="space-y-4 text-sm leading-6">
            {guide.tips.map((tip, index) => <li key={tip} className="flex items-start gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-(--color-background-primary-soft-alpha) text-xs" aria-hidden>{index + 1}</span><span>{tip}</span></li>)}
          </ul>
          <DialogFooter className="justify-between">
            <Button variant="secondary" onClick={props.onStopTips}>Don't show tips</Button>
            <Button onClick={props.onPrimary}>{contextLabels[current]}<ArrowRight className="size-4" aria-hidden /></Button>
          </DialogFooter>
        </>}
      </div>
  </>;
}
