import type { ShellTab } from "../../types";
import { documentKind } from "./document";
import { launcherKind } from "./launcher";
import { settingsKind } from "./settings";
import type { PageKind } from "./types";

const kinds = [documentKind, launcherKind, settingsKind] as const;

const byKind = new Map<string, PageKind>(kinds.map((kind) => [kind.kind, kind as PageKind]));

export function pageKind<T extends ShellTab>(tab: T): PageKind<T> {
  const kind = byKind.get(tab.kind);
  if (!kind) throw new Error("Unknown page kind: " + tab.kind);
  return kind as unknown as PageKind<T>;
}

export { documentKind, launcherKind, settingsKind };
export type { PageKind } from "./types";
