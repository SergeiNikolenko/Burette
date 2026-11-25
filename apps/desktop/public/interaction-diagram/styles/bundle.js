// Preloaded style definitions and CSS for sandboxed frames (opaque origin)
// where fetch() against asset:// or http://asset.localhost is blocked by CORS.
// Keep in sync with styles/index.json and styles/*.css.
window.LID_STYLES = {
  "style-schrodinger": {
    "label": "Schrödinger",
    "order": 216,
    "panel": 1,
    "compact": "none",
    "pipeline": {
      "partners": "disc",
      "context": "cutoff",
      "waters": true,
      "hydrophobic": "none"
    },
    "layers": {
      "contour": true,
      "exposure": true,
      "halos": false,
      "context": true,
      "waters": true,
      "chain": true,
      "legend": true
    },
    "view": {
      "study": "style-schrodinger",
      "layout": "study",
      "indexedContacts": true,
      "atoms": {
        "light": {
          "BACKGROUND": "#ffffff",
          "DEFAULT": "#000000",
          "C": "#000000",
          "H": "#000000",
          "N": "#1f2fe0",
          "O": "#e8101a",
          "P": "#f07800",
          "S": "#c09a00",
          "F": "#2f9a1f",
          "CL": "#1f9a2f",
          "BR": "#a02a1f"
        },
        "dark": {
          "BACKGROUND": "#141414",
          "DEFAULT": "#ebebeb",
          "C": "#ebebeb",
          "H": "#ebebeb",
          "N": "#7f8cff",
          "O": "#ff6868",
          "P": "#ffa040",
          "S": "#e6c24d",
          "F": "#7fdc6a",
          "CL": "#7fdc6a",
          "BR": "#f08070"
        }
      },
      "fontFamily": "'DejaVu Sans', Verdana, Arial, sans-serif",
      "textSize": 6.5,
      "bondWidth": 0.75,
      "lineWidth": 0.8,
      "kinds": {
        "hbond": [
          "#c81ed8",
          "#e879f9"
        ],
        "ionic": [
          "#6d4fe0",
          "#a593ff"
        ],
        "pi": [
          "#22a02c",
          "#5fd06a"
        ],
        "cationPi": [
          "#e0202a",
          "#ff6b6b"
        ],
        "metal": [
          "#7a7a82",
          "#a1a1aa"
        ],
        "water": [
          "#c81ed8",
          "#e879f9"
        ],
        "halogen": [
          "#b08d00",
          "#e6c84f"
        ],
        "hydrophobic": [
          "#7cb518",
          "#a3d64a"
        ]
      },
      "mergeHbonds": true,
      "arrows": false,
      "labelFormat": "Arg47A"
    },
    "binding": true,
    "css": true
  },
  "style-moe": {
    "label": "MOE",
    "order": 217,
    "panel": 2,
    "compact": "none",
    "pipeline": {
      "partners": "disc",
      "context": "moe",
      "waters": true,
      "hydrophobic": "none"
    },
    "layers": {
      "contour": true,
      "exposure": true,
      "halos": true,
      "context": true,
      "waters": true,
      "chain": false,
      "legend": true
    },
    "view": {
      "study": "style-moe",
      "layout": "study",
      "indexedContacts": true,
      "atoms": {
        "light": {
          "BACKGROUND": "#ffffff",
          "DEFAULT": "#111111",
          "C": "#111111",
          "H": "#111111",
          "N": "#111111",
          "O": "#111111",
          "P": "#111111",
          "S": "#111111"
        },
        "dark": {
          "BACKGROUND": "#0b0b0c",
          "DEFAULT": "#f2f2f2",
          "C": "#f2f2f2",
          "H": "#f2f2f2",
          "N": "#f2f2f2",
          "O": "#f2f2f2",
          "P": "#f2f2f2",
          "S": "#f2f2f2"
        }
      },
      "fontFamily": "Helvetica, Arial, sans-serif",
      "textSize": 6.5,
      "bondWidth": 0.9,
      "lineWidth": 1.05,
      "kinds": {
        "hbond": [
          "#1f9d3a",
          "#3cc95a"
        ],
        "ionic": [
          "#a63ccc",
          "#d07cf2"
        ],
        "metal": [
          "#cc4a9c",
          "#f07cc2"
        ],
        "halogen": [
          "#0f9b8e",
          "#2dd4bf"
        ],
        "water": [
          "#a8831f",
          "#d9b352"
        ],
        "pi": [
          "#1f9d3a",
          "#3cc95a"
        ],
        "cationPi": [
          "#1f9d3a",
          "#3cc95a"
        ],
        "hydrophobic": [
          "#6b9a5c",
          "#8cc47b"
        ]
      },
      "mergeHbonds": true,
      "arrows": false,
      "labelFormat": "Arg47A"
    },
    "binding": true,
    "css": false
  },
  "style-poseedit": {
    "label": "PoseEdit",
    "order": 218,
    "panel": 3,
    "pipeline": {
      "partners": "fragment",
      "context": "none",
      "waters": true,
      "hydrophobic": "spline"
    },
    "layers": {
      "contour": false,
      "exposure": false,
      "halos": false,
      "context": false,
      "waters": true,
      "chain": false,
      "legend": true
    },
    "view": {
      "study": "style-poseedit",
      "layout": "study",
      "indexedContacts": true,
      "atoms": {
        "light": {
          "BACKGROUND": "#ffffff",
          "DEFAULT": "#000000",
          "C": "#000000",
          "H": "#000000",
          "N": "#0000ff",
          "O": "#ff0000",
          "P": "#e60080",
          "S": "#b3b300",
          "F": "#00b300",
          "CL": "#00b300"
        },
        "dark": {
          "BACKGROUND": "#141414",
          "DEFAULT": "#ececec",
          "C": "#ececec",
          "H": "#ececec",
          "N": "#7c8cff",
          "O": "#ff6b6b",
          "P": "#ff66c4",
          "S": "#e0d24a",
          "F": "#5fd17a",
          "CL": "#5fd17a"
        }
      },
      "fontFamily": "'DejaVu Sans', Verdana, 'Bitstream Vera Sans', Geneva, sans-serif",
      "textSize": 6.5,
      "bondWidth": 0.6,
      "lineWidth": 0.6,
      "dash": {
        "hbond": "1.8 1.8",
        "ionic": "1.8 1.8",
        "metal": "none",
        "halogen": "1.8 1.8",
        "water": "1.8 1.8",
        "pi": "1.8 1.8",
        "cationPi": "1.8 1.8"
      },
      "kinds": {
        "hbond": [
          "#6699ff",
          "#7fa8ff"
        ],
        "ionic": [
          "#ff00ff",
          "#ff66ff"
        ],
        "metal": [
          "#333333",
          "#d4d4d4"
        ],
        "halogen": [
          "#00a050",
          "#5fd17a"
        ],
        "water": [
          "#6699ff",
          "#7fa8ff"
        ],
        "pi": [
          "#019a4d",
          "#4cc47f"
        ],
        "cationPi": [
          "#019a4d",
          "#4cc47f"
        ],
        "hydrophobic": [
          "#019a4d",
          "#4cc47f"
        ]
      },
      "mergeHbonds": true,
      "arrows": false,
      "residueLabelColor": [
        "#000000",
        "#ececec"
      ],
      "labelFormat": "Arg47A",
      "discs": "moe"
    },
    "binding": true,
    "css": false
  },
  "style-pocket-wall": {
    "label": "Pocket wall",
    "order": 214,
    "panel": 4,
    "pipeline": {
      "partners": "disc",
      "context": "cutoff",
      "waters": true,
      "hydrophobic": "none"
    },
    "layers": {
      "contour": true,
      "exposure": true,
      "halos": true,
      "context": true,
      "waters": true,
      "chain": false,
      "legend": true
    },
    "view": {
      "study": "style-pocket-wall",
      "layout": "study",
      "indexedContacts": true,
      "atoms": {
        "light": {
          "BACKGROUND": "#ffffff",
          "DEFAULT": "#27272a",
          "C": "#27272a",
          "H": "#27272a",
          "N": "#2f5fc4",
          "O": "#cf3a32",
          "P": "#b8581a",
          "S": "#94700e"
        },
        "dark": {
          "BACKGROUND": "#171717",
          "DEFAULT": "#e4e4e7",
          "C": "#e4e4e7",
          "H": "#e4e4e7",
          "N": "#8aa9f5",
          "O": "#f58078",
          "P": "#f0a063",
          "S": "#e2c35a"
        }
      },
      "fontFamily": "-apple-system, 'SF Pro Text', Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif",
      "textSize": 6.5,
      "bondWidth": 0.6,
      "lineWidth": 0.8,
      "kinds": {
        "hbond": [
          "#3f3f46",
          "#d4d4d8"
        ],
        "ionic": [
          "#a8447f",
          "#e59ac4"
        ],
        "metal": [
          "#8f6410",
          "#dbb45c"
        ],
        "halogen": [
          "#2b8272",
          "#6fcdb9"
        ],
        "water": [
          "#3f7dba",
          "#84b6e6"
        ],
        "pi": [
          "#0f7d87",
          "#5fc4cc"
        ],
        "cationPi": [
          "#b45a1c",
          "#eba06a"
        ],
        "hydrophobic": [
          "#4f8a4b",
          "#8cc487"
        ]
      },
      "mergeHbonds": true,
      "arrows": true,
      "residueLabelColor": [
        "#27272a",
        "#e4e4e7"
      ],
      "labelFormat": "Arg47A",
      "discs": "moe"
    },
    "binding": true,
    "css": false
  },
  "style-burial-map": {
    "label": "Burial map",
    "order": 215,
    "panel": 5,
    "compact": "none",
    "pipeline": {
      "partners": "disc",
      "context": "moe",
      "waters": true,
      "hydrophobic": "none"
    },
    "layers": {
      "contour": false,
      "exposure": true,
      "halos": false,
      "context": true,
      "waters": true,
      "chain": false,
      "legend": true
    },
    "view": {
      "study": "style-burial-map",
      "layout": "study",
      "indexedContacts": true,
      "atoms": {
        "light": {
          "BACKGROUND": "#ffffff",
          "DEFAULT": "#18181b",
          "C": "#18181b",
          "H": "#18181b",
          "N": "#18181b",
          "O": "#18181b",
          "P": "#18181b",
          "S": "#18181b",
          "F": "#18181b",
          "CL": "#18181b",
          "BR": "#18181b",
          "I": "#18181b"
        },
        "dark": {
          "BACKGROUND": "#141414",
          "DEFAULT": "#f4f4f5",
          "C": "#f4f4f5",
          "H": "#f4f4f5",
          "N": "#f4f4f5",
          "O": "#f4f4f5",
          "P": "#f4f4f5",
          "S": "#f4f4f5",
          "F": "#f4f4f5",
          "CL": "#f4f4f5",
          "BR": "#f4f4f5",
          "I": "#f4f4f5"
        }
      },
      "fontFamily": "Helvetica, Arial, sans-serif",
      "textSize": 7,
      "bondWidth": 1.0,
      "lineWidth": 0.6,
      "dash": {
        "hbond": "2.6 1.8",
        "ionic": "none",
        "metal": "none",
        "halogen": "2.6 1.8",
        "water": "1 1.6",
        "pi": "4 2",
        "cationPi": "4 1.5 1 1.5"
      },
      "kinds": {
        "hbond": [
          "#52525b",
          "#c8c8ca"
        ],
        "ionic": [
          "#52525b",
          "#c8c8ca"
        ],
        "metal": [
          "#52525b",
          "#c8c8ca"
        ],
        "halogen": [
          "#52525b",
          "#c8c8ca"
        ],
        "water": [
          "#5b7f9c",
          "#8caac4"
        ],
        "pi": [
          "#52525b",
          "#c8c8ca"
        ],
        "cationPi": [
          "#52525b",
          "#c8c8ca"
        ],
        "hydrophobic": [
          "#32834b",
          "#75bd84"
        ]
      },
      "mergeHbonds": true,
      "arrows": false,
      "residueLabelColor": [
        "#000000",
        "#ececec"
      ],
      "labelFormat": "Arg47A",
      "discs": "moe"
    },
    "binding": true,
    "css": false
  }
};
window.LID_STYLE_CSS = {
  "style-schrodinger": "/* Maestro draws every ligand bond in plain ink; only the element labels carry colour.\n   Bond gradients are recoloured per theme, detected from the carbon stop colour\n   the drawer writes as rgb() (light C #000000, dark C #ebebeb), so exports keep it too. */\n#draw-area:has(stop[stop-color=\"rgb(0, 0, 0)\"]) [id^=\"draw-area_s_\"][id$=\"_g\"] stop {\n  stop-color: #000000;\n}\n#draw-area:has(stop[stop-color=\"rgb(235, 235, 235)\"]) [id^=\"draw-area_s_\"][id$=\"_g\"] stop {\n  stop-color: #ebebeb;\n}\n"
};
