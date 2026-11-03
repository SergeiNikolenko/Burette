/*! Nucleotide coordinates from Open-Source PyMOL, Copyright (C) Schrodinger, LLC; notice in docs/third-party/pymol-LICENSE. Z-DNA backbone from PDB 4OCB (wwPDB, CC0). */

/**
 * Ideal nucleotide geometry for the DNA/RNA builder.
 *
 * Heavy-atom coordinates are the `fnab` fragments of Open-Source PyMOL 3.1.0
 * (data/chempy/fragments/{atp,ctp,gtp,ttp}{A,B}.pkl, utpA.pkl), which PyMOL credits
 * to the 3DNA fiber models (Lu & Olson, Nucleic Acids Res. 32, W667, 2004). The A form
 * reproduces the Arnott A-DNA backbone (alpha -51.7, beta 174.8, gamma 41.7, delta 79.0,
 * epsilon -147.8, zeta -75.1, chi -157.2 degrees; C3'-endo); the B form is a BI,
 * C2'-endo fiber model (chi -98.0). Regenerate with
 * tests/fixtures/nucleic/extract-pymol-templates.py; only O1P/O2P -> OP1/OP2 and
 * C5M -> C7 are renamed.
 *
 * Each table is one nucleotide in its helix frame: z is the helix axis, and the next
 * nucleotide 3' of it is this one rotated by -twist about z and moved by -rise along z
 * (O3'-P then measures 1.601 A). The paired nucleotide of the other strand is the
 * template of its own base rotated 180 degrees about x, exactly as in PyMOL's base-pair
 * fragments. The backbone is identical for every base of a form. Uracil is the thymine
 * ring without C7 (identical ring coordinates); O2' comes from the uridine fragment,
 * whose backbone matches the A-form backbone to 0.0015 A.
 *
 * The Z form is left-handed Z-I DNA with a dinucleotide repeat: an anti pyrimidine
 * (C2'-endo) followed by a syn purine (C3'-endo). Its backbone through C1' is the mean
 * of the Z-I repeats of PDB 4OCB, d(CGCGCGCGCGCG)2 at 0.75 A (Brzezinski et al. 2014;
 * wwPDB, CC0), in the frame of the crystal's own helix screw and dyad, regularized to the
 * crystal's mean bond lengths, angles and linkages. Its bases are the
 * B-form bases above, superposed on the 4OCB guanine (A, G) or cytosine (C, T) ring.
 * The next repeat 3' of the template is rotated by -twist about z and moved by -rise,
 * per dinucleotide; the x axis is the dyad between the purine and the next pyrimidine.
 * Regenerate with tests/fixtures/nucleic/derive-z-template.py.
 *
 * Open-Source PyMOL is Copyright (C) Schrodinger, LLC. Permission to use, copy, modify,
 * distribute, and distribute modified versions of this software and its built-in
 * documentation for any purpose and without fee is hereby granted, provided that the
 * above copyright notice appears in all copies and that both the copyright notice and
 * this permission notice appear in supporting documentation, and that the name of
 * Schrodinger, LLC not be used in advertising or publicity pertaining to distribution of
 * the software without specific, written prior permission. SCHRODINGER, LLC DISCLAIMS
 * ALL WARRANTIES WITH REGARD TO THIS SOFTWARE, INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL SCHRODINGER, LLC BE LIABLE FOR ANY
 * SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS
 * SOFTWARE.
 *
 * Atom names, bonds and Kekule bond orders follow the wwPDB Chemical Component
 * Dictionary entries DA, DC, DG, DT, A, C, G and U (CC0).
 */

export type TemplateAtom = readonly [name: string, x: number, y: number, z: number];
export type TemplateBase = "A" | "C" | "G" | "T";

type HelixTemplate = {
  twistDegrees: number;
  riseAngstrom: number;
  backbone: readonly TemplateAtom[];
  bases: Record<TemplateBase, readonly TemplateAtom[]>;
};

/** Twist and rise per dinucleotide; one backbone for the pyrimidine and one for the purine. */
export const Z_DNA_TEMPLATE: Omit<HelixTemplate, "backbone"> & { backbone: Record<"pyrimidine" | "purine", readonly TemplateAtom[]> } = {
  twistDegrees: -58.06,
  riseAngstrom: 7.517,
  backbone: {
    pyrimidine: [["P", -5.842, -4.596, 7.382], ["OP1", -6.557, -5.83, 7], ["OP2", -4.783, -4.68, 8.395], ["O5'", -5.262, -3.88, 6.09], ["C5'", -4.66, -4.59, 4.988], ["C4'", -3.288, -4.042, 4.74], ["O4'", -3.36, -2.673, 4.294], ["C3'", -2.368, -4.062, 5.957], ["O3'", -1.032, -4.387, 5.564], ["C2'", -2.357, -2.607, 6.384], ["C1'", -2.455, -1.902, 5.063]],
    purine: [["P", -0.484, -5.907, 5.676], ["OP1", -0.963, -6.559, 6.9], ["OP2", 0.972, -5.808, 5.413], ["O5'", -1.207, -6.652, 4.458], ["C5'", -0.937, -6.264, 3.103], ["C4'", -1.881, -7.024, 2.199], ["O4'", -3.239, -6.604, 2.448], ["C3'", -1.615, -6.768, 0.734], ["O3'", -0.688, -7.757, 0.283], ["C2'", -2.994, -6.817, 0.116], ["C1'", -3.988, -6.568, 1.247]],
  },
  bases: {
    A: [["N9", -4.651, -5.301, 1.241], ["C8", -5.997, -5.094, 1.322], ["N7", -6.331, -3.847, 1.447], ["C5", -5.116, -3.175, 1.449], ["C6", -4.787, -1.813, 1.552], ["N6", -5.699, -0.839, 1.68], ["N1", -3.481, -1.488, 1.519], ["C2", -2.579, -2.461, 1.392], ["N3", -2.766, -3.758, 1.288], ["C4", -4.081, -4.057, 1.323]],
    C: [["N1", -2.993, -0.563, 5.175], ["C2", -2.088, 0.475, 5.376], ["O2", -0.879, 0.217, 5.403], ["N3", -2.566, 1.736, 5.537], ["C4", -3.884, 1.975, 5.501], ["N4", -4.302, 3.22, 5.662], ["C5", -4.832, 0.92, 5.295], ["C6", -4.333, -0.332, 5.138]],
    G: [["N9", -4.637, -5.303, 1.24], ["C8", -5.998, -5.103, 1.322], ["N7", -6.347, -3.845, 1.447], ["C5", -5.131, -3.164, 1.45], ["C6", -4.862, -1.775, 1.558], ["O6", -5.656, -0.844, 1.676], ["N1", -3.485, -1.514, 1.517], ["C2", -2.498, -2.471, 1.388], ["N2", -1.241, -2.019, 1.368], ["N3", -2.75, -3.774, 1.285], ["C4", -4.082, -4.044, 1.324]],
    T: [["N1", -2.977, -0.565, 5.176], ["C2", -2.06, 0.438, 5.372], ["O2", -0.858, 0.242, 5.408], ["N3", -2.59, 1.704, 5.53], ["C4", -3.929, 2.039, 5.507], ["O4", -4.285, 3.21, 5.661], ["C5", -4.814, 0.918, 5.295], ["C7", -6.288, 1.195, 5.257], ["C6", -4.325, -0.323, 5.139]],
  },
};

export const HELIX_TEMPLATES: { B: HelixTemplate; A: HelixTemplate & { o2: TemplateAtom } } = {
  B: {
    twistDegrees: 36,
    riseAngstrom: 3.375,
    backbone: [["P", -0.356, 9.218, 1.848], ["OP1", -0.311, 10.489, 2.605], ["OP2", -1.334, 9.156, 0.74], ["O5'", 1.105, 8.869, 1.295], ["C5'", 2.021, 8.156, 2.146], ["C4'", 2.726, 7.072, 1.355], ["O4'", 1.986, 5.817, 1.352], ["C3'", 2.952, 7.37, -0.127], ["O3'", 4.21, 6.832, -0.518], ["C2'", 1.848, 6.598, -0.85], ["C1'", 1.913, 5.344, 0.016]],
    bases: {
      A: [["N9", 0.711, 4.472, -0.101], ["C8", -0.589, 4.841, -0.292], ["N7", -1.415, 3.843, -0.354], ["C5", -0.604, 2.728, -0.192], ["C6", -0.881, 1.351, -0.162], ["N6", -2.113, 0.841, -0.301], ["N1", 0.158, 0.514, 0.016], ["C2", 1.38, 1.027, 0.154], ["N3", 1.758, 2.286, 0.143], ["C4", 0.7, 3.103, -0.037]],
      C: [["N1", 0.711, 4.472, -0.101], ["C2", 0.897, 3.095, -0.01], ["O2", 2.04, 2.657, 0.163], ["N3", -0.186, 2.282, -0.115], ["C4", -1.409, 2.796, -0.302], ["N4", -2.433, 1.963, -0.398], ["C5", -1.621, 4.21, -0.399], ["C6", -0.526, 5.004, -0.292]],
      G: [["N9", 0.711, 4.472, -0.101], ["C8", -0.606, 4.826, -0.294], ["N7", -1.43, 3.807, -0.354], ["C5", -0.599, 2.7, -0.19], ["C6", -0.914, 1.317, -0.165], ["O6", -2.01, 0.775, -0.284], ["N1", 0.233, 0.533, 0.025], ["C2", 1.516, 1.023, 0.172], ["N2", 2.476, 0.111, 0.344], ["N3", 1.811, 2.321, 0.149], ["C4", 0.709, 3.095, -0.035]],
      T: [["N1", 0.711, 4.472, -0.101], ["C2", 0.911, 3.116, -0.009], ["O2", 2.01, 2.617, 0.161], ["N3", -0.226, 2.339, -0.123], ["C4", -1.513, 2.797, -0.316], ["O4", -2.454, 2.004, -0.403], ["C5", -1.622, 4.234, -0.4], ["C7", -2.989, 4.816, -0.61], ["C6", -0.533, 5.013, -0.293]],
    },
  },
  A: {
    twistDegrees: 32.7,
    riseAngstrom: 2.548,
    backbone: [["P", 3.063, 8.025, -4.135], ["OP1", 3.223, 8.856, -5.35], ["OP2", 1.891, 7.121, -4.118], ["O5'", 4.397, 7.181, -3.881], ["C5'", 5.621, 7.881, -3.587], ["C4'", 6.718, 6.889, -3.258], ["O4'", 6.486, 6.363, -1.919], ["C3'", 6.776, 5.641, -4.14], ["O3'", 7.398, 5.908, -5.39], ["C2'", 7.566, 4.726, -3.208], ["C1'", 6.874, 5, -1.877]],
    o2: ["O2'", 8.962, 4.91, -3.068],
    bases: {
      A: [["N9", 5.666, 4.158, -1.647], ["C8", 4.345, 4.449, -1.9], ["N7", 3.524, 3.496, -1.584], ["C5", 4.348, 2.496, -1.086], ["C6", 4.082, 1.215, -0.578], ["N6", 2.849, 0.697, -0.485], ["N1", 5.134, 0.481, -0.167], ["C2", 6.356, 1.001, -0.262], ["N3", 6.725, 2.179, -0.716], ["C4", 5.655, 2.893, -1.121]],
      C: [["N1", 5.666, 4.158, -1.647], ["C2", 5.853, 2.891, -1.1], ["O2", 7.001, 2.521, -0.831], ["N3", 4.764, 2.108, -0.883], ["C4", 3.536, 2.547, -1.188], ["N4", 2.508, 1.746, -0.956], ["C5", 3.323, 3.847, -1.751], ["C6", 4.423, 4.613, -1.961]],
      G: [["N9", 5.666, 4.158, -1.647], ["C8", 4.342, 4.447, -1.899], ["N7", 3.516, 3.48, -1.579], ["C5", 4.351, 2.483, -1.079], ["C6", 4.033, 1.195, -0.574], ["O6", 2.932, 0.661, -0.462], ["N1", 5.185, 0.505, -0.172], ["C2", 6.474, 0.995, -0.248], ["N2", 7.438, 0.18, 0.188], ["N3", 6.771, 2.203, -0.722], ["C4", 5.664, 2.886, -1.117]],
      T: [["N1", 5.666, 4.158, -1.647], ["C2", 5.867, 2.911, -1.107], ["O2", 6.971, 2.482, -0.819], ["N3", 4.725, 2.16, -0.908], ["C4", 3.431, 2.543, -1.197], ["O4", 2.487, 1.783, -0.974], ["C5", 3.322, 3.869, -1.76], ["C7", 1.949, 4.366, -2.104], ["C6", 4.416, 4.621, -1.964]],
    },
  },
};

type Bond = readonly [a: string, b: string, order: 1 | 2];
const s = (a: string, b: string): Bond => [a, b, 1];
const d = (a: string, b: string): Bond => [a, b, 2];

/** CCD heavy-atom bonds of the sugar-phosphate backbone; O2' and the termini are added by the builder. */
export const BACKBONE_BONDS: readonly Bond[] = [
  d("P", "OP1"), s("P", "OP2"), s("P", "O5'"), s("O5'", "C5'"), s("C5'", "C4'"), s("C4'", "O4'"), s("C4'", "C3'"),
  s("O4'", "C1'"), s("C3'", "O3'"), s("C3'", "C2'"), s("C2'", "C1'"),
];

/** CCD heavy-atom bonds of each base, glycosidic bond included (Kekule orders as in the CCD). */
export const BASE_BONDS: Record<TemplateBase | "U", readonly Bond[]> = {
  A: [s("C1'", "N9"), s("N9", "C8"), s("N9", "C4"), d("C8", "N7"), s("N7", "C5"), s("C5", "C6"), d("C5", "C4"), s("C6", "N6"), d("C6", "N1"), s("N1", "C2"), d("C2", "N3"), s("N3", "C4")],
  C: [s("C1'", "N1"), s("N1", "C2"), s("N1", "C6"), d("C2", "O2"), s("C2", "N3"), d("N3", "C4"), s("C4", "N4"), s("C4", "C5"), d("C5", "C6")],
  G: [s("C1'", "N9"), s("N9", "C8"), s("N9", "C4"), d("C8", "N7"), s("N7", "C5"), s("C5", "C6"), d("C5", "C4"), d("C6", "O6"), s("C6", "N1"), s("N1", "C2"), s("C2", "N2"), d("C2", "N3"), s("N3", "C4")],
  T: [s("C1'", "N1"), s("N1", "C2"), s("N1", "C6"), d("C2", "O2"), s("C2", "N3"), s("N3", "C4"), d("C4", "O4"), s("C4", "C5"), s("C5", "C7"), d("C5", "C6")],
  U: [s("C1'", "N1"), s("N1", "C2"), s("N1", "C6"), d("C2", "O2"), s("C2", "N3"), s("N3", "C4"), d("C4", "O4"), s("C4", "C5"), d("C5", "C6")],
};
