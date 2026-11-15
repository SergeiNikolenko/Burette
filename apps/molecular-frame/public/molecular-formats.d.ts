export function importStructure(value: string): Promise<string>;
export function convertStructure(value: string, format: 'Mol' | 'SDF' | 'ExtendedSmiles' | 'InChI' | 'InChIAuxInfo' | 'InChIKey' | 'DaylightSmarts' | 'KET' | 'CML' | 'CDXML', molfileFormat?: 'v2000' | 'v3000', inputFormat?: 'Mol' | 'UNKNOWN'): Promise<string>;
