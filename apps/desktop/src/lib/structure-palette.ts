// Keep the carbon skeleton visible and lighten nitrogen, oxygen and the heavy halogens for dark surfaces.
// Light-theme drawings retain RDKit's own palette.
export const DARK_STRUCTURE_PALETTE = {
  "1": [0.87, 0.87, 0.87],
  "6": [0.87, 0.87, 0.87],
  "7": [0.45, 0.62, 1],
  "8": [1, 0.45, 0.45],
  // RDKit's bromine brown and iodine purple nearly vanish on a dark surface.
  "35": [0.86, 0.56, 0.36],
  "53": [0.78, 0.5, 0.96],
};
