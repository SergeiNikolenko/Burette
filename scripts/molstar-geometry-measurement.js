import { DistanceRepresentation, DistanceParams } from 'molstar/lib/mol-repr/shape/loci/distance.js';
import { AngleRepresentation, AngleParams } from 'molstar/lib/mol-repr/shape/loci/angle.js';
import { DihedralRepresentation, DihedralParams } from 'molstar/lib/mol-repr/shape/loci/dihedral.js';

const definitions = new Map([
  ['bond', [DistanceRepresentation, DistanceParams, 'pairs']],
  ['angle', [AngleRepresentation, AngleParams, 'triples']],
  ['dihedral', [DihedralRepresentation, DihedralParams, 'quads']],
]);

// Canvas-only representations never enter state snapshots or saved MOLX entries.
export const BuretteGeometryMeasurement = {
  async create(plugin, kind, loci) {
    const [factory, params, key] = definitions.get(kind);
    const repr = factory({ ...plugin.representation.structure.themes }, () => params);
    repr.setState({ pickable: false });
    try {
      const options = plugin.managers.structure.measurement.state.options;
      await plugin.runTask(repr.createOrUpdate({ linesSize: 0.02, borderWidth: 0,
        textColor: options.textColor, unitLabel: options.distanceUnitLabel }, { [key]: [{ loci }] }));
      return repr;
    } catch (error) {
      repr.destroy();
      throw error;
    }
  },
};
