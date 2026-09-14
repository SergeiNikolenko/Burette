// The standalone workspace opens the curated files; embedded presentations keep
// their own file list and timing. Scene assets contain molecular state only.
export const standaloneDemoScenes = [
  { path: "Structures/1HTB.pdb", asset: "1HTB.pdb" },
  { path: "Collections/metadynamics-binding.mae", asset: "metadynamics-binding.mae", snapshot: "metadynamics-binding.mae.molj" },
  { path: "Collections/moses-12.csv", asset: "moses-12.csv" },
  { path: "Motion & Reactions/bimp.v000.xyz", asset: "bimp.v000.xyz", snapshot: "bimp.v000.xyz.molj" },
  { path: "Structures/petworld-flagellar-motor.molj", asset: "petworld-flagellar-motor.bcif.molj" },
] as const;

export function standaloneDemoSnapshot(path: string) {
  const scene = standaloneDemoScenes.find(scene => path === `/BuretteDemo/${scene.path}`);
  return scene && "snapshot" in scene ? `/demo-scenes/${scene.snapshot}` : undefined;
}
