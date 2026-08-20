"use client";

import * as React from "react";

import { CODE_VIEWER_SYNTAX_STYLE } from "./code-viewer-syntax";

const CODE_VIEWER_SYNTAX_STYLE_ID = "retab-code-viewer-syntax-style";

export function useCodeViewerSyntaxStyle() {
  React.useInsertionEffect(() => {
    let style = document.getElementById(CODE_VIEWER_SYNTAX_STYLE_ID);
    if (style) return;

    style = document.createElement("style");
    style.id = CODE_VIEWER_SYNTAX_STYLE_ID;
    style.textContent = CODE_VIEWER_SYNTAX_STYLE;
    document.head.append(style);
  }, []);
}
