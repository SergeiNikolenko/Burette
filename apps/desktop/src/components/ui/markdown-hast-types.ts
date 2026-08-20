"use client";

export type MarkdownPoint = {
  column?: number;
  line?: number;
  offset?: number;
};

export type MarkdownPosition = {
  end?: MarkdownPoint;
  start?: MarkdownPoint;
};

export type MarkdownHastText = {
  position?: MarkdownPosition;
  type: "text";
  value: string;
};

export type MarkdownHastElement = {
  children: MarkdownHastNode[];
  position?: MarkdownPosition;
  properties?: Record<string, unknown>;
  tagName: string;
  type: "element";
};

export type MarkdownHastRoot = {
  children: MarkdownHastNode[];
  type: "root";
};

export type MarkdownHastNode =
  | MarkdownHastElement
  | MarkdownHastText
  | {
      children?: MarkdownHastNode[];
      position?: MarkdownPosition;
      type: string;
      value?: unknown;
    };
