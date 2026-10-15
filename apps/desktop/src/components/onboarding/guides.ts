import type { ShellViewState } from "../types";
import { isMesoscaleViewerDocument } from "../../lib/mesoscale-documents";

export const guides = {
  "launcher": { title: "Getting started", category: "Workspace", primaryLabel: "Open a structure", imageKey: "structure", tips: [
    "Drop a structure or use Open file (⌘O).",
    "Add a project folder in the sidebar to keep related files together.",
    "Use the tab menu to move a screen into a side panel or floating window.",
  ] },
  "file": { title: "3D structures", category: "Structures", primaryLabel: "Explore the structure", imageKey: "structure", tips: [
    "Drag to rotate and scroll to zoom the structure.",
    "Select an atom, residue, or chain, then use the selection controls to focus or measure it.",
    "Use the scene tree to hide structures, change their appearance, or compare several together.",
  ] },
  "grid": { title: "Molecule collections", category: "Collections", primaryLabel: "Explore the collection", imageKey: "collection", tips: [
    "Switch between molecule cards and the property table.",
    "Select rows to inspect molecules or work with a subset. Use the column menu to sort and filter.",
    "Use the collection menu for calculations and export. Save after changing the collection.",
  ] },
  "mesoscale": { title: "Large assemblies", category: "Structures", primaryLabel: "Explore the assembly", imageKey: "mesoscale", tips: [
    "Open the scene panel to find groups and individual objects.",
    "Select an object to focus it; use the selection bar to change its appearance.",
    "Hide groups you do not need before exploring a crowded assembly.",
  ] },
  "illustration": { title: "Molecular illustrations", category: "Export", primaryLabel: "Create an illustration", imageKey: "illustration", tips: [
    "Drag the structure to choose a view and scroll to zoom.",
    "Adjust the drawing and lighting with the viewer controls.",
    "Use the export controls to save the illustration or animation.",
  ] },
  "spectrum": { title: "Spectra", category: "Analysis", primaryLabel: "Inspect the spectrum", imageKey: "spectrum", tips: [
    "Click a peak to select it in the spectrum.",
    "Use Normalize to compare intensities and Top labels to identify prominent peaks.",
    "Keep a structure beside the spectrum by moving its tab into a side panel.",
  ] },
  "ketcher": { title: "Draw a molecule", category: "Editing", primaryLabel: "Start drawing", imageKey: "sketch", tips: [
    "Choose an atom or bond tool, then click the canvas to draw.",
    "Paste a structure or open a molecule to edit an existing drawing.",
    "Use the molecule menu to save, open the drawing as a collection, or generate a 3D structure.",
  ] },
  "text-file": { title: "Text and source files", category: "Editing", primaryLabel: "Explore the file", imageKey: "source", tips: [
    "Use Find to jump to a name, residue, or value in the file.",
    "Edit the source and save to keep changes on disk.",
    "For structure files, select structure records to inspect them in a molecular view.",
  ] },
  "document": { title: "Documents", category: "Workspace", primaryLabel: "Read the document", imageKey: "document", tips: [
    "Open notes, PDFs, or images alongside your structures.",
    "Use the document controls to navigate pages or change the zoom.",
    "Move the tab into a side panel to keep the document beside a molecular view.",
  ] },
  "chemical-space": { title: "Chemical space", category: "Collections", primaryLabel: "Explore chemical space", imageKey: "chemical-space", tips: [
    "Choose the projection and property coloring to explore a collection.",
    "Select points or draw a lasso around a region to inspect a subset.",
    "Open a selected molecule in the collection to return to its structure and properties.",
  ] },
  "pose-review": { title: "Review poses", category: "Poses", primaryLabel: "Review the poses", imageKey: "structure", tips: [
    "Select a molecule in the grid to inspect its pose beside the receptor.",
    "Focus the ligand and inspect contacts before choosing a reference pose.",
    "Open FEP setup when the receptor and reference pose are ready.",
  ] },
  "fep-setup": { title: "Set up FEP", category: "Calculations", primaryLabel: "Review the setup", imageKey: "fep", tips: [
    "Check the receptor and reference pose before preparing the setup.",
    "Review the selected ligands and their structures.",
    "Keep the source collection open to compare or revise the input molecules.",
  ] },
  "fep-network": { title: "FEP networks", category: "Calculations", primaryLabel: "Explore the network", imageKey: "network", tips: [
    "Select a node to inspect its molecule and connected transformations.",
    "Explore the network alongside the source collection.",
    "Use the scene controls to focus a molecule or show the structures together.",
  ] },
  "jobs": { title: "Calculations", category: "Calculations", primaryLabel: "View calculations", imageKey: "jobs", tips: [
    "Open Jobs to follow running and completed calculations.",
    "Select a job to inspect its progress or open its results.",
    "Check failed jobs before retrying; cancel a running job when you no longer need it.",
  ] },
  "settings": { title: "Make Burette yours", category: "Workspace", primaryLabel: "Choose appearance", imageKey: "settings", tips: [
    "Choose your theme in Appearance and viewer defaults in Structure rendering.",
    "Open Keyboard shortcuts to find commands for the workspace.",
    "Use Connections for remote projects and Agents to check the molecular tools connection.",
  ] },
  "agent": { title: "Connect an agent", category: "Workspace", primaryLabel: "Open agent settings", imageKey: "agents", tips: [
    "Open Settings → Agents and check the Burette plugin connection.",
    "In Set up, copy the install command, configuration, or server URL for your agent application.",
    "Return here and Refresh after installation. Open a structure before asking the agent to inspect or change it.",
  ] },
  "trajectory": { title: "Play a trajectory", category: "Trajectories", primaryLabel: "Explore the frames", imageKey: "trajectory", tips: [
    "Open a multi-frame structure or a trajectory with its matching topology.",
    "Use Play, the frame arrows, or the timeline to inspect the motion.",
    "Adjust playback speed and Loop to revisit a transition.",
  ] },
  "trajectory-align": { title: "Compare motion after alignment", category: "Trajectories", primaryLabel: "Inspect aligned motion", imageKey: "trajectory", tips: [
    "Open the trajectory and pause on a frame you want to inspect.",
    "Use Align in the playback controls to compare frames without whole-structure movement.",
    "Step through the frames and check how the internal conformation changes.",
  ] },
  "trajectory-smoothing": { title: "Find the important motion", category: "Trajectories", primaryLabel: "Explore smooth motion", imageKey: "trajectory", tips: [
    "Open Info → Smooth motion for a supported trajectory.",
    "Choose Light, Balanced, or Strong, then enable smoothing.",
    "Use Scientific settings to choose a reference frame and sampling; compare the original and smoothed views.",
  ] },
  "trajectory-topology": { title: "Pair a trajectory with its structure", category: "Trajectories", primaryLabel: "Explore the trajectory", imageKey: "trajectory", tips: [
    "Keep the coordinate trajectory and its matching topology together.",
    "Open the trajectory and use the topology controls in Info to choose the matching structure.",
    "Check the atom count and first frame before playing the trajectory.",
  ] },
  "scene-compose": { title: "Build a scene from several files", category: "Scenes", primaryLabel: "Explore the scene", imageKey: "scene", tips: [
    "Select compatible structure files and choose Open → In one scene.",
    "Use Add to scene to bring more structures into an existing scene.",
    "Use the scene tree to focus, hide, and style each structure independently.",
  ] },
  "scene-save": { title: "Save and reopen a whole scene", category: "Scenes", primaryLabel: "Keep exploring", imageKey: "scene", tips: [
    "Arrange the structures and representations in your scene.",
    "Open the scene menu and choose Save scene… to create a .molx file.",
    "Reopen that file to restore the saved molecular workspace.",
  ] },
  "multi-file": { title: "Select many files at once", category: "Files", primaryLabel: "Explore your files", imageKey: "structure", tips: [
    "Use ⌘-click to add individual files or Shift-click to select a range in the sidebar.",
    "Open the selection menu and choose separate tabs, one scene, or poses when available.",
    "Files appear progressively; use Stop if you have opened enough.",
  ] },
  "folder-scene": { title: "Open a folder as one scene", category: "Files", primaryLabel: "Explore the folder", imageKey: "scene", tips: [
    "Open the folder menu and choose Open all in one scene.",
    "For a custom selection, choose Open → In one scene… and pick the files.",
    "Include subfolders when needed, then follow the loading progress.",
  ] },
  "folder-watch": { title: "Add new files automatically", category: "Files", primaryLabel: "Explore watched folders", imageKey: "scene", tips: [
    "For a local folder, choose Open → In one scene… and enable Add new files as they appear.",
    "For a remote folder, choose Watch folder in one scene from its menu.",
    "New compatible files join the scene; use Stop watching when the run is complete.",
  ] },
  "ssh-projects": { title: "Browse a remote project", category: "Files", primaryLabel: "Explore remote files", imageKey: "structure", tips: [
    "Add your SSH connection in Settings → Connections, then open a remote project.",
    "Expand the folders you need and select the files to open.",
    "Use the folder menu to open a batch in tabs, combine structures, or watch for new files.",
  ] },
  "source-edit": { title: "Edit a structure beside its preview", category: "Editing", primaryLabel: "Explore source editing", imageKey: "source", tips: [
    "Open an individual local structure and choose Edit source in the Text panel.",
    "Edit the coordinates or records and inspect the updated 3D preview; use Apply preview when offered.",
    "Save the source with ⌘S. Collections and multi-frame files remain searchable text.",
  ] },
  "side-panel": { title: "Keep two views together", category: "Workspace", primaryLabel: "Explore side panels", imageKey: "panels", tips: [
    "Open a tab menu and choose Open in Side Panel.",
    "Keep a structure beside its spectrum, source, document, or collection.",
    "Resize the panel, switch its tabs, or choose Move to Main Window to bring it back.",
  ] },
  "bottom-dock": { title: "Keep supporting files below the scene", category: "Workspace", primaryLabel: "Explore the bottom dock", imageKey: "panels", tips: [
    "Open the panels menu and enable Bottom dock.",
    "Use its tabs and add controls to keep supporting content below the main view.",
    "Resize the dock to give the molecular scene the space it needs.",
  ] },
  "pop-out": { title: "Move a scene to another display", category: "Workspace", primaryLabel: "Explore detached windows", imageKey: "panels", tips: [
    "In the desktop app, open a supported scene tab menu and choose Pop out.",
    "Move the separate window anywhere on the desktop or another display.",
    "Choose Move to Main Window in its tab menu to return the scene.",
  ] },
  "file-export": { title: "Drag a real file to Finder", category: "Files", primaryLabel: "Explore file export", imageKey: "source", tips: [
    "In the desktop app, drag a file tab to Finder or the Desktop.",
    "Ordinary documents keep their file format; a combined molecular scene is exported as .molx.",
    "Save collection changes before dragging. A sketch is exported in an editable structure format.",
  ] },
  "selection": { title: "Select exactly what you need", category: "Structures", primaryLabel: "Explore selections", imageKey: "structure", tips: [
    "Choose the atom, residue, or chain selection level in the viewer.",
    "Click the structure or use the sequence to build a selection.",
    "Use the selection controls to focus it, change its representation, or inspect its surroundings.",
  ] },
  "measurements": { title: "Measure distances and angles", category: "Structures", primaryLabel: "Explore measurements", imageKey: "structure", tips: [
    "Select the atoms you want to compare in the 3D viewer.",
    "Use the measurement controls to create a distance, angle, or dihedral.",
    "Find the measurement in the scene tree to adjust its label and appearance.",
  ] },
  "structure-appearance": { title: "Style each part of a structure", category: "Structures", primaryLabel: "Explore structure styles", imageKey: "structure", tips: [
    "Open the scene tree and choose a structure or representation.",
    "Change its representation and color to distinguish chains, ligands, or regions.",
    "Hide the parts you do not need and save the scene when the view is ready.",
  ] },
  "pose-compare": { title: "Compare several ligand poses", category: "Poses", primaryLabel: "Explore pose comparison", imageKey: "structure", tips: [
    "Select compatible ligand files and choose Open → As poses.",
    "Use the pose controls to inspect individual poses or show them together.",
    "Use the receptor and pose grid in Pose Review to choose the reference for FEP setup.",
  ] },
  "pose-contacts": { title: "Inspect a ligand binding environment", category: "Poses", primaryLabel: "Explore the binding site", imageKey: "structure", tips: [
    "Open the ligand pose together with its receptor.",
    "Select and focus the ligand to inspect the surrounding residues and contacts.",
    "Use measurements to check specific distances before comparing another pose.",
  ] },
  "image-export": { title: "Share a molecular view", category: "Export", primaryLabel: "Explore image export", imageKey: "illustration", tips: [
    "Choose the camera view, representation, and background for your structure.",
    "Use the camera or image export controls to save the current view.",
    "For an animated molecular illustration, use the animation export controls in the 3D render view.",
  ] },
  "sketch-3d": { title: "Turn a drawing into a 3D structure", category: "Editing", primaryLabel: "Explore sketch to 3D", imageKey: "sketch", tips: [
    "Draw a molecule or paste a structure into the sketch editor.",
    "Open the molecule menu and choose Generate 3D.",
    "Inspect the generated structure in the molecular viewer and save it for later.",
  ] },
  "collection-filter": { title: "Find molecules by their properties", category: "Collections", primaryLabel: "Explore property filters", imageKey: "collection", tips: [
    "Open a molecule collection and switch to the property table.",
    "Use a column menu to sort or filter the values you want to compare.",
    "Select the matching rows and inspect their structures or export the subset.",
  ] },
  "collection-calculate": { title: "Calculate properties for a collection", category: "Collections", primaryLabel: "Explore collection calculations", imageKey: "collection", tips: [
    "Open the collection and choose the molecules you want to work with.",
    "Use the collection menu to calculate molecular properties.",
    "Review the new columns and save the collection to keep the results.",
  ] },
} satisfies Record<string, { title: string; category: string; primaryLabel: string; imageKey: string; tips: string[] }>;

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
