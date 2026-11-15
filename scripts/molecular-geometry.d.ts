export type GeometryEndpoint = { id: string; position: number[]; occupancy?: number; label_alt_id?: string };
export function measureGeometry(kind: 'distance' | 'angle' | 'dihedral', atoms: GeometryEndpoint[]): {
  method: string; kind: 'distance' | 'angle' | 'dihedral'; value: number;
  units: 'angstrom' | 'degrees'; coordinateSpace: 'scene';
  endpoints: { id: string; position: number[]; occupancy: number | null; label_alt_id: string | null }[];
  warnings: string[]; convention?: string;
};
