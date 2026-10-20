// One-time contextual education shown when the user first reaches a feature.
// `where` and `when` document the trigger for the dev gallery and docs; they
// are never rendered in the product.
export type GuidePattern = "carousel" | "announcement" | "education" | "first-use" | "inline";
export type GuideMedia = { label: string; image?: string; video?: string; poster?: string };
export type GuideSlide = { title: string; body: string };
export type GuideBenefit = { lead: string; text: string };
export type ContextualGuide = {
  pattern: GuidePattern;
  title: string;
  body?: string;
  benefits?: GuideBenefit[];
  slides?: GuideSlide[];
  media: GuideMedia[];
  alt: string;
  /** Plays still media once from the first to the last state. */
  animate?: boolean;
  where: string;
  when: string;
};

const asset = (name: string) => `/onboarding/guides/${name}`;
const still = (label: string, name: string): GuideMedia => ({ label, image: asset(name) });
const clip = (label: string, name: string, poster: string): GuideMedia => ({ label, video: asset(name), poster: asset(poster) });

export const contextualGuides = {
  "view-modes": {
    pattern: "carousel", title: "Choose a structure view",
    slides: [
      { title: "Explore in 3D", body: "Select atoms, residues, and chains. Measure distances, angles, and torsions right in the structure." },
      { title: "Style it in XYZRender", body: "The same structure with its own lighting and drawing style. Choose a view and prepare an image." },
    ],
    media: [still("Interactive 3D", "mode-interactive.webp"), still("XYZRender", "mode-xyzrender.webp")],
    alt: "The same molecule in interactive 3D and in XYZRender.",
    where: "File or tab menu → Open → As → Interactive 3D / 3D render",
    when: "After you first open a file that supports both views with Open → As → Interactive 3D or 3D render.",
  },
  grid: {
    pattern: "carousel", title: "Structures and properties",
    slides: [
      { title: "Look at the molecules", body: "Cards show the structures of the whole collection. Select molecules to keep working with them." },
      { title: "Compare properties", body: "The table shows the same molecules with their properties. Pick the rows you need and return to the structures." },
    ],
    media: [still("Cards", "collection-cards.webp"), still("Table", "collection-table.webp")],
    alt: "One molecule collection as cards and as a property table.",
    where: "Collection → Cards / Table",
    when: "The first time you switch between Cards and Table in a collection.",
  },
  ketcher: {
    pattern: "announcement", title: "Meet Ketcher",
    body: "Edit molecules right in Burette: change atoms and bonds, add fragments, and save the structure.",
    media: [still("Oxygen", "ketcher-editor-before.webp"), still("Sulfur", "ketcher-editor-after.webp")],
    animate: true,
    alt: "A molecule in Ketcher before and after an oxygen atom is replaced with sulfur.",
    where: "Ketcher tab",
    when: "The first time you open Ketcher, once the editor is ready.",
  },
  "scene-compose": {
    pattern: "education", title: "Several files. One scene.",
    benefits: [
      { lead: "Open together.", text: "Select several structures and open them in one scene." },
      { lead: "Control each file.", text: "Change the visibility and representation of every file." },
      { lead: "Keep the layout.", text: "The receptor and ligands share one coordinate system." },
    ],
    media: [still("All structures", "scene-all.webp"), still("One component hidden", "scene-hidden.webp")],
    animate: true,
    alt: "A combined scene with every structure visible, then with one component hidden.",
    where: "Selected files → Open → In one scene → scene tree toggle",
    when: "After a scene first holds several files, once the last file has loaded.",
  },
  "pose-compare": {
    pattern: "carousel", title: "Compare poses in the pocket",
    slides: [
      { title: "Compare poses in one place", body: "The camera stays in place. Inspect the ligand, then move to the next pose." },
      { title: "Same view. Another pose.", body: "Compare the ligand orientation and where its groups sit around the binding site." },
    ],
    media: [still("Pose 1", "pose-1.webp"), still("Pose 2", "pose-2.webp")],
    alt: "Two ligand poses in the same binding pocket from an unchanged camera.",
    where: "Selected MOL/SDF files → Open → As poses, or a docking view → pose switcher",
    when: "The first time you switch poses with the pose list, arrows, slider, or arrow keys.",
  },
  trajectory: {
    pattern: "education", title: "Follow the motion",
    benefits: [
      { lead: "Remove global rotation.", text: "Align superimposes every frame on the first one." },
      { lead: "Find the moment.", text: "Step through frames and change the playback speed." },
      { lead: "Compare conformations.", text: "Internal motion stays visible from a fixed view." },
    ],
    media: [clip("Aligned trajectory", "trajectory-aligned.mp4", "trajectory-aligned.webp")],
    alt: "An aligned adenylate kinase trajectory: internal motion while the protein stays in place.",
    where: "Multi-frame XYZ trajectory → playback controls → Align",
    when: "The first time Align finishes superimposing the frames.",
  },
  "trajectory-smoothing": {
    pattern: "inline", title: "Trajectory smoothing",
    body: "Smooth picks key conformations and interpolates the motion between them. Light keeps more detail, Strong keeps less. Off restores the original frames.",
    media: [clip("Original", "trajectory-aligned.mp4", "trajectory-aligned.webp"), clip("Smoothed", "smoothing-aligned.mp4", "smoothing-aligned.webp")],
    alt: "The aligned adenylate kinase trajectory before and after smoothing.",
    where: "Trajectory → Info → Smooth motion",
    when: "The first time you expand Smooth motion or turn smoothing on.",
  },
  "source-dock": {
    pattern: "carousel", title: "Keep the source beside the structure",
    slides: [
      { title: "Source beside the scene", body: "The right dock keeps the text next to the 3D view. Check the file records without switching tabs." },
      { title: "More width for text", body: "Move it to the bottom dock. The source spans the window, and the structure stays on top." },
    ],
    media: [still("Right dock", "source-edit.webp"), still("Bottom dock", "pane-bottom.webp")],
    alt: "One workspace with the source file in the right dock and in the bottom dock.",
    where: "Right dock → Text tab, or a dock file's view options → Text",
    when: "The first time you open a structure's text in the right or bottom dock.",
  },
  "source-edit": {
    pattern: "first-use", title: "Edit the source file",
    body: "Change the records of a local structure and save with ⌘S. Check the result in 3D without closing the text.",
    media: [still("Source editor", "source-edit.webp")],
    alt: "An editable structure source beside the molecule.",
    where: "Local structure → Text → Edit source",
    when: "The first time you choose Edit source for a local structure, once the editor opens.",
  },
  "fep-network": {
    pattern: "carousel", title: "Explore the FEP network",
    slides: [
      { title: "Check transformations", body: "Graph shows ligands and the edges between them. Select an edge to compare shared and changed atoms." },
      { title: "Look at the ligands", body: "Grid shows the network's molecules as a collection. Compare structures before moving to 3D." },
      { title: "Compare in space", body: "3D shows ligand conformers when the network file includes them." },
    ],
    media: [still("Graph", "fep-graph.webp"), still("Grid", "fep-grid.webp"), still("3D", "fep-3d.webp")],
    alt: "One FEP network as a transformation graph, a ligand collection, and 3D structures.",
    where: "FEP network → Graph / Grid / 3D",
    when: "The first time you switch between Graph, Grid, and 3D in an FEP network.",
  },
  "folder-watch": {
    pattern: "education", title: "A scene that fills itself",
    benefits: [
      { lead: "Open the whole folder.", text: "Pick the files and choose In one scene." },
      { lead: "Turn on auto-loading.", text: "Add new files as they appear brings new structures from the folder into the scene." },
      { lead: "Stop watching.", text: "Choose Stop watching in the folder menu when the set is complete." },
    ],
    media: [still("Folder scene", "folder-scene-result.webp")],
    alt: "Four structures from one folder opened together, with every file in the scene tree.",
    where: "Folder menu → Open → In one scene…",
    when: "After you first open a folder In one scene from the Open folder dialog.",
  },
  "smarts-search": {
    pattern: "education", title: "Search by substructure",
    benefits: [
      { lead: "Enter a fragment.", text: "Type a SMARTS pattern, such as c1ccccc1 for a benzene ring." },
      { lead: "Review the matches.", text: "The collection is filtered, and matching fragments are highlighted." },
    ],
    media: [still("Before the search", "smarts-before.webp"), still("Benzene rings highlighted", "smarts-after.webp")],
    animate: true,
    alt: "A collection before and after the c1ccccc1 filter, with benzene rings highlighted.",
    where: "Collection → Search or SMARTS…",
    when: "The first time a structure search in a collection finds matches.",
  },
  "xyz-editor": {
    pattern: "education", title: "Set the view and motion",
    benefits: [
      { lead: "Set the view.", text: "Orient the structure around X, Y, and Z with a live preview." },
      { lead: "Add motion.", text: "Choose rotation or rocking, the axis, and the speed." },
      { lead: "Keep the result.", text: "Apply GIF to canvas keeps the animation; Save GIF saves a separate file." },
    ],
    media: [clip("XYZRender editor", "xyz-editor-loop.mp4", "xyz-animation-editor.webp")],
    alt: "The XYZRender editor rotating caffeine with the animation settings open.",
    where: "XYZRender → drawing menu → 3D & Animation…, or Style → Orientation & animation…",
    when: "The first time the orientation and animation editor opens in XYZRender.",
  },
  spectra: {
    pattern: "first-use", title: "From a peak to its exact value",
    body: "Select a peak to see its m/z and intensity. Zoom into a range on the plot to separate close peaks.",
    media: [still("Mass spectrum", "spectrum-overview.webp"), still("Selected peak", "spectrum-selected.webp")],
    animate: true,
    alt: "An MS/MS spectrum before and after selecting the m/z 103.0542 peak.",
    where: "Spectrum → peak selection",
    when: "The first time a spectrum opens, once its plot is drawn.",
  },
  "chemical-space": {
    pattern: "carousel", title: "From the map to selected molecules",
    slides: [
      { title: "Compare property distributions", body: "Color the map by a property. Each point shows that molecule's value." },
      { title: "Go from a point to its structure", body: "Click a point to see the molecule. The selection follows the collection, and the lasso selects a region." },
    ],
    media: [still("Colored by SLogP", "chemical-map.webp"), still("Selected molecule", "chemical-selected.webp")],
    alt: "The chemical space of a MOSES collection colored by SLogP, then with one molecule selected.",
    where: "Chemical space → property coloring → point selection",
    when: "The first time Chemical space opens for a collection, once the map is ready.",
  },
} satisfies Record<string, ContextualGuide>;

export type ContextualGuideId = keyof typeof contextualGuides;

export function isContextualGuideId(value: unknown): value is ContextualGuideId {
  return typeof value === "string" && Object.hasOwn(contextualGuides, value);
}
