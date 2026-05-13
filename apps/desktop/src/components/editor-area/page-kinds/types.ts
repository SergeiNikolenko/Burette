import type { ComponentType, ReactNode } from "react";
import type { ShellActions, ShellTab, ShellViewState } from "../../types";

export type PageComponentProps<T extends ShellTab> = {
  tab: T;
  isActive: boolean;
  state: ShellViewState;
  actions: ShellActions;
};

export type PageKindInput<T extends ShellTab> = {
  kind: T["kind"];
  title: (tab: T) => string;
  description: string;
  Component: ComponentType<PageComponentProps<T>>;
  keepAlive?: boolean;
  supportsFileContextMenu?: boolean;
  renderFooter?: (tab: T, state: ShellViewState) => ReactNode;
};

export type PageKind<T extends ShellTab = ShellTab> = {
  kind: T["kind"];
  title: (tab: T) => string;
  description: string;
  Component: ComponentType<PageComponentProps<T>>;
  keepAlive: boolean;
  supportsFileContextMenu: boolean;
  renderFooter?: (tab: T, state: ShellViewState) => ReactNode;
};

export function definePageKind<T extends ShellTab>(input: PageKindInput<T>): PageKind<T> {
  return {
    keepAlive: false,
    supportsFileContextMenu: false,
    ...input,
  };
}
