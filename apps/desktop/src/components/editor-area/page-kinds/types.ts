import type { ComponentType, ReactNode } from "react";
import type { ShellActions, ShellViewState } from "../../types";

export interface SerializedLocation {
  kind: string;
  [key: string]: unknown;
}

export interface PageComponentProps<L extends { kind: string }> {
  location: L;
  state: ShellViewState;
  actions: ShellActions;
  isActive: boolean;
}

export interface PageKindInput<K extends string, L extends { kind: K }> {
  kind: K;
  title: (location: L, state: ShellViewState) => string;
  description: string;
  Component: ComponentType<PageComponentProps<L>>;
  keepAlive?: boolean;
  fromPayload?: (data: SerializedLocation) => L | null;
  serialize?: (location: L) => object | null;
  renderFooter?: (location: L, state: ShellViewState) => ReactNode;
}

export interface PageKind<K extends string = string, L extends { kind: K } = { kind: K }> {
  kind: K;
  title: (location: L, state: ShellViewState) => string;
  description: string;
  Component: ComponentType<PageComponentProps<L>>;
  keepAlive: boolean;
  fromPayload: (data: SerializedLocation) => L | null;
  serialize: (location: L) => object | null;
  renderFooter?: (location: L, state: ShellViewState) => ReactNode;
}

export type AnyPageKind = PageKind<string, { kind: string }>;

export function definePageKind<K extends string, L extends { kind: K }>(
  input: PageKindInput<K, L>,
): PageKind<K, L> {
  return {
    keepAlive: false,
    fromPayload: () => ({ kind: input.kind }) as L,
    serialize: () => ({}),
    ...input,
  };
}
