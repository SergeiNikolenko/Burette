import initialize, { type RDKitConformerModule } from "../../PreviewExtension/Web/rdkit-conformer/Burette_rdkit_conformer.js";

async function checkModuleContract() {
  const pending: Promise<RDKitConformerModule> = initialize({
    wasmBinary: new Uint8Array(),
    locateFile: (path, directory) => directory + path,
  });
  const module = await pending;
  const bcex: Uint8Array = module.extract_conformer_parameters("O", 1, 0);
  const bmfx: Uint8Array = module.extract_mmff_parameters("O", 1, 0);
  const created = module.create_uff_evaluator("MOL");
  if (created.context) {
    const count: number = created.context.atom_count();
    const result = created.context.evaluate(new Float64Array(3 * count));
    if (result.error === undefined) {
      const energy: number = result.energyKcalMol;
      const gradient: Float64Array = result.gradient;
      void [energy, gradient];
    } else {
      // @ts-expect-error Native failure objects do not contain a finite energy.
      const energy: number = result.energyKcalMol;
      void energy;
    }
    // @ts-expect-error Native coordinates are a float64 array, not a string.
    created.context.evaluate("0 0 0");
    created.context.delete();
  }
  const charges = module.compute_gasteiger_charges("MOL");
  if (charges.error === undefined) {
    const values: Float64Array = charges.charges;
    void values;
  }
  // @ts-expect-error The async factory cannot be used as an initialized module.
  const synchronous: RDKitConformerModule = initialize();
  // @ts-expect-error Native MOL input is a string.
  module.create_uff_evaluator(1);
  void [bcex, bmfx, synchronous];
}

void checkModuleContract;
