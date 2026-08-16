type OclModule = typeof import("openchemlib");
type OclMolecule = InstanceType<OclModule["Molecule"]>;

export function foldCommonScaffold(ocl: OclModule, molecules: OclMolecule[]): OclMolecule | null;

export function scaffoldMoleculesFromRows(
  ocl: OclModule,
  rows: Array<{ smiles?: string | null; molblock?: string | null }>,
): OclMolecule[];
