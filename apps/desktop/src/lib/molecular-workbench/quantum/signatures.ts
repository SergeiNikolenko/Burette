/**
 * Program banners that identify a quantum-chemistry text output within its first 64 KiB.
 * The browser file gate and the reader dispatch share them; each reader validates the rest.
 */
export const NWCHEM_SIGNATURE = /Northwest Computational Chemistry Package \(NWChem\)|NWChem Input Module/u;
export const PSI4_SIGNATURE = /Psi4: An Open-Source Ab Initio Electronic Structure Package/u;
export const XTB_SIGNATURE = /^\s*\|\s+x T B\s+\|\s*$|^\s*\* xtb version \d/mu;
/** `xtbopt.log`: XYZ frames whose comment is `energy: <Eh> gnorm: <Eh/bohr> xtb: <version>`. */
export const XTB_TRAJECTORY_SIGNATURE = /^\s*\d+\s*\n\s*energy:\s+\S+\s+gnorm:\s+\S+\s+xtb:\s/u;
export const ORCA_BANNER = /O {3}R {3}C {3}A/u;
/** ORCA's property file: the ORCA 6 `*** ORCA 6.x.y ***` banner or the ORCA 5 `!PROPERTIES!` banner. */
export const ORCA_PROPERTY_SIGNATURE = /^\*{10,} ORCA \d+\.\d+\.\d+ \*{10,}\s*$|^-{10,} !PROPERTIES! -{10,}\s*$/mu;
/** GAMESS-US (`GAMESS VERSION = ...`) and its Firefly / PC GAMESS descendants. */
export const GAMESS_SIGNATURE = /^\s*\*\s+GAMESS VERSION = |^\s*\*\s+(?:Firefly|PC GAMESS) version \d/mu;
export const QCHEM_SIGNATURE = /Welcome to Q-Chem|Q-Chem, Inc\., /u;
export const MOLPRO_SIGNATURE = /\*\*\*\s+PROGRAM SYSTEM MOLPRO\s+\*\*\*/u;
