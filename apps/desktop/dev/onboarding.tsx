import { useState } from "react";
import { createRoot } from "react-dom/client";
import { OnboardingContent, welcomeTitles, type WelcomeStep } from "@/components/onboarding/onboarding-content";
import { guides, type GuideId } from "@/components/onboarding/guides";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { buildThemeStyle } from "@/lib/theme";
import { defaultPreferences } from "@/stores/settings-store";
import type { ViewerPreferences } from "@/types";
import "../src/styles.css";
import "../src/styles/codex-tokens.css";
import "../src/styles/interface-tokens.css";

type Example = { id: string; title: string } & ({ step: WelcomeStep } | { screen: GuideId });
const introductions: Example[] = welcomeTitles.map((title, step) => ({ id: ["welcome", "appearance", "start"][step], title, step: step as WelcomeStep }));
const contexts: Example[] = (Object.keys(guides) as GuideId[]).map(screen => ({ id: `guide-${screen}`, title: guides[screen].title, screen }));
const examples = [...introductions, ...contexts];

function OnboardingGallery() {
  const [theme, setTheme] = useState<ViewerPreferences["theme"]>("light");
  const [preview, setPreview] = useState<Example | null>(null);
  const effectiveTheme = theme === "auto" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  const close = () => setPreview(null);
  const content = (example: Example, dialog = false) => "step" in example
    ? <OnboardingContent dialog={dialog} welcome step={example.step} theme={theme} onThemeChange={setTheme}
      onStepChange={step => setPreview(introductions[step])} onStopTips={close} onCompleteWelcome={close} />
    : <OnboardingContent dialog={dialog} welcome={false} screen={example.screen} onStopTips={close} onPrimary={close} />;
  const cards = (items: Example[]) => <div className="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
    {items.map(example => <article id={example.id} key={example.id} className="scroll-mt-6 overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-background-primary)">
      <div inert>{content(example)}</div>
      <div className="px-6 pb-6 sm:px-8">
        <Button variant="secondary" className="w-full" asChild>
          <a href={`#${example.id}`} aria-label={`Open ${example.title}`} onClick={() => setPreview(example)}>Open preview</a>
        </Button>
      </div>
    </article>)}
  </div>;
  return <main className={`app-shell ${effectiveTheme === "dark" ? "dark" : ""}`} data-runtime="browser" data-theme={theme} data-effective-theme={effectiveTheme}
    style={{ ...buildThemeStyle({ ...defaultPreferences, theme }, effectiveTheme), display: "block", overflowY: "auto", colorScheme: effectiveTheme, padding: "clamp(16px, 3vw, 40px)" }}>
    <div className="mx-auto flex max-w-400 flex-col gap-8">
      <a href="#first-visit-title" className="sr-only focus:not-sr-only">Skip to previews</a>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-balance text-3xl font-semibold tracking-tight">Getting started</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="screen-jump">Choose a screen</label>
          <select id="screen-jump" name="screen" className="h-9 max-w-56 rounded-lg border border-(--color-border) bg-(--color-background-primary) px-3 text-sm text-(--color-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ring)"
            defaultValue="" onChange={event => {
              const id = event.target.value;
              document.getElementById(id)?.scrollIntoView({ block: "start" });
              history.replaceState(null, "", `#${id}`);
            }}>
            <option value="" disabled>Choose a screen</option>
            {examples.map(example => <option key={example.id} value={example.id}>{example.title}</option>)}
          </select>
          <Button variant="secondary" aria-pressed={effectiveTheme === "light"} onClick={() => setTheme("light")}>Light</Button>
          <Button variant="secondary" aria-pressed={effectiveTheme === "dark"} onClick={() => setTheme("dark")}>Dark</Button>
        </div>
      </header>
      <section aria-labelledby="first-visit-title" className="flex flex-col gap-4">
        <h2 id="first-visit-title" className="scroll-mt-6 text-balance text-xl font-semibold">First visit</h2>
        {cards(introductions)}
      </section>
      <section aria-labelledby="screen-guides-title" className="flex flex-col gap-4">
        <h2 id="screen-guides-title" className="scroll-mt-6 text-balance text-xl font-semibold">Screen guides</h2>
        {cards(contexts)}
      </section>
    </div>
    <Dialog open={preview !== null} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent variant="form" size="wide" className="gap-0 overflow-x-hidden overscroll-contain p-0" aria-describedby={undefined}>
        {preview && content(preview, true)}
      </DialogContent>
    </Dialog>
  </main>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<OnboardingGallery />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
