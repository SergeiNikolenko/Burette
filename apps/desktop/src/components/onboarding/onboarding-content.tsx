import type { ViewerPreferences } from "../../types";
import { Button } from "../ui/button";
import { DialogFooter, DialogTitle } from "../ui/dialog";
import { ArrowLeft, ArrowRight, Edit as Pencil, FileUpload, FolderPlus, Check } from "../ui/app-icons";
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
      <GuideVisual welcome={welcome} screen={welcome ? (["launcher", "appearance", "start"] as const)[step] : current} />
      <div className="flex flex-col gap-5 px-7 pb-6 pt-5">
        <Title className="text-center text-balance text-xl leading-7 font-semibold tracking-tight">{title}</Title>
        {welcome ? <>
          {step === 0 && <p className="text-center text-pretty text-sm leading-6">Draw a molecule, explore it in 3D, and keep related files together.</p>}
          {step === 1 && <div className="flex flex-col items-center gap-4 py-2">
            <ThemeModeControl value={props.theme} onChange={props.onThemeChange} />
            <div className="grid w-68 max-w-full grid-cols-3 gap-4 text-center text-sm"><span>System</span><span>Light</span><span>Dark</span></div>
          </div>}
          {step === 2 && <div className="grid gap-3 sm:grid-cols-3">
            <Button variant="outline" className="h-auto min-h-24 flex-col gap-3 rounded-xl py-4" onClick={() => props.onCompleteWelcome("file")}><FileUpload className="size-7" aria-hidden />Open file</Button>
            <Button variant="outline" className="h-auto min-h-24 flex-col gap-3 rounded-xl py-4" onClick={() => props.onCompleteWelcome("draw")}><Pencil className="size-7" aria-hidden />Draw a molecule</Button>
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
          <ul className="space-y-3 text-[13px] leading-5">
            {guide.tips.map(tip => <li key={tip} className="flex items-start gap-3"><Check className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{tip}</span></li>)}
          </ul>
          <DialogFooter className="flex-col gap-2 pt-1">
            <Button className="h-11 w-full rounded-full" onClick={props.onPrimary}>{guide.primaryLabel}<ArrowRight className="size-4" aria-hidden /></Button>
            <Button variant="ghost" className="h-8 rounded-full text-xs" onClick={props.onStopTips}>Don't show tips</Button>
          </DialogFooter>
        </>}
      </div>
  </>;
}
