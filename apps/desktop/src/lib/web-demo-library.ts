export const demoLibraryFiles = [
  {
    "path": "Collections/isothio_fused.xyz",
    "byteCount": 1621
  },
  {
    "path": "Collections/isothio_uma.xyz",
    "byteCount": 2266
  },
  {
    "path": "Collections/isothio_xtb.xyz",
    "byteCount": 2266
  },
  {
    "path": "Collections/triphenylbenzol.xyz",
    "byteCount": 89280
  },
  {
    "path": "Crystals/MOF-5.xyz",
    "byteCount": 17898
  },
  {
    "path": "Crystals/NV63.in",
    "byteCount": 4571
  },
  {
    "path": "Crystals/NV63.vasp",
    "byteCount": 4096
  },
  {
    "path": "Crystals/NV63_cell.xyz",
    "byteCount": 3536
  },
  {
    "path": "Crystals/caffeine_cell.xyz",
    "byteCount": 6490
  },
  {
    "path": "Crystals/caffeine_cif.cif",
    "byteCount": 3172
  },
  {
    "path": "Crystals/roy.res",
    "byteCount": 1746
  },
  {
    "path": "Crystals/silicon.cjson",
    "byteCount": 343
  },
  {
    "path": "Motion & Reactions/amidation.rxn",
    "byteCount": 1415
  },
  {
    "path": "Motion & Reactions/bimp.out",
    "byteCount": 13997318
  },
  {
    "path": "Motion & Reactions/mn-h2.log",
    "byteCount": 1659382
  },
  {
    "path": "Motion & Reactions/mn-h2.v000.mdsmooth.xyz",
    "byteCount": 48174
  },
  {
    "path": "Motion & Reactions/mn-h2.v000.xyz",
    "byteCount": 48713
  },
  {
    "path": "Quantum/base-pair-dens.cube",
    "byteCount": 4081787
  },
  {
    "path": "Quantum/base-pair-grad.cube",
    "byteCount": 4081804
  },
  {
    "path": "Quantum/caffeine.com",
    "byteCount": 1090
  },
  {
    "path": "Quantum/caffeine.inp",
    "byteCount": 1064
  },
  {
    "path": "Quantum/caffeine.xyz",
    "byteCount": 988
  },
  {
    "path": "Quantum/caffeine_charges.txt",
    "byteCount": 411
  },
  {
    "path": "Quantum/caffeine_dens.cube",
    "byteCount": 7259116
  },
  {
    "path": "Quantum/caffeine_homo.cube",
    "byteCount": 7259139
  },
  {
    "path": "Quantum/caffeine_sdf.sdf",
    "byteCount": 3950
  },
  {
    "path": "Structures/ala_phe_ala.pdb",
    "byteCount": 17067
  },
  {
    "path": "Structures/buckyball.xyz",
    "byteCount": 1832
  },
  {
    "path": "Structures/coronene_colors.cjson",
    "byteCount": 7316
  },
  {
    "path": "Structures/mnh.xyz",
    "byteCount": 3076
  }
];

export function demoLibraryUrl(path: string) {
  const relative = path.replace(/^\/BuretteDemo\//u, "");
  return demoLibraryFiles.some(file => file.path === relative)
    ? `/demo-library/${relative.split("/").map(encodeURIComponent).join("/")}`
    : undefined;
}
