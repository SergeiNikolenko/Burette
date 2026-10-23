import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { isTauriRuntime } from "../../../lib/tauri";
import type { ViewerPreferences } from "../../../types";
import { ArrowRight } from "../../ui/app-icons";
import { ATOM_ACTION, ATOM_CUE, ATOM_TITLE, atomParams, clamp, easeOut, range, spring } from "./atom-scene";
import { IntroCanvas } from "./intro-canvas";
import { introSound } from "./intro-sound";
import "./atom-intro.css";

/** A stage of the opening for the native window (`present_intro` in src-tauri/src/intro.rs). */
type IntroCue = { kind: "begin" } | { kind: "chrome" } | { kind: "undim"; seconds: number } | { kind: "settle" };
export type IntroOutcome = "finished" | "unavailable";
type Phase = "waiting" | "playing" | "skipping" | "leaving";

/** Resolves whether the shell accepted the cue; outside the desktop app every cue is accepted. */
export const presentIntro = (cue: IntroCue) =>
  isTauriRuntime() ? invoke("present_intro", { cue }).then(() => true, () => false) : Promise.resolve(true);

const SKIP_OUT_MS = 180;
const SKIP_IN_MS = 340;
const LEAVE_MS = 450;
const TITLE = "Welcome to Burette.";
const INK = "#0a0a0a";
const PAPER = "#ededed";

const readViewport = () => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 });
const centred = (y: number, width: number): CSSProperties => ({
  position: "absolute", left: "50%", top: `calc(50% + ${y * width}px)`, transform: "translate(-50%, -50%)",
});

type Props = { theme: ViewerPreferences["theme"]; onDone: (outcome: IntroOutcome) => void };

/**
 * Burette's first-launch opening, after Arc's: the desktop dims, the atom forms
 * and blooms into the window, the window gains its chrome as the dim lifts, and
 * the welcome line hands over to the app with one button.
 */
export function AtomIntro({ theme, onDone }: Props) {
  const [dark] = useState(() =>
    theme === "dark" || (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? 1 : 0);
  const [viewport, setViewport] = useState(readViewport);
  const [t, setT] = useState(0);
  const [phase, setPhase] = useState<Phase>("waiting");
  const phaseRef = useRef<Phase>("waiting");
  const start = useRef(0);
  const finished = useRef(false);
  const fired = useRef(new Set<string>());
  const timers = useRef<number[]>([]);
  const done = useRef(onDone);
  useLayoutEffect(() => { done.current = onDone; }, [onDone]);

  const enter = useCallback((next: Phase) => { phaseRef.current = next; setPhase(next); }, []);
  const later = useCallback((ms: number, work: () => void) => { timers.current.push(window.setTimeout(work, ms)); }, []);

  // The opening owns the window until it hands over: the app stays hidden beneath it.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.buretteIntro = "playing";
    const pending = timers.current;
    return () => {
      delete root.dataset.buretteIntro;
      pending.forEach(window.clearTimeout);
    };
  }, []);

  useEffect(() => {
    const resize = () => setViewport(readViewport());
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const gone = useRef(false);
  const unavailable = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    introSound.stop(0);
    void presentIntro({ kind: "settle" });
    done.current("unavailable");
  }, []);

  // The native window strips its chrome and dims the desktop; the clock and the
  // sound start with the first frame that reaches the screen.
  useEffect(() => {
    // The canvas failed during layout: the opening has already handed over.
    if (gone.current) return;
    let frame = 0;
    let last = 0;
    let cancelled = false;
    void presentIntro({ kind: "begin" }).then((accepted) => {
      if (cancelled) return;
      // Burette is not in front: the window is already ordinary, so the welcome opens there.
      if (!accepted) return unavailable();
      const tick = (now: number) => {
        if (!start.current) {
          start.current = now;
          last = now;
          introSound.play();
          if (phaseRef.current === "waiting") enter("playing");
        }
        // WebKit stops frames while the window is hidden or on another Space:
        // the opening pauses there instead of jumping ahead.
        const gap = now - last;
        if (gap > 250 && !finished.current) start.current += gap - 1000 / 60;
        last = now;
        setT(Math.max(0, (now - start.current) / 1000));
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      introSound.stop();
    };
  }, [enter, unavailable]);

  useEffect(() => {
    if (phase !== "playing") return;
    const once = (key: string, at: number, cue: IntroCue) => {
      if (t < at || fired.current.has(key)) return;
      fired.current.add(key);
      void presentIntro(cue);
    };
    once("chrome", ATOM_CUE.chrome, { kind: "chrome" });
    once("undim", ATOM_CUE.undim, { kind: "undim", seconds: ATOM_CUE.undimFor });
    once("settle", ATOM_CUE.settle, { kind: "settle" });
  }, [t, phase]);

  /** Fast-forwards to the welcome window: fade out, jump to the end, fade in. */
  const skip = useCallback(() => {
    const current = phaseRef.current;
    if (current === "skipping" || current === "leaving") return;
    if (start.current && performance.now() - start.current >= ATOM_CUE.settle * 1000) return;
    fired.current = new Set(["chrome", "undim", "settle"]);
    introSound.stop();
    void presentIntro({ kind: "undim", seconds: (SKIP_OUT_MS + SKIP_IN_MS) / 1000 });
    enter("skipping");
    later(SKIP_OUT_MS, () => {
      start.current = performance.now() - ATOM_CUE.end * 1000;
      finished.current = true;
      setT(ATOM_CUE.end);
      enter("playing");
      void presentIntro({ kind: "chrome" });
      later(SKIP_IN_MS, () => void presentIntro({ kind: "settle" }));
    });
  }, [enter, later]);

  // Escape skips; leaving the window mid-opening finishes it so no display stays dimmed.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      skip();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", skip);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", skip);
    };
  }, [skip]);

  const leave = useCallback(() => {
    if (phaseRef.current === "leaving") return;
    enter("leaving");
    document.documentElement.dataset.buretteIntro = "leaving";
    later(LEAVE_MS, () => done.current("finished"));
  }, [enter, later]);

  const { width, height, dpr } = viewport;
  const ink = dark ? PAPER : INK;
  return (
    <div className="atom-intro" data-phase={phase} onContextMenu={event => event.preventDefault()}>
      <div className="atom-intro-stage">
        <IntroCanvas time={t} params={atomParams(t)} dark={dark} width={width} height={height} dpr={dpr} onUnavailable={unavailable} />
        <IntroTitle t={t} width={width} color={ink} />
        <IntroAction t={t} width={width} dark={dark === 1} onPress={leave} />
      </div>
      {t >= ATOM_CUE.settle && <div className="atom-intro-drag" data-tauri-drag-region />}
    </div>
  );
}

/** Arc's welcome line: each glyph rises out of a blur with a slight tilt, 24 ms apart. */
function IntroTitle({ t, width, color }: { t: number; width: number; color: string }) {
  if (t < ATOM_TITLE.start) return null;
  const fontSize = ATOM_TITLE.size * width;
  return (
    <h1 aria-label={TITLE} className="atom-intro-title" style={{ ...centred(ATOM_TITLE.y, width), fontSize, color }}>
      {Array.from(TITLE).map((glyph, index) => {
        const progress = spring(t - ATOM_TITLE.start - index * 0.024, 0.85, 0.1);
        const rest = 1 - progress;
        const blur = Math.max(0, rest) * 0.14 * fontSize;
        const settled = Math.abs(rest) < 0.0015;
        return (
          <span key={index} aria-hidden="true" style={{
            opacity: clamp(progress * 1.2),
            filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
            transform: settled ? undefined : `translateY(${(rest * 0.32).toFixed(4)}em) rotate(${(rest * 4).toFixed(3)}deg)`,
          }}>{glyph}</span>
        );
      })}
    </h1>
  );
}

/** The landing's pill: ink on light, white on dark, sized as fractions of the window width. */
function IntroAction({ t, width, dark, onPress }: { t: number; width: number; dark: boolean; onPress: () => void }) {
  const progress = easeOut(range(t, ATOM_ACTION.start, ATOM_ACTION.start + 0.7));
  if (progress <= 0) return null;
  const height = 0.032 * width;
  const done = progress > 0.999;
  const background = dark ? "#fafafa" : INK;
  return (
    <div style={centred(ATOM_ACTION.y, width)}>
      <button type="button" className="atom-intro-action" aria-label="Get started" onClick={onPress}
        style={{
          width: 0.066 * width, height, borderRadius: height / 2, background, color: dark ? INK : "#ffffff",
          opacity: progress, ["--atom-intro-ring" as string]: background,
          filter: done ? undefined : `blur(${((1 - progress) * 0.28 * height).toFixed(2)}px)`,
          transform: done ? undefined : `scale(${0.94 + 0.06 * progress})`,
        } as CSSProperties}>
        <ArrowRight aria-hidden size={Math.round(height * 0.48)} strokeWidth={2.2} />
      </button>
    </div>
  );
}
