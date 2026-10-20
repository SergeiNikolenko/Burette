import createDOMPurify from "dompurify";

const SVG = "http://www.w3.org/2000/svg";
const FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;
const RASTER = /^data:image\/(png|gif);base64,[A-Za-z0-9+/=]+$/;
const PRESENTATION = new Set(("stop-color stop-opacity flood-color flood-opacity lighting-color fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color display visibility filter clip-path clip-rule mask font-family font-size font-style font-weight text-anchor dominant-baseline alignment-baseline letter-spacing word-spacing paint-order vector-effect transform transform-origin").split(" "));

function safeValue(value) {
  // SVG presentation may reference local gradients/filters, never another file
  // or stylesheet. Reject CSS escapes/comments instead of decoding inconsistently.
  if (/\\|\/\*|@|var\s*\(|expression\s*\(/i.test(value)) return false;
  const rest = value.replace(/url\(\s*(["']?)(#[A-Za-z_][A-Za-z0-9_.:-]*)\1\s*\)/gi, "");
  return !/url\s*\(/i.test(rest);
}

export function createArtworkSanitizer(window) {
  const purifier = createDOMPurify(window);
  return function sanitizeArtwork(markup) {
    if (typeof markup !== "string" || markup.length > 32 * 1024 * 1024) {
      throw new Error("Invalid SVG artwork");
    }
    const fragment = purifier.sanitize(markup, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ["img", "metadata"], ADD_ATTR: ["src"],
      FORBID_TAGS: ["style", "a", "foreignObject", "animate", "animateMotion", "animateTransform", "set"],
      RETURN_DOM_FRAGMENT: true,
    });
    const container = window.document.createElement("div");
    for (const node of [...fragment.childNodes]) {
      if (node.namespaceURI === SVG && node.localName === "svg") {
        for (const element of [node, ...node.querySelectorAll("*")]) {
          for (const attribute of [...element.attributes]) {
            const name = attribute.localName.toLowerCase();
            if (name === "href" && !FRAGMENT.test(attribute.value)) {
              element.removeAttributeNode(attribute);
            } else if (PRESENTATION.has(name) && !safeValue(attribute.value)) {
              element.removeAttributeNode(attribute);
            }
          }
          const style = element.style;
          if (style) for (const property of [...style]) {
            if (!PRESENTATION.has(property) || !safeValue(style.getPropertyValue(property))) {
              style.removeProperty(property);
            }
          }
        }
        container.append(node);
      } else if (node.localName === "img" && node.classList.contains("buret-xyzrender-animation-image")) {
        const data = node.getAttribute("src") || "";
        if (data.length > 24_000_000 || !RASTER.test(data)) continue;
        // Reconstruct the one supported HTML adjunct instead of importing its
        // attributes/styles. Duplication and undo retain the applied animation.
        const image = window.document.createElement("img");
        image.className = "buret-xyzrender-animation-image";
        image.alt = "Molecular animation";
        image.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:inherit;pointer-events:none";
        image.src = data;
        container.append(image);
      }
    }
    return container.innerHTML;
  };
}
