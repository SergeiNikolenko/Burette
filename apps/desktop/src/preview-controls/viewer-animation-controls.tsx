import React, { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { SegmentedControl, SegmentedControlItem } from "../components/ui/segmented-control";
import { Slider } from "../components/ui/slider";

type Choice = [string, string, string?];
type Range = { min: number; max: number; step: number };
type SliderSpec = Range & { name: string; label: string; digits: number; unit?: string; needs?: string };
type Snapshot = {
  motion: { name: string; speed: number };
  wiggle: { name: string; animation: Record<string, number | string> } | null;
};
type Options = {
  read: () => Snapshot;
  motions: Choice[];
  speeds: Record<string, Range & { value: number }>;
  wiggles: Choice[];
  modes: Choice[];
  sliders: SliderSpec[];
  motion: (name: string, speed?: number) => void;
  wiggle: (action: "kind" | "mode", value: string) => void;
  slider: (name: string, value: number) => void;
  resize: () => void;
};

// The scientific scene remains the source of truth. Only the view is React;
// callbacks still use the viewer's existing motion and coalesced wiggle writes.
export function mountViewerAnimationControls(container: HTMLElement, options: Options) {
  const root = createRoot(container);
  let snapshot = options.read();
  let disposed = false;
  const refresh = () => { if (!disposed) { snapshot = options.read(); render(); } };
  const render = () => root.render(<AnimationControls snapshot={snapshot} options={options}
    onMotion={(name, speed) => { options.motion(name, speed); refresh(); }}
    onSlider={(name, value) => {
      if (!snapshot.wiggle) return;
      snapshot = { ...snapshot, wiggle: { ...snapshot.wiggle, animation: { ...snapshot.wiggle.animation, [name]: value } } };
      render();
      options.slider(name, value);
    }} />);
  flushSync(render);
  return { refresh, dispose: () => { disposed = true; root.unmount(); } };
}

function AnimationControls({ snapshot, options, onMotion, onSlider }: {
  snapshot: Snapshot; options: Options;
  onMotion: Options["motion"]; onSlider: Options["slider"];
}) {
  useLayoutEffect(options.resize);
  const { motion, wiggle } = snapshot;
  const limits = options.speeds[motion.name];
  const speed = Number.isFinite(motion.speed) ? motion.speed : limits?.value ?? 0;
  return <>
    <fieldset className="buret-animation-section">
      <legend>Motion</legend>
      <SegmentedControl aria-label="Scene motion" value={motion.name} onValueChange={name => onMotion(name)}>
        {options.motions.map(([value, label]) => <SegmentedControlItem key={value} value={value}>{label}</SegmentedControlItem>)}
      </SegmentedControl>
      {limits && <AnimationSlider label="Speed" name="Motion speed" min={limits.min} max={limits.max} step={limits.step} value={speed} digits={2} unit="/s" onChange={value => onMotion(motion.name, value)} />}
    </fieldset>
    {wiggle && <fieldset className="buret-animation-section">
      <legend>Wiggle</legend>
      <SegmentedControl aria-label="Structure wiggle" value={wiggle.name} onValueChange={value => options.wiggle("kind", value)}>
        {options.wiggles.map(([value, label]) => <SegmentedControlItem key={value} value={value}>{label}</SegmentedControlItem>)}
      </SegmentedControl>
      {wiggle.name !== "off" && <>
        {options.sliders.filter(spec => !spec.needs || Number(wiggle.animation[spec.needs]) > 0).map(spec =>
          <AnimationSlider key={spec.name} {...spec} name={`Wiggle ${spec.label.toLowerCase()}`}
            value={Number(wiggle.animation[spec.name]) || 0} onChange={value => onSlider(spec.name, value)} />)}
        <SegmentedControl aria-label="Wiggle noise" value={String(wiggle.animation.wiggleMode)} onValueChange={value => options.wiggle("mode", value)}>
          {options.modes.map(([value, label, title]) => <SegmentedControlItem key={value} value={value} title={title}>{label}</SegmentedControlItem>)}
        </SegmentedControl>
      </>}
    </fieldset>}
  </>;
}

function AnimationSlider({ label, name, value, min, max, step, digits, unit = "", onChange }: Range & {
  label: string; name: string; value: number; digits: number; unit?: string; onChange: (value: number) => void;
}) {
  return <div className="buret-animation-slider">
    <div className="buret-animation-slider-label"><span>{label}</span><output>{value.toFixed(digits)}{unit}</output></div>
    <Slider aria-label={name} value={[value]} min={min} max={max} step={step} onValueChange={values => onChange(values[0])} />
  </div>;
}
