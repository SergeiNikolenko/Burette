import { useMemo, useState, type CSSProperties } from "react";
import type { TextFileDocument } from "../../types";

type MaestroOutlineLine = {
  kind: "line";
  id: string;
  lineNumber: number;
  text: string;
  depth: number;
};

type MaestroOutlineBlock = {
  kind: "block";
  id: string;
  lineNumber: number;
  endLineNumber: number | null;
  header: string;
  children: MaestroOutlineItem[];
  depth: number;
};

type MaestroOutlineItem = MaestroOutlineLine | MaestroOutlineBlock;

const MAX_VISIBLE_BLOCK_LINES = 240;

export function MaestroOutlineViewer({ document }: { document: TextFileDocument }) {
  const outline = useMemo(() => parseMaestroOutline(document.content), [document.content]);
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(() => new Set());
  const toggleBlock = (id: string) => {
    setOpenBlocks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="maestro-outline-viewer">
      <div className="maestro-outline-note">
        <span>Structured preview</span>
        <strong>{outline.blockCount} blocks</strong>
        {document.truncated ? <strong>Preview limited</strong> : null}
      </div>
      <div className="maestro-outline-tree">
        {outline.items.map((item) => (
          <MaestroOutlineItemView key={item.id} item={item} openBlocks={openBlocks} toggleBlock={toggleBlock} />
        ))}
      </div>
    </div>
  );
}

function MaestroOutlineItemView({
  item,
  openBlocks,
  toggleBlock,
}: {
  item: MaestroOutlineItem;
  openBlocks: Set<string>;
  toggleBlock: (id: string) => void;
}) {
  if (item.kind === "line") {
    return (
      <div className="maestro-outline-line" style={{ "--maestro-depth": item.depth } as CSSProperties}>
        <span>{item.lineNumber}</span>
        <code>{item.text || " "}</code>
      </div>
    );
  }

  const open = openBlocks.has(item.id);
  const visibleChildren = open ? visibleBlockChildren(item.children) : [];
  const hiddenChildren = open ? item.children.length - visibleChildren.length : item.children.length;
  return (
    <div className="maestro-outline-block" data-open={open || undefined} style={{ "--maestro-depth": item.depth } as CSSProperties}>
      <button type="button" className="maestro-outline-block-header" onClick={() => toggleBlock(item.id)}>
        <span className="maestro-outline-toggle">{open ? "-" : "+"}</span>
        <span className="maestro-outline-name">{blockName(item.header)}</span>
        <strong>{blockSummary(item)}</strong>
      </button>
      {open ? (
        <div className="maestro-outline-block-children">
          {visibleChildren.map((child) => (
            <MaestroOutlineItemView key={child.id} item={child} openBlocks={openBlocks} toggleBlock={toggleBlock} />
          ))}
          {hiddenChildren > 0 ? (
            <div className="maestro-outline-muted">
              {hiddenChildren} more rows hidden in this block
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function visibleBlockChildren(children: MaestroOutlineItem[]) {
  const visible: MaestroOutlineItem[] = [];
  let lineCount = 0;
  for (const child of children) {
    if (child.kind === "block") {
      visible.push(child);
      continue;
    }
    if (lineCount >= MAX_VISIBLE_BLOCK_LINES) continue;
    visible.push(child);
    lineCount += 1;
  }
  return visible;
}

function parseMaestroOutline(content: string) {
  const lines = content.split(/\r?\n/);
  const items: MaestroOutlineItem[] = [];
  const stack: Array<{ children: MaestroOutlineItem[]; block?: MaestroOutlineBlock }> = [{ children: items }];
  let blockCount = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const blockHeader = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*(?:\[\d+\])?)\s*\{\s*$/u);
    if (blockHeader) {
      const parent = stack[stack.length - 1];
      const block: MaestroOutlineBlock = {
        kind: "block",
        id: `block:${lineNumber}:${blockHeader[1]}`,
        lineNumber,
        endLineNumber: null,
        header: line.trim(),
        children: [],
        depth: stack.length - 1,
      };
      parent.children.push(block);
      stack.push({ children: block.children, block });
      blockCount += 1;
      return;
    }

    if (line.trim() === "}" && stack.length > 1) {
      const current = stack.pop();
      if (current?.block) current.block.endLineNumber = lineNumber;
      return;
    }

    const parent = stack[stack.length - 1];
    parent.children.push({
      kind: "line",
      id: `line:${lineNumber}`,
      lineNumber,
      text: line,
      depth: stack.length - 1,
    });
  });

  return { items, blockCount };
}

function blockName(header: string) {
  return header.replace(/\s*\{\s*$/u, "");
}

function blockSummary(block: MaestroOutlineBlock) {
  const parts = [
    block.endLineNumber ? `lines ${block.lineNumber}-${block.endLineNumber}` : `from line ${block.lineNumber}`,
    declaredRowCount(block.header),
    nestedBlockCount(block),
  ].filter(Boolean);
  return parts.join(" / ");
}

function declaredRowCount(header: string) {
  const match = header.match(/\[(\d+)\]/u);
  if (!match) return "";
  const count = Number.parseInt(match[1], 10);
  if (!Number.isFinite(count)) return "";
  return `${count.toLocaleString("en-US")} rows`;
}

function nestedBlockCount(block: MaestroOutlineBlock) {
  const count = block.children.filter((child) => child.kind === "block").length;
  return count > 0 ? `${count} nested blocks` : "";
}
