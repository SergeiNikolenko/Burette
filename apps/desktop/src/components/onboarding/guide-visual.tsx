import { useState } from "react";
import { ArrowRotateCcw } from "../ui/app-icons";
import { Button } from "../ui/button";
import { guides, type GuideId } from "./guides";
import "./guide-visual.css";

type Screen = GuideId | "appearance" | "start";
const imageOverrides: Partial<Record<Screen, string>> = {
  appearance: "settings", start: "scene", "fep-setup": "network",
  "pose-review": "scene", "pose-compare": "poses", "pose-contacts": "scene",
};
const palettes: Record<string, string> = {
  Workspace: "rose", Structures: "sky", Collections: "mint", Export: "peach",
  Analysis: "violet", Editing: "peach", Poses: "ocean", Calculations: "mint",
  Trajectories: "violet", Scenes: "ocean", Files: "sky",
};
const treatments: Record<string, string> = {
  structure: "structure", scene: "scene", poses: "poses", trajectory: "trajectory",
  sketch: "sketch", panels: "panels", collection: "collection", settings: "settings",
  "chemical-space": "space", network: "network", illustration: "illustration",
};

function ProductScreen({ imageKey, className = "" }: { imageKey: string; className?: string }) {
  return <img className={`guide-product-screen ${className}`} src={`/onboarding/${imageKey}.${imageKey === "chemical-space" ? "jpg" : "png"}`}
    width={960} height={600} fetchPriority="high" alt="" draggable={false} />;
}

export function GuideVisual({ screen, welcome = false }: { screen: Screen; welcome?: boolean }) {
  const [replay, setReplay] = useState(0);
  const guide = screen === "appearance" || screen === "start" ? guides.launcher : guides[screen];
  const imageKey = imageOverrides[screen] ?? guide.imageKey;
  const animatedWelcome = welcome && screen === "launcher";
  const treatment = animatedWelcome ? "welcome" : treatments[imageKey] ?? "document";
  return <div className={`guide-visual guide-palette-${palettes[guide.category] ?? "sky"} guide-treatment-${treatment}`} data-guide-screen={screen}>
    <div aria-hidden="true">
      <div className="guide-aurora guide-aurora-one" />
      <div className="guide-aurora guide-aurora-two" />
      <div key={`${screen}-${replay}`} className="guide-visual-stage">
        {animatedWelcome ? <>
          <ProductScreen imageKey="sketch" className="guide-welcome-sketch" />
          <ProductScreen imageKey="illustration" className="guide-welcome-structure" />
        </> : <ProductScreen imageKey={imageKey} />}
      </div>
    </div>
    {animatedWelcome && <Button variant="ghost" size="sm" className="guide-replay rounded-full" onClick={() => setReplay(value => value + 1)} aria-label="Replay welcome animation">
      <ArrowRotateCcw className="size-3.5" aria-hidden />Replay
    </Button>}
  </div>;
}
