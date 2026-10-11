import type { ShellViewState } from "../types";
import { isMesoscaleViewerDocument } from "../../lib/mesoscale-documents";

export const guides = {
  launcher: { title: "Getting started", tips: ["Drop a structure or use Open file (⌘O).", "Add a project folder in the sidebar to keep related files together.", "Use the tab menu to move a screen into a side panel or floating window."] },
  file: { title: "3D structures", tips: ["Drag to rotate and scroll to zoom the structure.", "Select an atom, residue, or chain, then use the selection controls to focus or measure it.", "Use the scene tree to hide structures, change their appearance, or compare several together."] },
  grid: { title: "Molecule collections", tips: ["Switch between molecule cards and the property table.", "Select rows to inspect molecules or work with a subset. Use the column menu to sort and filter.", "Use the collection menu for calculations and export. Save after changing the collection."] },
  mesoscale: { title: "Large assemblies", tips: ["Open the scene panel to find groups and individual objects.", "Select an object to focus it; use the selection bar to change its appearance.", "Hide groups you do not need before exploring a crowded assembly."] },
  illustration: { title: "Molecular illustrations", tips: ["Drag the structure to choose a view and scroll to zoom.", "Adjust the drawing and lighting with the viewer controls.", "Use the export controls to save the illustration or animation."] },
  spectrum: { title: "Spectra", tips: ["Click a peak to select it in the spectrum.", "Use Normalize to compare intensities and Top labels to identify prominent peaks.", "Keep a structure beside the spectrum by moving its tab into a side panel."] },
  ketcher: { title: "Draw a molecule", tips: ["Choose an atom or bond tool, then click the canvas to draw.", "Paste a structure or open a molecule to edit an existing drawing.", "Use the molecule menu to save, open the drawing as a collection, or generate a 3D structure."] },
  "text-file": { title: "Text and source files", tips: ["Use Find to jump to a name, residue, or value in the file.", "Edit the source and save to keep changes on disk.", "For structure files, select structure records to inspect them in a molecular view."] },
  document: { title: "Documents", tips: ["Open notes, PDFs, or images alongside your structures.", "Use the document controls to navigate pages or change the zoom.", "Move the tab into a side panel to keep the document beside a molecular view."] },
  "chemical-space": { title: "Chemical space", tips: ["Choose the projection and property coloring to explore a collection.", "Select points or draw a lasso around a region to inspect a subset.", "Open a selected molecule in the collection to return to its structure and properties."] },
  "pose-review": { title: "Review poses", tips: ["Select a molecule in the grid to inspect its pose beside the receptor.", "Focus the ligand and inspect contacts before choosing a reference pose.", "Open FEP setup when the receptor and reference pose are ready."] },
  "fep-setup": { title: "Set up FEP", tips: ["Check the receptor and reference pose before preparing the setup.", "Review the selected ligands and their structures.", "Keep the source collection open to compare or revise the input molecules."] },
  "fep-network": { title: "FEP networks", tips: ["Select a node to inspect its molecule and connected transformations.", "Explore the network alongside the source collection.", "Use the scene controls to focus a molecule or show the structures together."] },
  jobs: { title: "Calculations", tips: ["Open Jobs to follow running and completed calculations.", "Select a job to inspect its progress or open its results.", "Check failed jobs before retrying; cancel a running job when you no longer need it."] },
  settings: { title: "Make Burette yours", tips: ["Choose your theme in Appearance and viewer defaults in Structure rendering.", "Open Keyboard shortcuts to find commands for the workspace.", "Use Connections for remote projects and Agents to check the molecular tools connection."] },
  agent: { title: "Connect an agent", tips: ["Open Settings → Agents and check the Burette plugin connection.", "In Set up, copy the install command, configuration, or server URL for your agent application.", "Return here and Refresh after installation. Open a structure before asking the agent to inspect or change it."] },
} satisfies Record<string, { title: string; tips: string[] }>;

export type GuideId = keyof typeof guides;

export function guideForState(state: ShellViewState): GuideId {
  const location = state.activeTab?.location;
  if (location?.kind === "settings") return location.section === "agent" ? "agent" : "settings";
  if (state.page === "settings") return "settings";
  if (location && location.kind !== "file") return location.kind;
  const document = state.activeDocument;
  if (Boolean(isMesoscaleViewerDocument(document))) return "mesoscale";
  if (document?.renderer === "grid2d") return "grid";
  if (document?.renderer === "xyzrender-external") return "illustration";
  if (document?.renderer === "spectrum") return "spectrum";
  return document || location?.kind === "file" ? "file" : "launcher";
}
