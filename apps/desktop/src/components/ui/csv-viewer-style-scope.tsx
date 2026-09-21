"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { useMountEffect } from "@/hooks/use-mount-effect";

export function stripHasRules(owner: CSSStyleSheet | CSSGroupingRule) {
  const rules = owner.cssRules;
  if (!rules) return;
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index];
    if ((rule as CSSStyleRule).selectorText?.includes(":has(")) {
      try {
        owner.deleteRule(index);
      } catch {
        // Ignore rules that cannot be removed.
      }
    } else if ((rule as CSSGroupingRule).cssRules?.length) {
      stripHasRules(rule as CSSGroupingRule);
    }
  }
}

let sharedSheets: CSSStyleSheet[] | null = null;
function getSharedSheets(): CSSStyleSheet[] {
  if (sharedSheets) return sharedSheets;
  const sheets: CSSStyleSheet[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    let text = "";
    for (const rule of Array.from(rules)) text += rule.cssText + "\n";
    try {
      const clone = new CSSStyleSheet();
      clone.replaceSync(text);
      stripHasRules(clone);
      sheets.push(clone);
    } catch {
      // Skip stylesheets that cannot be reconstructed.
    }
  }
  sharedSheets = sheets;
  return sheets;
}

function ShadowScope({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [root, setRoot] = React.useState<ShadowRoot | null>(null);

  useMountEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    try {
      shadowRoot.adoptedStyleSheets = getSharedSheets();
    } catch {
      for (const node of Array.from(
        document.querySelectorAll('style, link[rel="stylesheet"]'),
      )) {
        try {
          shadowRoot.appendChild(node.cloneNode(true));
        } catch {
          // Ignore nodes that cannot be cloned.
        }
      }
    }
    setRoot(shadowRoot);
  });

  return (
    <div ref={hostRef} className={className} style={style}>
      {root ? createPortal(children, root) : null}
    </div>
  );
}

export function CsvStyleScope({
  isolate,
  className,
  style,
  children,
}: {
  isolate: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (isolate) {
    return (
      <ShadowScope className={className} style={style}>
        {children}
      </ShadowScope>
    );
  }
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}
