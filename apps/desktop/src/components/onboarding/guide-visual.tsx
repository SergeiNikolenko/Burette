import { useState } from "react";
import { ArrowRotateCcw } from "../ui/app-icons";
import { Button } from "../ui/button";
import "./guide-visual.css";

type Screen = "launcher" | "appearance" | "start";
const treatments: Record<Screen, { image: string; treatment: string }> = {
  launcher: { image: "sketch", treatment: "welcome" },
  appearance: { image: "settings", treatment: "settings" },
  start: { image: "scene", treatment: "scene" },
};

function ProductScreen({ imageKey, className = "" }: { imageKey: string; className?: string }) {
  return <img className={`guide-product-screen ${className}`} src={`/onboarding/${imageKey}.png`}
    width={960} height={600} fetchPriority="high" alt="" draggable={false} />;
}

// The three first-run steps; contextual guides use ContextualGuideCard.
export function GuideVisual({ screen }: { screen: Screen }) {
  const [replay, setReplay] = useState(0);
  const { image, treatment } = treatments[screen];
  const animatedWelcome = screen === "launcher";
  return <div className={`guide-visual guide-palette-rose guide-treatment-${treatment}`} data-guide-screen={screen}>
    <div aria-hidden="true">
      <div className="guide-aurora guide-aurora-one" />
      <div className="guide-aurora guide-aurora-two" />
      <div key={`${screen}-${replay}`} className="guide-visual-stage">
        {animatedWelcome ? <>
          <ProductScreen imageKey="sketch" className="guide-welcome-sketch" />
          <ProductScreen imageKey="illustration" className="guide-welcome-structure" />
        </> : <ProductScreen imageKey={image} />}
      </div>
    </div>
    {animatedWelcome && <Button variant="ghost" size="sm" className="guide-replay rounded-full" onClick={() => setReplay(value => value + 1)} aria-label="Replay welcome animation">
      <ArrowRotateCcw className="size-3.5" aria-hidden />Replay
    </Button>}
  </div>;
}
