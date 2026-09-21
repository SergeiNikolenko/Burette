"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { useMountEffect } from "@/hooks/use-mount-effect";

// Drop every `:has()` style rule from a constructed sheet (recursing into
// @media/@supports/@layer blocks). The grid's own markup uses no `has-*`
// variants, so these rules never style it, but Blink would still re-run their
// invalidation against the grid subtree on each per-scroll mutation.
function stripHasRules(owner: CSSStyleSheet | CSSGroupingRule) {
  const rules = owner.cssRules;
  if (!rules) return;
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index];
    if ((rule as CSSStyleRule).selectorText?.includes(":has(")) {
      try {
        owner.deleteRule(index);
      } catch {
        // ignore a rule that cannot be removed
      }
    } else if ((rule as CSSGroupingRule).cssRules?.length) {
      stripHasRules(rule as CSSGroupingRule);
    }
  }
}

let sharedSheets: CSSStyleSheet[] | null = null;

function getSharedSheets(): CSSStyleSheet[] {
  if (sharedSheets) return sharedSheets;
  const nextSheets: CSSStyleSheet[] = [];
  for (const stylesheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = stylesheet.cssRules;
    } catch {
      continue;
    }
    let text = "";
    for (const rule of Array.from(rules)) text += rule.cssText + "\n";
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      stripHasRules(sheet);
      nextSheets.push(sheet);
    } catch {
      // skip any sheet that cannot be reconstructed
    }
  }
  sharedSheets = nextSheets;
  return nextSheets;
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
          // ignore a node that cannot be cloned
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

export function ScrollerShell({
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
