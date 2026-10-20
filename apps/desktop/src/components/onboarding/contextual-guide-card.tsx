import { useEffect, useRef, useState, type ElementType } from "react";
import { Button } from "../ui/button";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { contextualGuides, type ContextualGuideId, type GuideMedia } from "./contextual-guides";
import "./contextual-guide-card.css";

type Props = { id: ContextualGuideId; onDone: () => void; title?: ElementType; titleId?: string };

const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function GuideVideo({ media, label }: { media: GuideMedia; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const position = useRef(0);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // Switching between clips of the same capture keeps the moment in view.
    if (position.current) video.currentTime = position.current;
    if (!prefersReducedMotion()) video.play().catch(() => {});
  }, [media.video]);
  return <video ref={ref} className="contextual-guide-media" src={media.video} poster={media.poster} aria-label={label}
    muted loop playsInline preload="metadata" onTimeUpdate={event => { position.current = event.currentTarget.currentTime; }}
    onClick={event => { const video = event.currentTarget; if (video.paused) video.play().catch(() => {}); else video.pause(); }} />;
}

export function ContextualGuideCard({ id, onDone, title: Title = "h2", titleId }: Props) {
  const guide = contextualGuides[id];
  const [index, setIndex] = useState(0);
  const media = guide.media;
  const current = media[Math.min(index, media.length - 1)];
  const slide = "slides" in guide ? guide.slides[index] : undefined;
  const carousel = guide.pattern === "carousel";
  const last = !carousel || index >= media.length - 1;

  useEffect(() => {
    if (!("animate" in guide) || !guide.animate || prefersReducedMotion() || index >= media.length - 1) return;
    const timer = window.setTimeout(() => setIndex(value => value + 1), 1400);
    return () => window.clearTimeout(timer);
  }, [guide, index, media.length]);

  return <div className={`contextual-guide contextual-guide-${guide.pattern}`} data-guide={id}>
    <div className="contextual-guide-stage">
      <div className="contextual-guide-clip">
        {current.video
          ? <GuideVideo media={current} label={`${guide.alt} ${current.label}`} />
          : <img key={current.image} className="contextual-guide-media" src={current.image} alt={guide.alt} width={1280} height={720} draggable={false} />}
      </div>
      {guide.pattern === "inline" && media.length > 1 && <SegmentedControl className="contextual-guide-segments" aria-label="Trajectory" value={String(index)}
        onValueChange={value => setIndex(Number(value))}>
        {media.map((item, itemIndex) => <SegmentedControlItem key={item.label} value={String(itemIndex)}>{item.label}</SegmentedControlItem>)}
      </SegmentedControl>}
    </div>
    <div className="contextual-guide-body">
      <Title id={titleId} className="contextual-guide-title">{slide?.title ?? guide.title}</Title>
      {(slide?.body ?? ("body" in guide ? guide.body : undefined)) && <p className="contextual-guide-copy">{slide?.body ?? ("body" in guide ? guide.body : "")}</p>}
      {"benefits" in guide && <ul className="contextual-guide-benefits">
        {guide.benefits.map(item => <li key={item.lead}><strong>{item.lead}</strong> {item.text}</li>)}
      </ul>}
      <div className="contextual-guide-actions">
        <Button size={guide.pattern === "inline" ? "xs" : "default"} variant={guide.pattern === "inline" ? "secondary" : "default"}
          onClick={() => { if (last) onDone(); else setIndex(index + 1); }}>{last ? (carousel ? "Done" : "Got it") : "Next"}</Button>
      </div>
      {carousel && <div className="contextual-guide-dots" role="group" aria-label="Pages">
        {media.map((item, itemIndex) => <button key={item.label} type="button" className="contextual-guide-dot" aria-label={`${itemIndex + 1}: ${item.label}`}
          aria-pressed={itemIndex === index} onClick={() => setIndex(itemIndex)} />)}
      </div>}
    </div>
  </div>;
}
