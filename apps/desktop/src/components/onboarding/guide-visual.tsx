import type { ReactNode } from "react";
import { ArrowRight, Check, CheckCircle, FileCode, FileDocument, FolderOpen, Grid, Link, Play, Plus, Search, SettingsSlider, Sun } from "../ui/app-icons";
import type { GuideId } from "./guides";
import "./guide-visual.css";

type Screen = GuideId | "appearance" | "start";
const palette: Record<Screen, string> = {
  launcher: "rose", file: "sky", grid: "mint", mesoscale: "ocean", illustration: "peach",
  spectrum: "violet", ketcher: "peach", "text-file": "sky", document: "rose",
  "chemical-space": "violet", "pose-review": "ocean", "fep-setup": "mint", "fep-network": "sky",
  jobs: "peach", settings: "rose", agent: "ocean", appearance: "violet", start: "mint",
};

function Molecule({ name = "caffeine_pmol", className = "" }: { name?: string; className?: string }) {
  return <img className={`guide-molecule ${className}`} src={`/xyzrender-gallery/${name}.svg`} width={180} height={164} alt="" draggable={false} />;
}
function Window({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`guide-window ${className}`}><div className="guide-window-bar"><i /><i /><i /><span /></div>{children}</div>;
}
function Lines({ count = 4 }: { count?: number }) {
  return <div className="guide-lines">{Array.from({ length: count }, (_, index) => <i key={index} />)}</div>;
}
function Collection({ table = false }: { table?: boolean }) {
  return <Window className={table ? "guide-collection guide-collection-table" : "guide-collection"}>
    <div className="guide-collection-head"><Grid /><span /><Search /></div>
    <div className="guide-molecule-cards">{["caffeine_skeletal", "benzene", "ethanol_all_h"].map(name => <div key={name}><Molecule name={name} />{table ? <Lines count={3} /> : <span />}</div>)}</div>
  </Window>;
}
function Scene({ name = "caffeine_pmol", tools = true }: { name?: string; tools?: boolean }) {
  return <Window className="guide-scene"><div className="guide-scene-canvas"><Molecule name={name} />{tools && <div className="guide-scene-tools"><Plus /><Search /><SettingsSlider /></div>}</div></Window>;
}
function Spectrum() {
  return <Window className="guide-spectrum"><div className="guide-plot-grid" /><svg viewBox="0 0 280 120"><path d="M8 104H34l5-11 4 11h19l6-49 5 49h16l7-26 6 26h24l8-83 7 83h16l5-39 6 39h17l4-17 5 17h17l6-60 7 60h28l5-21 5 21h17" /></svg><div className="guide-plot-dot" /></Window>;
}
const points = [[12,56],[19,44],[22,62],[28,49],[30,70],[34,58],[39,39],[43,54],[46,68],[48,29],[53,44],[56,58],[59,34],[63,48],[67,63],[72,35],[76,49],[80,60],[84,37],[87,48],[38,76],[64,77],[54,19],[74,73]];
function ChemicalSpace() {
  return <Window className="guide-space"><div className="guide-plot-grid" />{points.map(([x,y], index) => <i key={index} style={{ left: `${x}%`, top: `${y}%` }} />)}<div className="guide-lasso" /><Molecule name="benzene" className="guide-point-molecule" /></Window>;
}
function Network() {
  return <div className="guide-network"><svg viewBox="0 0 320 170"><path d="M50 86L153 33L265 83L168 143L50 86M153 33L168 143M50 86L265 83" /></svg>{["caffeine_skeletal", "benzene", "ethanol_no_h", "asparagine_vdw"].map((name, index) => <div className={`guide-node guide-node-${index}`} key={name}><Molecule name={name} /></div>)}</div>;
}
function Settings({ appearance = false }: { appearance?: boolean }) {
  return <div className={`guide-settings-pair ${appearance ? "guide-appearance" : ""}`}>
    <Window className="guide-settings-light"><div className="guide-settings-content"><Sun /><div className="guide-swatches"><i /><i /><i /></div><Lines count={3} /><div className="guide-slider"><i /></div></div></Window>
    <Window className="guide-settings-dark"><div className="guide-settings-content"><SettingsSlider /><div className="guide-swatches"><i /><i /><i /></div><Lines count={3} /><div className="guide-slider"><i /></div></div></Window>
  </div>;
}
function VisualContent({ screen }: { screen: Screen }) {
  switch (screen) {
    case "launcher": return <><div className="guide-welcome-orbit" /><div className="guide-welcome-collection"><Collection /></div><div className="guide-welcome-scene"><Scene tools={false} /></div><div className="guide-float guide-welcome-file"><FileDocument /><Lines count={2} /></div></>;
    case "file": return <><Scene /><div className="guide-float guide-selection"><span /><span /><span /><Check /></div></>;
    case "grid": return <Collection table />;
    case "mesoscale": return <><Scene name="mof5_faces_pore" /><div className="guide-float guide-assembly"><Molecule name="buckyball_faces" /><div className="guide-layer-lines"><Lines count={3} /></div></div></>;
    case "illustration": return <div className="guide-illustrations"><div><Molecule name="caffeine_pmol" /></div><div><Molecule name="caffeine_kekule" /></div><div><Molecule name="caffeine_vdw" /></div></div>;
    case "spectrum": return <><Spectrum /><div className="guide-float guide-spectrum-molecule"><Molecule name="ethanol_some_h" /></div></>;
    case "ketcher": return <Window className="guide-sketch"><div className="guide-sketch-tools"><Plus /><span>C</span><span>N</span><span>O</span></div><Molecule name="caffeine_skeletal" /><div className="guide-sketch-cursor"><Plus /></div></Window>;
    case "text-file": return <Window className="guide-code"><div className="guide-code-heading"><FileCode /><span>structure.pdb</span><Search /></div><div className="guide-code-lines">{["HEADER    MOLECULAR STRUCTURE", "ATOM      1  N   ALA A   1", "ATOM      2  CA  ALA A   1", "ATOM      3  C   ALA A   1", "ATOM      4  O   ALA A   1", "END"].map((line,index) => <div key={line}><span>{index + 1}</span><code>{line}</code></div>)}</div></Window>;
    case "document": return <div className="guide-document-scene"><div className="guide-document-back"><Scene tools={false} /></div><div className="guide-paper"><FileDocument /><Lines count={2} /><Molecule name="caffeine_skeletal" /><Lines count={3} /></div></div>;
    case "chemical-space": return <ChemicalSpace />;
    case "pose-review": return <div className="guide-pose"><Window className="guide-pose-source"><Molecule name="caffeine_skeletal" /><Lines count={2} /><CheckCircle /></Window><ArrowRight className="guide-pose-arrow" /><Scene name="caffeine_vdw" /></div>;
    case "fep-setup": return <Window className="guide-setup"><div className="guide-setup-molecule"><Molecule /><CheckCircle /></div><div className="guide-checklist">{["Receptor", "Reference pose", "Ligands"].map(label => <div key={label}><CheckCircle /><span>{label}</span></div>)}<div className="guide-setup-progress"><i /></div></div></Window>;
    case "fep-network": return <Network />;
    case "jobs": return <Window className="guide-jobs">{["Optimize", "Conformers", "Properties"].map((label,index) => <div className={`guide-job guide-job-${index}`} key={label}>{index === 2 ? <CheckCircle /> : <Play />}<div><span>{label}</span><i><b /></i></div><Molecule name={index === 1 ? "asparagine_vdw" : "caffeine_skeletal"} /></div>)}</Window>;
    case "settings": return <Settings />;
    case "appearance": return <Settings appearance />;
    case "agent": return <div className="guide-agent"><Window className="guide-agent-chat"><div className="guide-chat-bubble"><Lines count={2} /></div><div className="guide-chat-reply"><CheckCircle /><Lines count={3} /></div></Window><div className="guide-agent-link"><Link /></div><Scene tools={false} /></div>;
    case "start": return <div className="guide-start"><div className="guide-start-folder"><FolderOpen /><Lines count={3} /></div><div className="guide-start-molecule"><Molecule name="caffeine_pmol" /></div><div className="guide-start-sketch"><Molecule name="caffeine_skeletal" /></div><div className="guide-start-add"><Plus /></div></div>;
  }
}

/** Decorative product vignettes use the same rendered molecules as the illustration gallery. */
export function GuideVisual({ screen }: { screen: Screen }) {
  return <div className={`guide-visual guide-palette-${palette[screen]}`} data-guide-screen={screen} aria-hidden="true">
    <div className="guide-aurora guide-aurora-one" /><div className="guide-aurora guide-aurora-two" /><div className="guide-aurora guide-aurora-three" />
    <div className="guide-visual-stage"><VisualContent screen={screen} /></div>
  </div>;
}
